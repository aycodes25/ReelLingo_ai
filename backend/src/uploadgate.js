import { getProfile, isAdminUser, planFor } from "./accounts.js";
import { config } from "./config.js";
import { many, one, query } from "./db.js";
import { freeTierStatus } from "./minutes.js";
import { getMembership } from "./teams.js";
import { userBudgetStatus } from "./usage.js";

/**
 * Decides whether someone may start sending a file at all. It runs before the file is accepted, so a suspended
 * account, an empty balance or a paused free tier can't use up the server's disk and bandwidth first.
 * Returns null when the upload may go ahead, or { status, detail, code } explaining why not.
 */
export async function uploadBlocker({ user, teamId = null }) {
  const profile = await getProfile(user.id);
  if (isAdminUser(user, profile)) return null;
  if (profile?.disabled) {
    return { status: 403, detail: `Your account has been suspended. Contact ${config.supportEmail} if you think this is a mistake.`, code: "suspended" };
  }
  if (config.maintenanceMode) return { status: 503, detail: config.maintenanceMessage, code: "maintenance" };

  const plan = await planFor({ userId: user.id, teamId });
  if (plan.minutes.available < 0.1) {
    return { status: 402, detail: "You've used all your minutes. Buy more minutes or upgrade to continue.", code: "minutes", needed: 0.1, available: plan.minutes.available };
  }
  if (plan.tier === "free") {
    if (config.requireConfirmedEmail && user.emailConfirmed === false) {
      return { status: 403, detail: "Confirm your email address (check your inbox) to use free dubbing.", code: "confirm_email" };
    }
    if ((await freeTierStatus()).paused) {
      return { status: 402, detail: "Free dubbing is paused for the rest of this month because so many people are using it. Choose a plan or buy minutes to continue right away.", code: "free_paused" };
    }
  }
  const budget = await userBudgetStatus(user.id);
  if (budget?.exceeded) {
    return { status: 402, detail: `You've reached your usage limit for this month. Contact ${config.supportEmail} to raise it.`, code: "budget" };
  }
  return null;
}

/** The team a request works in, from the X-Workspace header (null = the person's own account). */
export async function teamFromHeader(value, userId) {
  if (!value || value === "personal" || !config.featureTeams) return null;
  const teamId = Number(value);
  return Number.isInteger(teamId) && await getMembership(teamId, userId) ? teamId : null;
}

// Resumable uploads started per person this hour. The count lives in the database (app_settings rows named
// "uploads:<user>:<hour>"), so every server and worker shares it and a restart doesn't reset it.
const COUNTER_PREFIX = "uploads:";

/** Counts this upload and returns true when the person has started too many this hour. */
export async function uploadsExceeded(userId, now = Date.now()) {
  const key = `${COUNTER_PREFIX}${userId}:${Math.floor(now / 3600000)}`;
  const row = await one(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, '1', CURRENT_TIMESTAMP)
     ON CONFLICT (key) DO UPDATE SET value = CAST(CAST(app_settings.value AS INTEGER) + 1 AS TEXT), updated_at = CURRENT_TIMESTAMP
     RETURNING value`,
    [key],
  );
  return Number(row?.value || 1) > config.uploadsPerHour;
}

/** Deletes the hourly counters older than a couple of hours (called from the worker's hourly cleanup). */
export async function purgeUploadCounters(now = Date.now()) {
  const current = Math.floor(now / 3600000);
  const rows = await many("SELECT key FROM app_settings WHERE key LIKE $1", [`${COUNTER_PREFIX}%`]);
  let removed = 0;
  for (const row of rows) {
    if (Number(String(row.key).split(":").pop()) < current - 1) {
      await query("DELETE FROM app_settings WHERE key = $1", [row.key]);
      removed += 1;
    }
  }
  return removed;
}

export async function resetUploadCounts() {
  await query("DELETE FROM app_settings WHERE key LIKE $1", [`${COUNTER_PREFIX}%`]);
}
