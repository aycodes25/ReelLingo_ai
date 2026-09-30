import { randomBytes } from "node:crypto";
import { config } from "./config.js";
import { getMonthlyUsage, getSubscription } from "./database.js";
import { dbTime, many, one, query, toBool } from "./db.js";
import { getPlan } from "./plans.js";

/** Billing identity of a workspace: a user's own account, or a team (shared plan and credits). */
export function billingIdFor({ userId, teamId = null }) {
  return teamId ? `team:${teamId}` : userId;
}

function subscriptionActive(subscription) {
  if (!subscription || subscription.status === "canceled" || subscription.status === "inactive") return false;
  if (!subscription.current_period_end) return true;
  return new Date(subscription.current_period_end).getTime() > Date.now() - 3 * 24 * 3600 * 1000;
}

/** The plan, limits and usage that apply to an upload in this workspace. */
export async function planFor({ userId, teamId = null }) {
  const billingId = billingIdFor({ userId, teamId });
  const [subscription, usage, credits] = await Promise.all([
    getSubscription(billingId),
    getMonthlyUsage(userId, { teamId }),
    listAvailableCredits(billingId),
  ]);
  const active = subscriptionActive(subscription);
  const tier = active ? subscription.tier : "free";
  const plan = await getPlan(tier === "custom" ? "free" : tier);
  if (tier === "custom") {
    plan.code = "custom";
    plan.name = "Custom";
    plan.videos_per_month = Number(subscription.max_videos_per_month);
    plan.max_video_minutes = Math.min(Number(subscription.max_video_minutes), config.maxVideoMinutes);
    plan.voice_clone = true;
    plan.watermark = false;
  }
  return {
    billingId,
    tier: plan.code,
    plan,
    subscription: subscription ? {
      status: active ? subscription.status : "expired",
      provider: subscription.provider,
      current_period_end: subscription.current_period_end ? new Date(subscription.current_period_end).toISOString() : null,
      cancel_at_period_end: toBool(subscription.cancel_at_period_end),
    } : null,
    videosThisMonth: usage.videos,
    minutesThisMonth: Math.round((usage.seconds / 60) * 10) / 10,
    maxVideosPerMonth: plan.videos_per_month,
    maxVideoMinutes: plan.max_video_minutes,
    credits,
  };
}

export async function listAvailableCredits(billingId) {
  const rows = await many(
    "SELECT * FROM credits WHERE billing_id = $1 AND job_id IS NULL AND (expires_at IS NULL OR expires_at > $2) ORDER BY max_minutes, id",
    [billingId, dbTime()],
  );
  return rows.map((row) => ({ id: Number(row.id), max_minutes: Number(row.max_minutes), source: row.source, created_at: row.created_at }));
}

/** The smallest unused credit that covers a video of this length. */
export async function findCredit(billingId, minutesNeeded) {
  return (await listAvailableCredits(billingId)).find((credit) => credit.max_minutes >= minutesNeeded) || null;
}

/** Marks a credit as spent; returns false if another request already used it. */
export async function consumeCredit(creditId, jobId) {
  const result = await query("UPDATE credits SET job_id = $1 WHERE id = $2 AND job_id IS NULL", [jobId, creditId]);
  return result.rowCount > 0;
}

export async function releaseCredit(jobId) {
  await query("UPDATE credits SET job_id = NULL WHERE job_id = $1", [jobId]);
}

export async function grantCredit(billingId, maxMinutes, source, reference = null) {
  const row = await one(
    "INSERT INTO credits (billing_id, max_minutes, source, reference) VALUES ($1, $2, $3, $4) RETURNING *",
    [billingId, maxMinutes, source, reference],
  );
  return { id: Number(row.id), max_minutes: Number(row.max_minutes), source: row.source };
}

function newReferralCode() {
  return randomBytes(5).toString("base64url").replace(/[-_]/g, "x").slice(0, 7).toUpperCase();
}

function normalizeProfile(row) {
  if (!row) return null;
  return {
    user_id: row.user_id,
    email: row.email || "",
    name: row.name || "",
    creator_type: row.creator_type || "",
    phone: row.phone || "",
    notify_email: toBool(row.notify_email),
    notify_whatsapp: toBool(row.notify_whatsapp),
    referral_code: row.referral_code,
    referred_by: row.referred_by || null,
    referral_rewarded: toBool(row.referral_rewarded),
  };
}

export async function getProfile(userId) {
  return normalizeProfile(await one("SELECT * FROM profiles WHERE user_id = $1", [userId]));
}

/** Creates the profile on first sight of a user and keeps their email current. */
export async function ensureProfile(userId, email = "") {
  const existing = await getProfile(userId);
  if (existing) {
    if (email && existing.email !== email) {
      await query("UPDATE profiles SET email = $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2", [email, userId]);
      existing.email = email;
    }
    return existing;
  }
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await query(
        "INSERT INTO profiles (user_id, email, name, referral_code, updated_at) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP) ON CONFLICT (user_id) DO NOTHING",
        [userId, email, email ? email.split("@")[0] : "", newReferralCode()],
      );
      break;
    } catch (error) {
      if (attempt === 4 || !/unique|constraint/i.test(String(error.message))) throw error;
    }
  }
  return getProfile(userId);
}

const PROFILE_FIELDS = ["name", "creator_type", "phone", "notify_email", "notify_whatsapp"];

export async function updateProfile(userId, changes) {
  const entries = Object.entries(changes).filter(([key, value]) => PROFILE_FIELDS.includes(key) && value !== undefined);
  if (entries.length) {
    const assignments = entries.map(([key], index) => `${key} = $${index + 1}`).join(", ");
    await query(`UPDATE profiles SET ${assignments}, updated_at = CURRENT_TIMESTAMP WHERE user_id = $${entries.length + 1}`, [...entries.map(([, value]) => value), userId]);
  }
  return getProfile(userId);
}

/** Links a new user to whoever referred them. Rewards are paid once the new user finishes their first dub. */
export async function applyReferral(userId, code) {
  const normalized = String(code || "").trim().toUpperCase();
  if (!normalized) return { applied: false, reason: "No referral code." };
  const profile = await getProfile(userId);
  if (!profile) return { applied: false, reason: "Profile not found." };
  if (profile.referred_by) return { applied: false, reason: "A referral code was already applied." };
  const referrer = await one("SELECT user_id FROM profiles WHERE referral_code = $1", [normalized]);
  if (!referrer || referrer.user_id === userId) return { applied: false, reason: "That referral code isn't valid." };
  const priorJobs = await one("SELECT COUNT(*) AS count FROM jobs WHERE user_id = $1 AND status = 'done'", [userId]);
  if (Number(priorJobs?.count || 0) > 0) return { applied: false, reason: "Referral codes only apply to new accounts." };
  await query("UPDATE profiles SET referred_by = $1 WHERE user_id = $2", [referrer.user_id, userId]);
  return { applied: true };
}

/** Pays the referral bonus to both people the first time the referred user completes a dub. */
export async function rewardReferralIfDue(userId) {
  const profile = await getProfile(userId);
  if (!profile?.referred_by || profile.referral_rewarded) return false;
  const claimed = await query("UPDATE profiles SET referral_rewarded = $1 WHERE user_id = $2 AND referral_rewarded = $3", [true, userId, false]);
  if (!claimed.rowCount) return false;
  for (let index = 0; index < config.referralBonusVideos; index += 1) {
    await grantCredit(profile.referred_by, config.referralBonusMinutes, "referral", `referred:${userId}`);
    await grantCredit(userId, config.referralBonusMinutes, "referral", `referrer:${profile.referred_by}`);
  }
  return true;
}

export async function referralStats(userId) {
  const invited = await one("SELECT COUNT(*) AS count FROM profiles WHERE referred_by = $1", [userId]);
  const rewarded = await one("SELECT COUNT(*) AS count FROM profiles WHERE referred_by = $1 AND referral_rewarded = $2", [userId, true]);
  return { invited: Number(invited?.count || 0), rewarded: Number(rewarded?.count || 0) };
}

export async function listGlossary(userId) {
  return (await many("SELECT * FROM glossary_terms WHERE user_id = $1 ORDER BY term", [userId])).map((row) => ({
    id: Number(row.id), term: row.term, translation: row.translation || "", target_language: row.target_language || "", note: row.note || "",
  }));
}
