import { config } from "./config.js";
import { claimNextJob, countInputUsers, getJob, listExpiredJobs, requeueStaleJobs, touchJob, updateJob } from "./database.js";
import { logger } from "./logger.js";
import { refundRun } from "./minutes.js";
import { expireStaleReviews } from "./reviews.js";
import { runJob } from "./pipeline.js";
import { deleteFiles, listFiles } from "./storage.js";
import { purgeOldAudit } from "./audit.js";
import { cleanupExpiredUploads } from "./uploads.js";
import { purgeUploadCounters } from "./uploadgate.js";
import { checkLowBalances } from "./usage.js";

let running = 0;
let stopped = true;
let pollTimer = null;
let cleanupTimer = null;
const active = new Set();

async function runClaimed(job) {
  running += 1;
  const heartbeat = setInterval(() => void touchJob(job.id).catch(() => undefined), config.jobHeartbeatMs);
  const task = (async () => {
    try {
      logger.info({ jobId: job.id, attempt: job.attempts }, "Job started");
      const result = await runJob(job);
      logger.info({ jobId: job.id, status: result?.status }, "Job finished");
    } catch (error) {
      logger.error({ err: error, jobId: job.id }, "Job crashed");
      await updateJob(job.id, { status: "failed", error_message: error.message }).catch(() => undefined);
      await refundRun(await getJob(job.id)).catch(() => undefined);
    } finally {
      clearInterval(heartbeat);
      running -= 1;
    }
  })();
  active.add(task);
  await task;
  active.delete(task);
}

/** Claims jobs until the concurrency limit is reached. */
export async function pollOnce() {
  let claimed = 0;
  while (!stopped && running < config.workerConcurrency) {
    const job = await claimNextJob();
    if (!job) break;
    claimed += 1;
    void runClaimed(job).finally(() => {
      if (!stopped) void pollOnce();
    });
  }
  return claimed;
}

/**
 * Deletes stored files of projects older than the retention window, keeping the job record (and its transcript)
 * so usage history stays accurate. Inputs shared by other live jobs in a batch are kept until they expire too.
 */
export async function cleanupExpiredFiles(now = new Date()) {
  const cutoff = new Date(now.getTime() - config.retentionDays * 24 * 3600 * 1000);
  let expired = 0;
  for (const job of await listExpiredJobs(cutoff)) {
    const paths = await listFiles(`jobs/${job.id}`);
    if (job.input_storage_path && await countInputUsers(job.input_storage_path, job.id) === 0) paths.push(job.input_storage_path);
    try {
      await deleteFiles(paths);
      await updateJob(job.id, { files_expired_at: new Date().toISOString(), output_video_path: null, output_srt_path: null, outputs_json: null, clips_json: null });
      expired += 1;
    } catch (error) {
      logger.warn({ err: error, jobId: job.id }, "Retention cleanup failed");
    }
  }
  if (expired) logger.info({ expired }, "Deleted files past the retention window");
  await cleanupExpiredUploads();
  await purgeUploadCounters().catch((error) => logger.warn({ err: error }, "Upload counter cleanup failed"));
  await purgeOldAudit().catch((error) => logger.warn({ err: error }, "Audit log cleanup failed"));
  // Hourly: email admins when a paid provider is running low (Admin → API usage → alert level).
  await checkLowBalances().catch((error) => logger.warn({ err: error }, "Low-balance check failed"));
  // Hourly: human reviews nobody picked up in time continue without review (and are refunded).
  const reviews = await expireStaleReviews().catch((error) => {
    logger.warn({ err: error }, "Review expiry check failed");
    return 0;
  });
  if (reviews) logger.info({ reviews }, "Continued projects whose human review timed out");
  return expired;
}

export function startWorker() {
  if (!stopped) return;
  stopped = false;
  const tick = async () => {
    try {
      const { requeued, failed } = await requeueStaleJobs();
      if (requeued || failed) logger.info({ requeued, failed }, "Recovered interrupted jobs");
      await pollOnce();
    } catch (error) {
      logger.error({ err: error }, "Worker poll failed");
    }
  };
  void tick();
  pollTimer = setInterval(tick, config.workerPollMs);
  const cleanup = () => cleanupExpiredFiles().catch((error) => logger.error({ err: error }, "Retention cleanup failed"));
  void cleanup();
  cleanupTimer = setInterval(cleanup, config.cleanupIntervalMs);
  logger.info({ concurrency: config.workerConcurrency }, "Worker started");
}

export async function stopWorker() {
  stopped = true;
  clearInterval(pollTimer);
  clearInterval(cleanupTimer);
  await Promise.allSettled([...active]);
}
