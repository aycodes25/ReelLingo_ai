import { config } from "./config.js";
import { refundRun } from "./minutes.js";
import { logger } from "./logger.js";
import { closeDatabase, dbTime, initializeDatabase, isPostgres, many, one, query, toBool } from "./db.js";

export { closeDatabase, initializeDatabase };

const JSON_FIELDS = [
  "transcript_json", "translated_segments_json", "detected_languages_json", "options_json", "outputs_json",
  "metadata_json", "speakers_json", "clips_json",
];
const BOOL_FIELDS = ["voice_clone", "share_original"];
const NUMBER_FIELDS = ["id", "team_id", "depends_on", "priority", "attempts", "redub_count", "credit_id"];

function normalizeJob(job) {
  if (!job) return null;
  for (const field of JSON_FIELDS) {
    if (typeof job[field] === "string") {
      try {
        job[field] = JSON.parse(job[field]);
      } catch {
        job[field] = null;
      }
    }
  }
  for (const field of BOOL_FIELDS) job[field] = toBool(job[field]);
  for (const field of NUMBER_FIELDS) if (job[field] !== null && job[field] !== undefined) job[field] = Number(job[field]);
  if (job.duration_seconds !== null && job.duration_seconds !== undefined) job.duration_seconds = Number(job.duration_seconds);
  job.options_json ||= {};
  return job;
}

export async function getJob(id) {
  return normalizeJob(await one("SELECT * FROM jobs WHERE id = $1", [id]));
}

const CREATE_FIELDS = [
  "user_id", "team_id", "batch_id", "depends_on", "source_language", "target_language", "voice_clone", "input_storage_path",
  "source_url", "media_type", "options_json", "original_filename", "priority", "credit_id", "current_step", "plan_code",
];

function serialize(key, value) {
  if (JSON_FIELDS.includes(key) && value !== null && typeof value !== "string") return JSON.stringify(value);
  return value;
}

export async function createJob(job) {
  const fields = CREATE_FIELDS.filter((field) => job[field] !== undefined);
  const values = fields.map((field) => serialize(field, job[field]));
  const placeholders = fields.map((_, index) => `$${index + 1}`).join(", ");
  const row = await one(
    `INSERT INTO jobs (${fields.join(", ")}, status, updated_at) VALUES (${placeholders}, 'queued', CURRENT_TIMESTAMP) RETURNING *`,
    values,
  );
  return normalizeJob(row);
}

const UPDATABLE_FIELDS = new Set([
  "status", "current_step", "output_video_path", "output_srt_path", "outputs_json", "error_message",
  "transcript_json", "translated_segments_json", "detected_languages_json", "metadata_json", "speakers_json", "clips_json",
  "duration_seconds", "voice_clone", "processing_note", "input_storage_path", "original_filename", "options_json",
  "review_state", "redub_count", "share_slug", "share_original", "deleted_at", "files_expired_at", "attempts",
  "heartbeat_at", "started_at", "completed_at", "priority", "credit_id", "depends_on", "media_type",
]);

export async function updateJob(id, changes) {
  const entries = Object.entries(changes).filter(([key]) => UPDATABLE_FIELDS.has(key));
  if (entries.length === 0) return getJob(id);
  const assignments = entries.map(([key], index) => `${key} = $${index + 1}`).join(", ");
  await query(
    `UPDATE jobs SET ${assignments}, updated_at = CURRENT_TIMESTAMP WHERE id = $${entries.length + 1}`,
    [...entries.map(([key, value]) => serialize(key, value)), id],
  );
  return getJob(id);
}

/** Jobs visible in a workspace: a team's shared jobs, or the user's personal (team-less) jobs. */
export async function listJobs(userId, limit = 10, { teamId = null, offset = 0 } = {}) {
  const rows = teamId
    ? await many("SELECT * FROM jobs WHERE team_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3", [teamId, limit, offset])
    : await many("SELECT * FROM jobs WHERE user_id = $1 AND team_id IS NULL AND deleted_at IS NULL ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3", [userId, limit, offset]);
  return rows.map(normalizeJob);
}

export async function listBatchJobs(batchId) {
  if (!batchId) return [];
  return (await many("SELECT * FROM jobs WHERE batch_id = $1 AND deleted_at IS NULL ORDER BY id", [batchId])).map(normalizeJob);
}

export async function getJobBySlug(slug) {
  return normalizeJob(await one("SELECT * FROM jobs WHERE share_slug = $1 AND deleted_at IS NULL", [slug]));
}

export async function getSubscription(billingId) {
  return one("SELECT * FROM subscriptions WHERE user_id = $1", [billingId]);
}

function monthStart() {
  const now = new Date();
  return dbTime(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)));
}

/**
 * Videos and minutes processed this calendar month (for statistics; minutes are charged in minute_ledger).
 * Failed jobs don't count; deleted jobs still do.
 */
export async function getMonthlyUsage(userId, { teamId = null } = {}) {
  const scope = teamId ? "team_id = $1" : "user_id = $1 AND team_id IS NULL";
  const row = await one(
    `SELECT COUNT(*) AS videos, COALESCE(SUM(duration_seconds), 0) AS seconds FROM jobs
     WHERE ${scope} AND status <> 'failed' AND created_at >= $2`,
    [teamId || userId, monthStart()],
  );
  return { videos: Number(row?.videos || 0), seconds: Number(row?.seconds || 0) };
}

/** Atomically moves the next runnable job to "processing". Jobs waiting on a batch leader's transcript are skipped. */
export async function claimNextJob() {
  const ready = `status = 'queued' AND deleted_at IS NULL AND (depends_on IS NULL OR EXISTS (
      SELECT 1 FROM jobs leader WHERE leader.id = jobs.depends_on
      AND (leader.transcript_json IS NOT NULL OR leader.status IN ('failed', 'done') OR leader.deleted_at IS NOT NULL)))`;
  const now = dbTime();
  const row = isPostgres
    ? await one(
      `UPDATE jobs SET status = 'processing', attempts = attempts + 1, heartbeat_at = $1, started_at = COALESCE(started_at, $1), updated_at = $1
       WHERE id = (SELECT id FROM jobs WHERE ${ready} ORDER BY priority DESC, id ASC LIMIT 1 FOR UPDATE SKIP LOCKED)
       RETURNING *`,
      [now],
    )
    : await one(
      `UPDATE jobs SET status = 'processing', attempts = attempts + 1, heartbeat_at = $1, started_at = COALESCE(started_at, $1), updated_at = $1
       WHERE id = (SELECT id FROM jobs WHERE ${ready} ORDER BY priority DESC, id ASC LIMIT 1)
       RETURNING *`,
      [now],
    );
  return normalizeJob(row);
}

/**
 * Tells the queue "this attempt is still alive". Returns false when it is no longer the attempt that owns the job (the job was
 * handed to someone else, finished, or was deleted), so the caller knows to stop instead of doing the same work twice.
 */
export async function touchJob(id, attempt = null) {
  const result = attempt === null
    ? await query("UPDATE jobs SET heartbeat_at = $1 WHERE id = $2 AND status = 'processing'", [dbTime(), id])
    : await query("UPDATE jobs SET heartbeat_at = $1 WHERE id = $2 AND status = 'processing' AND attempts = $3", [dbTime(), id, attempt]);
  return result.rowCount > 0;
}

/**
 * Jobs whose worker stopped sending heartbeats (crash, restart, deploy) go back in the queue and resume
 * from their last saved step. After too many attempts they fail instead of looping forever.
 */
export async function requeueStaleJobs({ staleMs = config.jobStaleMs, maxAttempts = config.maxJobAttempts } = {}) {
  const cutoff = dbTime(new Date(Date.now() - staleMs));
  // Jobs that keep getting interrupted fail and give their minutes back.
  const stuck = await many(
    "SELECT * FROM jobs WHERE status = 'processing' AND (heartbeat_at IS NULL OR heartbeat_at < $1) AND attempts >= $2",
    [cutoff, maxAttempts],
  );
  let failedCount = 0;
  for (const row of stuck) {
    const result = await query(
      "UPDATE jobs SET status = 'failed', error_message = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND status = 'processing'",
      ["Processing was interrupted several times. Your minutes were returned; use Retry to try again.", row.id],
    );
    if (result.rowCount) {
      failedCount += 1;
      await refundRun(normalizeJob(row), { reason: "refund" }).catch(() => undefined);
    }
  }
  const failed = { rowCount: failedCount };
  const stale = await many("SELECT id, attempts, heartbeat_at FROM jobs WHERE status = 'processing' AND (heartbeat_at IS NULL OR heartbeat_at < $1)", [cutoff]);
  for (const row of stale) {
    logger.warn({ jobId: Number(row.id), attempts: Number(row.attempts), lastHeartbeat: row.heartbeat_at, staleAfterMs: staleMs }, "Job stopped sending heartbeats, so it goes back in the queue");
  }
  const requeued = await query(
    `UPDATE jobs SET status = 'queued', updated_at = CURRENT_TIMESTAMP
     WHERE status = 'processing' AND (heartbeat_at IS NULL OR heartbeat_at < $1)`,
    [cutoff],
  );
  return { requeued: requeued.rowCount, failed: failed.rowCount };
}

/** Other live jobs that still need the same stored input (multi-language batches share one upload). */
export async function countInputUsers(inputPath, exceptJobId) {
  if (!inputPath) return 0;
  const row = await one(
    "SELECT COUNT(*) AS count FROM jobs WHERE input_storage_path = $1 AND id <> $2 AND deleted_at IS NULL AND files_expired_at IS NULL",
    [inputPath, exceptJobId],
  );
  return Number(row?.count || 0);
}

export async function listExpiredJobs(cutoff, limit = 100) {
  return (await many(
    "SELECT * FROM jobs WHERE files_expired_at IS NULL AND created_at < $1 AND status IN ('done', 'failed') ORDER BY id LIMIT $2",
    [dbTime(cutoff), limit],
  )).map(normalizeJob);
}
