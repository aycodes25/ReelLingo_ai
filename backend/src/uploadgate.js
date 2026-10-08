import { getProfile, isAdminUser, planFor } from "./accounts.js";
import { config } from "./config.js";
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

// Resumable uploads started per person in the last hour. Kept in memory: it is a brake, not a bill.
const started = new Map();

/** True when this person has started too many uploads in the last hour (and counts this one if not). */
export function uploadsExceeded(userId, now = Date.now()) {
  const recent = (started.get(userId) || []).filter((time) => now - time < 3600 * 1000);
  if (recent.length >= config.uploadsPerHour) {
    started.set(userId, recent);
    return true;
  }
  recent.push(now);
  started.set(userId, recent);
  if (started.size > 20000) started.delete(started.keys().next().value);
  return false;
}

export function resetUploadCounts() {
  started.clear();
}
