import { createHash, randomUUID } from "node:crypto";
import { config } from "./config.js";
import { dbTime, many, one, query, withDbLock } from "./db.js";

/**
 * Minutes are ReelLingo's single unit of value: 1 minute = 1 minute of video dubbed into 1 language.
 *
 * Two buckets per billing account (a user, or a team):
 *  - "plan":  the plan's monthly allowance. It resets every month on the subscriber's own billing day
 *             (free users: the 1st of the month), so buying on the 28th can't double up on the 1st.
 *  - "topup": minutes bought in packs, referral rewards and admin grants. They never expire.
 * Spending always uses plan minutes first. Every change is a row in minute_ledger, so balances can be audited.
 */

/** How long a paid plan stays active after its period ends, to give a late renewal time to arrive. */
export const SUBSCRIPTION_GRACE_MS = 3 * 24 * 3600 * 1000;

const round1 = (value) => Math.round(Number(value || 0) * 10) / 10;
const ceil1 = (value) => Math.ceil(Number(value || 0) * 10 - 1e-9) / 10;

/** How many minutes one target language of a job uses. Weights are set in Admin → Settings → Pricing. */
export function jobMinutes({ durationSeconds, mode = "dub", lipSync = false, humanReview = false }) {
  const minutes = Math.max(0, Number(durationSeconds || 0)) / 60;
  if (!minutes) return 0;
  const weights = config.minuteWeights;
  let total = minutes * (mode === "subtitles" ? weights.subtitles : 1);
  if (lipSync && mode !== "subtitles") total += minutes * weights.lipSync;
  if (humanReview) total += minutes * weights.humanReview;
  return Math.max(0.1, ceil1(total));
}

/** The longest video (in seconds) that a given number of minutes can pay for, per target language. */
export function secondsAffordable(available, perMinuteWeight) {
  if (perMinuteWeight <= 0) return Infinity;
  return Math.floor((Math.max(0, available) / perMinuteWeight) * 60);
}

export function perMinuteWeight({ mode = "dub", lipSync = false, humanReview = false }) {
  const weights = config.minuteWeights;
  return (mode === "subtitles" ? weights.subtitles : 1) + (lipSync && mode !== "subtitles" ? weights.lipSync : 0) + (humanReview ? weights.humanReview : 0);
}

/** The anchor's day and time of day in a given month (the 31st becomes the month's last day). */
function anchoredDate(anchor, year, month) {
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(anchor.getUTCDate(), lastDay), anchor.getUTCHours(), anchor.getUTCMinutes(), anchor.getUTCSeconds()));
}

/**
 * The current allowance month. Paid plans renew on the day the subscription renews (monthly and yearly plans alike);
 * everyone else uses the calendar month.
 */
export function allowanceWindow(periodEnd, now = new Date()) {
  if (periodEnd) {
    const end = new Date(periodEnd);
    if (!Number.isNaN(end.getTime()) && end > now) {
      const year = now.getUTCFullYear();
      let month = now.getUTCMonth();
      let start = anchoredDate(end, year, month);
      if (start > now) {
        month -= 1;
        start = anchoredDate(end, year, month);
      }
      const next = anchoredDate(end, year, month + 1);
      return { start, end: next < end ? next : end };
    }
    // Renewal is late but the plan is still active (grace period): stay in the last allowance month.
    // Switching to the calendar month here would forget what was already spent and hand out a fresh allowance.
    if (!Number.isNaN(end.getTime()) && now.getTime() - end.getTime() <= SUBSCRIPTION_GRACE_MS) {
      return { start: anchoredDate(end, end.getUTCFullYear(), end.getUTCMonth() - 1), end };
    }
  }
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return { start, end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)) };
}

// One balance change at a time per account, so two uploads can't both spend the same minutes. The in-process queue
// keeps one request per account waiting on the database; the database lock covers other servers and the worker.
const locks = new Map();
export async function withAccountLock(billingId, task) {
  const previous = locks.get(billingId) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  const chained = previous.then(() => current);
  locks.set(billingId, chained);
  await previous;
  try {
    return await withDbLock(`minutes:${billingId}`, task);
  } finally {
    release();
    if (locks.get(billingId) === chained) locks.delete(billingId);
  }
}

/** Old pay-as-you-go credits (one video each) become never-expiring top-up minutes the first time an account is seen. */
async function convertLegacyCredits(billingId) {
  const rows = await many("SELECT id, max_minutes FROM credits WHERE billing_id = $1 AND job_id IS NULL", [billingId]);
  for (const row of rows) {
    const claimed = await query("UPDATE credits SET job_id = $1 WHERE id = $2 AND job_id IS NULL", [0, row.id]);
    if (claimed.rowCount) {
      await query(
        "INSERT INTO minute_ledger (billing_id, delta, bucket, kind, reference, note) VALUES ($1, $2, 'topup', 'legacy_credit', $3, $4)",
        [billingId, Number(row.max_minutes), `credit:${row.id}`, "Converted from a pay-as-you-go video credit"],
      );
    }
  }
}

/** Minutes left for an account: the plan allowance for this month plus never-expiring top-ups. */
export async function minuteBalance(billingId, { allowance = 0, periodEnd = null, now = new Date() } = {}) {
  await convertLegacyCredits(billingId);
  const window = allowanceWindow(periodEnd, now);
  const [planRow, topupRow] = await Promise.all([
    one("SELECT COALESCE(SUM(delta), 0) AS total FROM minute_ledger WHERE billing_id = $1 AND bucket = 'plan' AND created_at >= $2", [billingId, dbTime(window.start)]),
    one("SELECT COALESCE(SUM(delta), 0) AS total FROM minute_ledger WHERE billing_id = $1 AND bucket = 'topup'", [billingId]),
  ]);
  const planUsed = round1(Math.max(0, -Number(planRow?.total || 0)));
  const planLeft = round1(Math.max(0, allowance - planUsed));
  const topupLeft = round1(Number(topupRow?.total || 0));
  return {
    plan_allowance: allowance,
    plan_used: planUsed,
    plan_left: planLeft,
    topup_left: topupLeft,
    available: round1(planLeft + Math.max(0, topupLeft)),
    resets_at: window.end.toISOString(),
    period_start: window.start.toISOString(),
  };
}

export class NotEnoughMinutes extends Error {
  constructor(needed, available) {
    super(`This needs ${needed} minute${needed === 1 ? "" : "s"} but you have ${available} left. Buy more minutes or upgrade your plan.`);
    this.code = "minutes";
    this.needed = needed;
    this.available = available;
  }
}

async function spend(billingId, minutes, { balance, kind, jobId, run, force }) {
  if (minutes <= 0) return;
  if (!force && minutes > balance.available + 1e-9) throw new NotEnoughMinutes(minutes, balance.available);
  const fromPlan = round1(Math.min(minutes, balance.plan_left));
  const fromTopup = round1(minutes - fromPlan);
  if (fromPlan > 0) {
    await query("INSERT INTO minute_ledger (billing_id, delta, bucket, kind, job_id, reference) VALUES ($1, $2, 'plan', $3, $4, $5)", [billingId, -fromPlan, kind, jobId, run]);
  }
  if (fromTopup > 0) {
    await query("INSERT INTO minute_ledger (billing_id, delta, bucket, kind, job_id, reference) VALUES ($1, $2, 'topup', $3, $4, $5)", [billingId, -fromTopup, kind, jobId, run]);
  }
}

/** A new chargeable run of a job (first dub, re-dub, short clips…). Stored on the job so retries and refunds find it. */
export function newCharge(minutes, kind) {
  return { minutes: round1(minutes), kind, run: randomUUID() };
}

/**
 * Makes sure the job's current run is paid for. Safe to call repeatedly: it only charges what's missing,
 * e.g. after a failed attempt was refunded and the creator presses Retry.
 */
export async function ensureCharged(job, { billingId, allowance, periodEnd, force = false }) {
  const charge = job.options_json?.charge;
  if (!charge?.run || !charge.minutes) return { charged: 0 };
  return withAccountLock(billingId, async () => {
    const paid = await one("SELECT COALESCE(SUM(delta), 0) AS total FROM minute_ledger WHERE job_id = $1 AND reference = $2", [job.id, charge.run]);
    const missing = round1(charge.minutes + Number(paid?.total || 0));
    if (missing <= 0) return { charged: 0 };
    const balance = await minuteBalance(billingId, { allowance, periodEnd });
    await spend(billingId, missing, { balance, kind: charge.kind, jobId: job.id, run: charge.run, force });
    return { charged: missing };
  });
}

/** Gives back everything the job's current run spent (the job failed, was cancelled or deleted before finishing). */
export async function refundRun(job, { reason = "refund" } = {}) {
  const charge = job.options_json?.charge;
  if (!charge?.run) return 0;
  const rows = await many(
    "SELECT billing_id, bucket, SUM(delta) AS total, MIN(created_at) AS spent_at FROM minute_ledger WHERE job_id = $1 AND reference = $2 GROUP BY billing_id, bucket",
    [job.id, charge.run],
  );
  // Never give back more than the run still owes: part of it may already have been returned (e.g. a human review
  // that timed out). Extra minutes are returned before plan minutes.
  let owed = round1(-rows.reduce((sum, row) => sum + Number(row.total || 0), 0));
  let refunded = 0;
  const ordered = [...rows].sort((first, second) => (first.bucket === "topup" ? -1 : 1) - (second.bucket === "topup" ? -1 : 1));
  for (const row of ordered) {
    const amount = round1(Math.min(owed, -Number(row.total || 0)));
    if (amount <= 0) continue;
    owed = round1(owed - amount);
    // Plan minutes go back to the plan only while it's still the same allowance month; after that they come back
    // as top-up minutes, because a new month's allowance would otherwise swallow them.
    let bucket = row.bucket;
    if (bucket === "plan") {
      const subscription = await one("SELECT current_period_end FROM subscriptions WHERE user_id = $1", [row.billing_id]);
      const window = allowanceWindow(subscription?.current_period_end || null);
      if (new Date(row.spent_at instanceof Date ? row.spent_at : `${String(row.spent_at).replace(" ", "T")}${/Z|[+-]\d\d:?\d\d$/.test(String(row.spent_at)) ? "" : "Z"}`) < window.start) bucket = "topup";
    }
    await query(
      "INSERT INTO minute_ledger (billing_id, delta, bucket, kind, job_id, reference, note) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      [row.billing_id, amount, bucket, reason, job.id, charge.run, "Returned because the job didn't finish"],
    );
    refunded += amount;
  }
  return round1(refunded);
}

/**
 * True once paid provider work (transcription, translation, voice…) has been recorded for the job's current run.
 * From then on the money is already spent, so deleting the project doesn't give the minutes back.
 */
export async function runHasCost(job) {
  const charge = job.options_json?.charge;
  if (!charge?.run) return false;
  const spent = await one("SELECT MIN(created_at) AS at FROM minute_ledger WHERE job_id = $1 AND reference = $2 AND delta < 0", [job.id, charge.run]);
  if (!spent?.at) return false;
  const work = await one("SELECT COUNT(*) AS count FROM cost_events WHERE job_id = $1 AND created_at >= $2", [job.id, spent.at]);
  return Number(work?.count || 0) > 0;
}

/** Adds never-expiring minutes (packs, referral rewards, admin grants). Negative amounts remove minutes. */
export async function grantMinutes(billingId, minutes, kind, { reference = null, note = null, createdBy = null } = {}) {
  const amount = round1(minutes);
  if (!amount) throw new Error("Enter a number of minutes.");
  await query(
    "INSERT INTO minute_ledger (billing_id, delta, bucket, kind, reference, note, created_by) VALUES ($1, $2, 'topup', $3, $4, $5, $6)",
    [billingId, amount, kind, reference, note, createdBy],
  );
  return amount;
}

/** True if this reference already granted minutes (payments are fulfilled by both the callback page and the webhook). */
export async function alreadyGranted(reference) {
  return Boolean(await one("SELECT id FROM minute_ledger WHERE reference = $1 AND delta > 0 LIMIT 1", [reference]));
}

export async function ledgerFor(billingId, limit = 100) {
  return (await many("SELECT * FROM minute_ledger WHERE billing_id = $1 ORDER BY id DESC LIMIT $2", [billingId, limit])).map((row) => ({
    id: Number(row.id),
    delta: Number(row.delta),
    bucket: row.bucket,
    kind: row.kind,
    job_id: row.job_id === null || row.job_id === undefined ? null : Number(row.job_id),
    reference: row.reference || null,
    note: row.note || null,
    created_by: row.created_by || null,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  }));
}

/** What free users have cost this month (US$), for the free-tier budget in Admin → Settings → Pricing. */
export async function freeTierSpendThisMonth(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const row = await one(
    "SELECT COALESCE(SUM(cost_events.cost_usd), 0) AS total FROM cost_events JOIN jobs ON jobs.id = cost_events.job_id WHERE jobs.plan_code = 'free' AND cost_events.created_at >= $1",
    [dbTime(start)],
  );
  return Math.round(Number(row?.total || 0) * 100) / 100;
}

export async function freeTierStatus() {
  const spent = await freeTierSpendThisMonth();
  const budget = Number(config.freeMonthlyBudgetUsd);
  return { spent_usd: spent, budget_usd: budget, paused: budget <= 0 || spent >= budget };
}

/** Short fingerprint of a dubbed line, so a re-dub is charged only for the lines that changed. */
export function lineHash(text) {
  return createHash("sha1").update(String(text || "").trim()).digest("hex").slice(0, 10);
}

/**
 * Minutes a re-dub uses: the share of the voice that has to be generated again (edited lines only),
 * plus lip-sync for the whole video when it's switched on (lip-sync always redoes the full video).
 */
export function redubMinutes(job, options = job.options_json || {}) {
  const minutes = Number(job.duration_seconds || 0) / 60;
  if (!minutes || options.mode === "subtitles") return 0;
  const segments = job.translated_segments_json || [];
  const hashes = Array.isArray(job.options_json?.dubbed_hashes) ? job.options_json.dubbed_hashes : null;
  const total = segments.reduce((sum, segment) => sum + String(segment.text || "").length, 0) || 1;
  const changed = segments.reduce((sum, segment, index) => sum + (!hashes || hashes[index] !== lineHash(segment.text) ? String(segment.text || "").length : 0), 0);
  let charge = minutes * (changed / total);
  if (options.lip_sync) charge += minutes * config.minuteWeights.lipSync;
  return charge > 0 ? Math.max(0.1, ceil1(charge)) : 0;
}
