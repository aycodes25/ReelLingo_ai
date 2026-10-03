import { randomBytes, randomUUID } from "node:crypto";
import { ensureProfile, grantCredit, OVERRIDE_BOOLS, OVERRIDE_NUMBERS, parseOverrides, planFor, referralStats } from "./accounts.js";
import { activateSubscription, cancelSubscription } from "./billing.js";
import { config, isAdminEmail } from "./config.js";
import { getJob } from "./database.js";
import { dbTime, many, one, query, toBool } from "./db.js";
import { deleteVoice } from "./dubbing.js";
import { purgeJob } from "./jobfiles.js";
import { logger } from "./logger.js";
import { sendEmail } from "./notify.js";
import { getPlan, PERMISSIONS } from "./plans.js";

// ---------- Supabase Auth (admin API, needs the service_role key) ----------
function hasSupabaseAuth() {
  return Boolean(config.supabaseUrl && config.supabaseKey);
}

async function supabaseAdmin(path, { method = "GET", body } = {}) {
  const response = await fetch(`${config.supabaseUrl}/auth/v1${path}`, {
    method,
    headers: { apikey: config.supabaseKey, Authorization: `Bearer ${config.supabaseKey}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const message = data.msg || data.message || data.error_description || data.error || `Supabase error ${response.status}`;
    throw new Error(response.status === 403 || response.status === 401
      ? "Supabase refused the request. SUPABASE_KEY in backend/.env must be the service_role key (Supabase → Project Settings → API)."
      : message);
  }
  return data;
}

/** Makes sure every Supabase sign-up has a profile, so admins see users who haven't opened the studio yet. */
export async function syncAuthUsers() {
  if (!hasSupabaseAuth()) return 0;
  let synced = 0;
  for (let page = 1; page <= 20; page += 1) {
    const data = await supabaseAdmin(`/admin/users?page=${page}&per_page=200`);
    const users = data.users || [];
    for (const user of users) {
      await ensureProfile(user.id, (user.email || "").toLowerCase());
      synced += 1;
    }
    if (users.length < 200) break;
  }
  return synced;
}

function monthStart() {
  const now = new Date();
  return dbTime(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)));
}

function iso(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const text = String(value);
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text) ? `${text.replace(" ", "T")}Z` : text;
}

// ---------- Listing ----------
export async function listUsers({ search = "", plan = "", status = "", page = 1, perPage = 50 } = {}) {
  const needle = `%${String(search).trim().toLowerCase()}%`;
  const rows = await many(
    `SELECT profiles.*, subscriptions.tier, subscriptions.status AS subscription_status, subscriptions.current_period_end, subscriptions.overrides_json
     FROM profiles LEFT JOIN subscriptions ON subscriptions.user_id = profiles.user_id
     WHERE (LOWER(COALESCE(profiles.email, '')) LIKE $1 OR LOWER(COALESCE(profiles.name, '')) LIKE $1 OR profiles.user_id LIKE $1)
     ORDER BY profiles.created_at DESC`,
    [needle],
  );
  const usage = new Map((await many(
    `SELECT user_id, COUNT(*) AS videos, COALESCE(SUM(duration_seconds), 0) AS seconds FROM jobs
     WHERE team_id IS NULL AND status <> 'failed' AND credit_id IS NULL AND created_at >= $1 GROUP BY user_id`,
    [monthStart()],
  )).map((row) => [row.user_id, row]));
  const totals = new Map((await many("SELECT user_id, COUNT(*) AS jobs FROM jobs GROUP BY user_id")).map((row) => [row.user_id, Number(row.jobs)]));
  const credits = new Map((await many("SELECT billing_id, COUNT(*) AS credits FROM credits WHERE job_id IS NULL GROUP BY billing_id")).map((row) => [row.billing_id, Number(row.credits)]));
  const plans = new Map((await many("SELECT code, name FROM plans")).map((row) => [row.code, row.name]));

  let users = rows.map((row) => {
    const active = row.tier && row.tier !== "free" && row.subscription_status !== "canceled" && (!row.current_period_end || new Date(row.current_period_end) > new Date());
    const tier = active ? row.tier : "free";
    return {
      user_id: row.user_id,
      email: row.email || "",
      name: row.name || "",
      plan: tier,
      plan_name: plans.get(tier) || tier,
      plan_expires: active ? iso(row.current_period_end) : null,
      custom_limits: Boolean(parseOverrides(row.overrides_json)),
      videos_this_month: Number(usage.get(row.user_id)?.videos || 0),
      minutes_this_month: Math.round((Number(usage.get(row.user_id)?.seconds || 0) / 60) * 10) / 10,
      total_jobs: totals.get(row.user_id) || 0,
      credits: credits.get(row.user_id) || 0,
      is_admin: toBool(row.is_admin) || isAdminEmail(row.email),
      disabled: toBool(row.disabled),
      created_at: iso(row.created_at),
      last_seen_at: iso(row.last_seen_at),
    };
  });
  if (plan) users = users.filter((user) => user.plan === plan);
  if (status === "suspended") users = users.filter((user) => user.disabled);
  if (status === "admin") users = users.filter((user) => user.is_admin);
  if (status === "active") users = users.filter((user) => !user.disabled);
  const total = users.length;
  const start = (Math.max(1, page) - 1) * perPage;
  return { users: users.slice(start, start + perPage), total, page, per_page: perPage };
}

export async function userDetail(userId) {
  const profile = await one("SELECT * FROM profiles WHERE user_id = $1", [userId]);
  if (!profile) throw Object.assign(new Error("User not found."), { status: 404 });
  const [plan, subscription, credits, jobs, payments, teams, keys, voices, referrals, cost] = await Promise.all([
    planFor({ userId }),
    one("SELECT * FROM subscriptions WHERE user_id = $1", [userId]),
    many("SELECT * FROM credits WHERE billing_id = $1 ORDER BY id DESC LIMIT 100", [userId]),
    many("SELECT id, status, source_language, target_language, original_filename, duration_seconds, created_at, deleted_at, error_message FROM jobs WHERE user_id = $1 ORDER BY id DESC LIMIT 30", [userId]),
    many("SELECT reference, provider, kind, plan_code, credit_pack, amount, currency, status, created_at FROM payments WHERE user_id = $1 ORDER BY created_at DESC LIMIT 30", [userId]),
    many("SELECT teams.id, teams.name, team_members.role, team_members.status FROM team_members JOIN teams ON teams.id = team_members.team_id WHERE team_members.user_id = $1", [userId]),
    one("SELECT COUNT(*) AS count FROM api_keys WHERE user_id = $1 AND revoked_at IS NULL", [userId]),
    many("SELECT id, name, created_at FROM voices WHERE user_id = $1", [userId]),
    referralStats(userId),
    one("SELECT COALESCE(SUM(cost_usd), 0) AS total FROM cost_events WHERE user_id = $1", [userId]),
  ]);
  let auth = null;
  if (hasSupabaseAuth() && !userId.startsWith("local")) {
    try {
      const user = await supabaseAdmin(`/admin/users/${encodeURIComponent(userId)}`);
      auth = {
        email_confirmed: Boolean(user.email_confirmed_at), last_sign_in_at: user.last_sign_in_at || null, created_at: user.created_at,
        providers: user.app_metadata?.providers || [], banned_until: user.banned_until || null,
      };
    } catch (error) {
      auth = { error: error.message };
    }
  }
  return {
    user_id: userId,
    email: profile.email || "",
    name: profile.name || "",
    creator_type: profile.creator_type || "",
    phone: profile.phone || "",
    admin_notes: profile.admin_notes || "",
    is_admin: toBool(profile.is_admin) || isAdminEmail(profile.email),
    admin_via_env: isAdminEmail(profile.email),
    disabled: toBool(profile.disabled),
    created_at: iso(profile.created_at),
    last_seen_at: iso(profile.last_seen_at),
    referral_code: profile.referral_code,
    referred_by: profile.referred_by,
    referrals,
    auth,
    plan: plan.plan,
    usage: { videos_this_month: plan.videosThisMonth, minutes_this_month: plan.minutesThisMonth, max_videos_per_month: plan.maxVideosPerMonth },
    subscription: subscription ? {
      tier: subscription.tier, status: subscription.status, provider: subscription.provider,
      current_period_end: iso(subscription.current_period_end), cancel_at_period_end: toBool(subscription.cancel_at_period_end),
      overrides: parseOverrides(subscription.overrides_json),
    } : null,
    credits: credits.map((credit) => ({ id: Number(credit.id), max_minutes: Number(credit.max_minutes), source: credit.source, used_by_job: credit.job_id ? Number(credit.job_id) : null, created_at: iso(credit.created_at) })),
    jobs: jobs.map((job) => ({ ...job, id: Number(job.id), duration_seconds: job.duration_seconds === null ? null : Number(job.duration_seconds), created_at: iso(job.created_at), deleted: Boolean(job.deleted_at) })),
    payments: payments.map((payment) => ({ ...payment, amount: Number(payment.amount), created_at: iso(payment.created_at) })),
    teams: teams.map((team) => ({ ...team, id: Number(team.id) })),
    api_keys: Number(keys?.count || 0),
    voices: voices.map((voice) => ({ id: Number(voice.id), name: voice.name, created_at: iso(voice.created_at) })),
    total_cost_usd: Math.round(Number(cost?.total || 0) * 1000) / 1000,
  };
}

// ---------- Changes ----------
function cleanOverrides(input) {
  if (!input || typeof input !== "object") return null;
  const result = {};
  for (const field of OVERRIDE_NUMBERS) {
    if (input[field] === undefined || input[field] === null || input[field] === "") continue;
    const value = Number(input[field]);
    if (!Number.isFinite(value) || value < 0) throw new Error(`${field.replace(/_/g, " ")} must be zero or more.`);
    result[field] = Math.round(value);
  }
  for (const field of OVERRIDE_BOOLS) if (typeof input[field] === "boolean") result[field] = input[field];
  if (input.permissions && typeof input.permissions === "object") {
    const permissions = {};
    for (const key of Object.keys(PERMISSIONS)) if (typeof input.permissions[key] === "boolean") permissions[key] = input.permissions[key];
    if (Object.keys(permissions).length) result.permissions = permissions;
  }
  return Object.keys(result).length ? result : null;
}

async function ensureSubscriptionRow(userId) {
  await query(
    "INSERT INTO subscriptions (user_id, tier, status, updated_at) VALUES ($1, 'free', 'active', CURRENT_TIMESTAMP) ON CONFLICT (user_id) DO NOTHING",
    [userId],
  );
}

async function setBanned(userId, banned) {
  if (!hasSupabaseAuth() || userId.startsWith("local")) return;
  await supabaseAdmin(`/admin/users/${encodeURIComponent(userId)}`, { method: "PUT", body: { ban_duration: banned ? "876000h" : "none" } });
}

/** Applies admin edits to an account: profile, role, suspension, plan and custom limits. */
export async function updateUser(userId, changes, admin) {
  const profile = await one("SELECT * FROM profiles WHERE user_id = $1", [userId]);
  if (!profile) throw Object.assign(new Error("User not found."), { status: 404 });
  const isSelf = userId === admin.id;
  const profileChanges = {};
  for (const field of ["name", "creator_type", "phone", "admin_notes"]) {
    if (changes[field] !== undefined) profileChanges[field] = String(changes[field]).slice(0, field === "admin_notes" ? 5000 : 120);
  }
  if (changes.is_admin !== undefined) {
    if (isSelf && !changes.is_admin) throw new Error("You can't remove your own admin access.");
    profileChanges.is_admin = Boolean(changes.is_admin);
  }
  if (changes.disabled !== undefined) {
    if (isSelf) throw new Error("You can't suspend your own account.");
    profileChanges.disabled = Boolean(changes.disabled);
    await setBanned(userId, Boolean(changes.disabled));
  }
  const entries = Object.entries(profileChanges);
  if (entries.length) {
    await query(`UPDATE profiles SET ${entries.map(([key], index) => `${key} = $${index + 1}`).join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE user_id = $${entries.length + 1}`, [...entries.map(([, value]) => value), userId]);
  }
  if (changes.plan) {
    const plan = await getPlan(changes.plan);
    if (plan.code !== changes.plan) throw new Error("Unknown plan.");
    if (plan.code === "free") {
      await ensureSubscriptionRow(userId);
      await query("UPDATE subscriptions SET tier = 'free', status = 'active', provider = 'manual', current_period_end = NULL, cancel_at_period_end = $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2", [false, userId]);
    } else {
      const months = Math.min(Math.max(Number(changes.months) || 1, 1), 120);
      const end = new Date();
      end.setUTCMonth(end.getUTCMonth() + months);
      await activateSubscription(userId, plan.code, { provider: "manual", periodEnd: changes.no_expiry ? new Date("2999-01-01T00:00:00Z") : end });
    }
  }
  if (changes.overrides !== undefined) {
    await ensureSubscriptionRow(userId);
    const overrides = cleanOverrides(changes.overrides);
    await query("UPDATE subscriptions SET overrides_json = $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2", [overrides ? JSON.stringify(overrides) : null, userId]);
  }
  return userDetail(userId);
}

/** Creates a login in Supabase (with a password, or by emailing an invite) and optionally puts it on a plan. */
export async function createUser({ email, password, name, plan = "free", months = 1, invite = false }, admin) {
  const address = String(email || "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) throw new Error("Enter a valid email address.");
  if (await one("SELECT user_id FROM profiles WHERE LOWER(email) = $1", [address])) throw new Error("An account with that email already exists.");
  let userId;
  let temporaryPassword = null;
  if (hasSupabaseAuth()) {
    if (invite) {
      const user = await supabaseAdmin("/invite", { method: "POST", body: { email: address, data: { full_name: name || "" } } });
      userId = user.id;
    } else {
      temporaryPassword = password && String(password).length >= 8 ? null : randomBytes(9).toString("base64url");
      const user = await supabaseAdmin("/admin/users", {
        method: "POST",
        body: { email: address, password: password && String(password).length >= 8 ? String(password) : temporaryPassword, email_confirm: true, user_metadata: { full_name: name || "" } },
      });
      userId = user.id;
    }
  } else {
    userId = `local-${randomUUID()}`;
  }
  await ensureProfile(userId, address);
  if (name) await query("UPDATE profiles SET name = $1 WHERE user_id = $2", [String(name).slice(0, 80), userId]);
  if (plan && plan !== "free") await updateUser(userId, { plan, months }, admin);
  return { user: await userDetail(userId), temporary_password: temporaryPassword, invited: Boolean(invite && hasSupabaseAuth()) };
}

/** Permanently removes an account: its projects and files, voices, keys, team memberships, and the Supabase login. */
export async function deleteUser(userId, admin) {
  if (userId === admin.id) throw new Error("You can't delete your own account from here.");
  const profile = await one("SELECT * FROM profiles WHERE user_id = $1", [userId]);
  if (!profile) throw Object.assign(new Error("User not found."), { status: 404 });
  try {
    await cancelSubscription(userId);
  } catch {
    // No paid subscription, or the provider already cancelled it.
  }
  for (const row of await many("SELECT id FROM jobs WHERE user_id = $1", [userId])) {
    const job = await getJob(Number(row.id));
    try {
      await purgeJob(job, { hard: true });
    } catch (error) {
      logger.warn({ err: error, jobId: job.id }, "Could not delete job files during account deletion");
    }
  }
  for (const voice of await many("SELECT provider_voice_id FROM voices WHERE user_id = $1", [userId])) await deleteVoice(voice.provider_voice_id);
  const owned = await many("SELECT id FROM teams WHERE owner_id = $1", [userId]);
  for (const team of owned) await deleteTeam(Number(team.id));
  for (const statement of [
    "DELETE FROM voices WHERE user_id = $1", "DELETE FROM glossary_terms WHERE user_id = $1", "DELETE FROM api_keys WHERE user_id = $1",
    "DELETE FROM integrations WHERE user_id = $1", "DELETE FROM team_members WHERE user_id = $1", "DELETE FROM credits WHERE billing_id = $1",
    "DELETE FROM subscriptions WHERE user_id = $1", "DELETE FROM profiles WHERE user_id = $1",
  ]) await query(statement, [userId]);
  if (hasSupabaseAuth() && !userId.startsWith("local")) {
    try {
      await supabaseAdmin(`/admin/users/${encodeURIComponent(userId)}`, { method: "DELETE" });
    } catch (error) {
      if (!/not found/i.test(error.message)) throw error;
    }
  }
  return { deleted: true, email: profile.email };
}

export async function grantCredits(billingId, maxMinutes, count = 1) {
  const minutes = Number(maxMinutes);
  const times = Math.min(Math.max(Number(count) || 1, 1), 100);
  if (!Number.isInteger(minutes) || minutes <= 0) throw new Error("Credit length must be a whole number of minutes.");
  for (let index = 0; index < times; index += 1) await grantCredit(billingId, minutes, "admin");
  return times;
}

export async function revokeCredit(creditId) {
  const result = await query("DELETE FROM credits WHERE id = $1 AND job_id IS NULL", [creditId]);
  if (!result.rowCount) throw new Error("That credit doesn't exist or was already used.");
}

export async function emailUser(userId, subject, message) {
  const profile = await one("SELECT email, name FROM profiles WHERE user_id = $1", [userId]);
  if (!profile?.email) throw new Error("This user has no email address.");
  if (!config.resendApiKey) throw new Error("Email isn't set up yet. Add RESEND_API_KEY to backend/.env (see the notes in that file).");
  const text = String(message || "").trim();
  if (!subject || !text) throw new Error("Write a subject and a message.");
  await sendEmail({
    userId, operation: "admin_message",
    to: profile.email,
    subject: String(subject).slice(0, 200),
    text,
    html: `<div style="font-family:Arial,sans-serif;max-width:560px;color:#16124f;line-height:1.55">${text.split(/\n{2,}/).map((part) => `<p>${part.replace(/[&<>]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[char]).replace(/\n/g, "<br>")}</p>`).join("")}<p style="color:#6b6980;font-size:12px">— The ReelLingo team</p></div>`,
  });
}

// ---------- Teams & payments ----------
export async function listAllTeams() {
  const teams = await many("SELECT teams.*, profiles.email AS owner_email FROM teams LEFT JOIN profiles ON profiles.user_id = teams.owner_id ORDER BY teams.id DESC");
  const members = new Map((await many("SELECT team_id, COUNT(*) AS count FROM team_members GROUP BY team_id")).map((row) => [Number(row.team_id), Number(row.count)]));
  const subscriptions = new Map((await many("SELECT user_id, tier FROM subscriptions WHERE user_id LIKE 'team:%'")).map((row) => [row.user_id, row.tier]));
  return teams.map((team) => ({
    id: Number(team.id), name: team.name, owner_id: team.owner_id, owner_email: team.owner_email || "",
    members: members.get(Number(team.id)) || 0, plan: subscriptions.get(`team:${team.id}`) || "free", created_at: iso(team.created_at),
  }));
}

export async function deleteTeam(teamId) {
  for (const row of await many("SELECT id FROM jobs WHERE team_id = $1", [teamId])) {
    const job = await getJob(Number(row.id));
    await purgeJob(job, { hard: true }).catch((error) => logger.warn({ err: error }, "Could not delete team job files"));
  }
  const billingId = `team:${teamId}`;
  await query("DELETE FROM team_members WHERE team_id = $1", [teamId]);
  await query("DELETE FROM credits WHERE billing_id = $1", [billingId]);
  await query("DELETE FROM subscriptions WHERE user_id = $1", [billingId]);
  await query("DELETE FROM teams WHERE id = $1", [teamId]);
}

export async function listAllPayments({ status = "", limit = 200 } = {}) {
  const rows = status
    ? await many("SELECT payments.*, profiles.email FROM payments LEFT JOIN profiles ON profiles.user_id = payments.user_id WHERE payments.status = $1 ORDER BY payments.created_at DESC LIMIT $2", [status, limit])
    : await many("SELECT payments.*, profiles.email FROM payments LEFT JOIN profiles ON profiles.user_id = payments.user_id ORDER BY payments.created_at DESC LIMIT $1", [limit]);
  return rows.map((row) => ({
    reference: row.reference, user_id: row.user_id, email: row.email || "", billing_id: row.billing_id, provider: row.provider, kind: row.kind,
    plan_code: row.plan_code, credit_pack: row.credit_pack, amount: Number(row.amount), currency: row.currency, status: row.status, created_at: iso(row.created_at),
  }));
}
