import { config } from "./config.js";
import { getJob, updateJob } from "./database.js";
import { dbTime, many, one, query, toBool } from "./db.js";
import { getLanguage } from "./languages.js";
import { logger } from "./logger.js";
import { notifyJob } from "./notify.js";

/**
 * Human review: a native speaker checks the transcript and translation before the voice is generated.
 * Creators pay for it in minutes (Admin → Settings → Pricing); reviewers earn a fixed ₦ amount per minute of video,
 * which the admin pays out and marks as paid in Admin → Reviewers.
 */

const round1 = (value) => Math.round(Number(value || 0) * 10) / 10;

function iso(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const text = String(value);
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text) ? `${text.replace(" ", "T")}Z` : text;
}

function normalizeTask(row) {
  return {
    id: Number(row.id),
    job_id: Number(row.job_id),
    language: row.language,
    language_name: getLanguage(row.language)?.name || row.language,
    status: row.status,
    reviewer_id: row.reviewer_id || null,
    minutes: round1(row.minutes),
    payout_ngn: Number(row.payout_ngn || 0),
    claimed_at: iso(row.claimed_at),
    submitted_at: iso(row.submitted_at),
    paid_at: iso(row.paid_at),
    notes: row.notes || null,
    created_at: iso(row.created_at),
  };
}

export function reviewerLanguages(profile) {
  return String(profile?.reviewer_languages || "").split(",").map((code) => code.trim()).filter(Boolean);
}

export async function reviewerProfile(userId) {
  const profile = await one("SELECT user_id, email, name, is_reviewer, reviewer_languages FROM profiles WHERE user_id = $1", [userId]);
  if (!profile || !toBool(profile.is_reviewer)) return null;
  return { user_id: profile.user_id, email: profile.email || "", name: profile.name || "", languages: reviewerLanguages(profile) };
}

/** Opens a review task for a job (once). The job waits until a reviewer submits it or the wait times out. */
export async function openReviewTask(job) {
  const existing = await one("SELECT id FROM review_tasks WHERE job_id = $1 AND status IN ('open', 'claimed')", [job.id]);
  if (existing) return Number(existing.id);
  const minutes = round1(Number(job.duration_seconds || 0) / 60);
  const row = await one(
    "INSERT INTO review_tasks (job_id, language, status, minutes, payout_ngn) VALUES ($1, $2, 'open', $3, $4) RETURNING id",
    [job.id, job.target_language, minutes, Math.round(minutes * config.reviewerPayNgnPerMinute)],
  );
  return Number(row.id);
}

/** Tasks a reviewer may pick up (their languages) plus the ones they're working on. */
export async function tasksForReviewer(reviewer) {
  const languages = reviewer.languages;
  const open = languages.length
    ? await many(`SELECT * FROM review_tasks WHERE status = 'open' AND language IN (${languages.map((_, index) => `$${index + 1}`).join(", ")}) ORDER BY id`, languages)
    : [];
  const mine = await many("SELECT * FROM review_tasks WHERE reviewer_id = $1 ORDER BY id DESC LIMIT 100", [reviewer.user_id]);
  const withJob = async (row) => {
    const task = normalizeTask(row);
    const job = await getJob(task.job_id);
    return {
      ...task,
      job: job ? {
        id: Number(job.id), source_language: job.source_language, target_language: job.target_language,
        duration_seconds: job.duration_seconds === null ? null : Number(job.duration_seconds), original_filename: job.original_filename || null,
        lines: job.translated_segments_json?.length || 0,
      } : null,
    };
  };
  return { open: await Promise.all(open.map(withJob)), mine: await Promise.all(mine.map(withJob)) };
}

export async function claimTask(taskId, reviewer) {
  const task = await one("SELECT * FROM review_tasks WHERE id = $1", [taskId]);
  if (!task) throw Object.assign(new Error("Review not found."), { status: 404 });
  if (!reviewer.languages.includes(task.language)) throw Object.assign(new Error("This review is in a language you don't review."), { status: 403 });
  const claimed = await query("UPDATE review_tasks SET status = 'claimed', reviewer_id = $1, claimed_at = CURRENT_TIMESTAMP WHERE id = $2 AND status = 'open'", [reviewer.user_id, taskId]);
  if (!claimed.rowCount) throw Object.assign(new Error("Another reviewer already picked this one up."), { status: 409 });
  return normalizeTask(await one("SELECT * FROM review_tasks WHERE id = $1", [taskId]));
}

export async function releaseTask(taskId, reviewer) {
  const released = await query("UPDATE review_tasks SET status = 'open', reviewer_id = NULL, claimed_at = NULL WHERE id = $1 AND reviewer_id = $2 AND status = 'claimed'", [taskId, reviewer.user_id]);
  if (!released.rowCount) throw Object.assign(new Error("You aren't working on this review."), { status: 409 });
}

/** True when this user is the reviewer currently working on the job (gives them access to edit its lines). */
export async function isReviewingJob(userId, jobId) {
  return Boolean(await one("SELECT id FROM review_tasks WHERE job_id = $1 AND reviewer_id = $2 AND status = 'claimed'", [jobId, userId]));
}

/** After a human review the job continues: to the creator's own review if they asked for one, otherwise to dubbing. */
async function continueAfterHumanReview(job, note = null) {
  const ownReview = Boolean(job.options_json?.review);
  const options = note ? { ...job.options_json, review_note: note } : job.options_json;
  if (ownReview) {
    const updated = await updateJob(job.id, { status: "awaiting_review", current_step: "review", review_state: "pending", options_json: options });
    await notifyJob(updated, "review").catch(() => undefined);
    return updated;
  }
  return updateJob(job.id, { status: "queued", current_step: "queued", review_state: "approved", attempts: 0, options_json: options });
}

export async function submitTask(taskId, reviewer, notes = "") {
  const task = await one("SELECT * FROM review_tasks WHERE id = $1 AND reviewer_id = $2 AND status = 'claimed'", [taskId, reviewer.user_id]);
  if (!task) throw Object.assign(new Error("You aren't working on this review."), { status: 409 });
  const job = await getJob(Number(task.job_id));
  if (!job || job.review_state !== "human_pending") throw Object.assign(new Error("This project is no longer waiting for review."), { status: 409 });
  await query("UPDATE review_tasks SET status = 'submitted', submitted_at = CURRENT_TIMESTAMP, notes = $1 WHERE id = $2", [String(notes || "").slice(0, 2000) || null, taskId]);
  await continueAfterHumanReview({ ...job, options_json: { ...job.options_json, human_reviewed_at: new Date().toISOString() } });
  return normalizeTask(await one("SELECT * FROM review_tasks WHERE id = $1", [taskId]));
}

export async function reviewerEarnings(reviewerId) {
  const rows = await many("SELECT status, COUNT(*) AS count, COALESCE(SUM(minutes), 0) AS minutes, COALESCE(SUM(payout_ngn), 0) AS payout FROM review_tasks WHERE reviewer_id = $1 GROUP BY status", [reviewerId]);
  const by = Object.fromEntries(rows.map((row) => [row.status, { count: Number(row.count), minutes: round1(row.minutes), payout_ngn: Number(row.payout) }]));
  return { owed_ngn: by.submitted?.payout_ngn || 0, paid_ngn: by.paid?.payout_ngn || 0, reviews: (by.submitted?.count || 0) + (by.paid?.count || 0), rate_ngn_per_minute: config.reviewerPayNgnPerMinute };
}

// ---------- Admin ----------

export async function adminReviewOverview() {
  const tasks = (await many("SELECT * FROM review_tasks ORDER BY id DESC LIMIT 300")).map(normalizeTask);
  const reviewers = await many("SELECT user_id, email, name, reviewer_languages FROM profiles WHERE is_reviewer = $1 ORDER BY email", [true]);
  const totals = new Map((await many(
    "SELECT reviewer_id, status, COUNT(*) AS count, COALESCE(SUM(payout_ngn), 0) AS payout FROM review_tasks WHERE reviewer_id IS NOT NULL GROUP BY reviewer_id, status",
  )).map((row) => [`${row.reviewer_id}:${row.status}`, { count: Number(row.count), payout: Number(row.payout) }]));
  const emails = new Map(reviewers.map((row) => [row.user_id, row.email]));
  return {
    rate_ngn_per_minute: config.reviewerPayNgnPerMinute,
    timeout_hours: config.humanReviewTimeoutHours,
    reviewers: reviewers.map((row) => ({
      user_id: row.user_id, email: row.email || "", name: row.name || "", languages: reviewerLanguages(row),
      done: (totals.get(`${row.user_id}:submitted`)?.count || 0) + (totals.get(`${row.user_id}:paid`)?.count || 0),
      in_progress: totals.get(`${row.user_id}:claimed`)?.count || 0,
      owed_ngn: totals.get(`${row.user_id}:submitted`)?.payout || 0,
      paid_ngn: totals.get(`${row.user_id}:paid`)?.payout || 0,
    })),
    tasks: tasks.map((task) => ({ ...task, reviewer_email: task.reviewer_id ? emails.get(task.reviewer_id) || task.reviewer_id : null })),
  };
}

/** Marks every submitted review of a reviewer as paid (after the admin has sent the money). */
export async function markReviewerPaid(reviewerId) {
  const result = await query("UPDATE review_tasks SET status = 'paid', paid_at = CURRENT_TIMESTAMP WHERE reviewer_id = $1 AND status = 'submitted'", [reviewerId]);
  return { tasks: result.rowCount };
}

export async function setReviewer(userId, { isReviewer, languages = [] }) {
  const valid = [...new Set(languages.map(String).filter((code) => getLanguage(code) && code !== "auto"))];
  if (isReviewer && !valid.length) throw new Error("Choose at least one language this reviewer checks.");
  const updated = await query("UPDATE profiles SET is_reviewer = $1, reviewer_languages = $2, updated_at = CURRENT_TIMESTAMP WHERE user_id = $3", [Boolean(isReviewer), isReviewer ? valid.join(",") : null, userId]);
  if (!updated.rowCount) throw Object.assign(new Error("User not found."), { status: 404 });
  if (!isReviewer) await query("UPDATE review_tasks SET status = 'open', reviewer_id = NULL, claimed_at = NULL WHERE reviewer_id = $1 AND status = 'claimed'", [userId]);
}

/**
 * Hourly: reviews nobody picked up in time continue without review and the review minutes are refunded;
 * reviews a reviewer claimed but abandoned go back to the queue.
 */
export async function expireStaleReviews(now = new Date()) {
  const cutoff = dbTime(new Date(now.getTime() - config.humanReviewTimeoutHours * 3600 * 1000));
  await query("UPDATE review_tasks SET status = 'open', reviewer_id = NULL, claimed_at = NULL WHERE status = 'claimed' AND claimed_at < $1", [cutoff]);
  const stale = await many("SELECT * FROM review_tasks WHERE status = 'open' AND created_at < $1", [cutoff]);
  let expired = 0;
  for (const task of stale) {
    const claimed = await query("UPDATE review_tasks SET status = 'expired' WHERE id = $1 AND status = 'open'", [task.id]);
    if (!claimed.rowCount) continue;
    const job = await getJob(Number(task.job_id));
    if (!job || job.review_state !== "human_pending") continue;
    try {
      await refundReviewMinutes(job);
      await continueAfterHumanReview(
        { ...job, options_json: { ...job.options_json, human_review: false } },
        "No reviewer was free in time, so this project continued without human review and the review minutes were refunded.",
      );
      expired += 1;
    } catch (error) {
      logger.warn({ err: error, jobId: job.id }, "Could not continue a project after its review expired");
    }
  }
  return expired;
}

/** Gives back only the human-review part of a job's minutes (the dubbing itself still goes ahead). */
async function refundReviewMinutes(job) {
  const charge = job.options_json?.charge;
  if (!charge?.run) return 0;
  const minutes = Math.ceil((Number(job.duration_seconds || 0) / 60) * config.minuteWeights.humanReview * 10) / 10;
  if (minutes <= 0) return 0;
  const billing = await one("SELECT billing_id FROM minute_ledger WHERE job_id = $1 AND reference = $2 LIMIT 1", [job.id, charge.run]);
  if (!billing) return 0;
  await query(
    "INSERT INTO minute_ledger (billing_id, delta, bucket, kind, job_id, reference, note) VALUES ($1, $2, 'topup', 'review_refund', $3, $4, $5)",
    [billing.billing_id, minutes, job.id, charge.run, "Human review wasn't available in time"],
  );
  return minutes;
}
