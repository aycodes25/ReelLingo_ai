import { countInputUsers, updateJob } from "./database.js";
import { query } from "./db.js";
import { refundRun, runHasCost } from "./minutes.js";
import { deleteFiles, listFiles } from "./storage.js";

/**
 * Removes a project's stored files (outputs, clips, and the upload unless another job in its batch still needs it).
 * By default the job row is kept (marked deleted) so monthly usage stays accurate; `hard` removes the row too.
 */
export async function purgeJob(job, { hard = false } = {}) {
  const paths = await listFiles(`jobs/${job.id}`);
  if (job.input_storage_path && await countInputUsers(job.input_storage_path, job.id) === 0) paths.push(job.input_storage_path);
  await deleteFiles(paths);
  // Failed runs were already refunded by the pipeline. Work that hasn't started is refunded now; once paid providers
  // have done their part (e.g. a translation waiting for review) the minutes are spent and stay spent.
  if (!["done", "failed"].includes(job.status) && !(await runHasCost(job))) await refundRun(job, { reason: "deleted" });
  if (hard) {
    await query("DELETE FROM jobs WHERE id = $1", [job.id]);
    return;
  }
  const now = new Date().toISOString();
  await updateJob(job.id, {
    deleted_at: now, files_expired_at: now, share_slug: null, outputs_json: null, output_video_path: null, output_srt_path: null,
    clips_json: null, status: job.status === "queued" || job.status === "processing" ? "failed" : job.status,
    error_message: job.status === "queued" || job.status === "processing" ? "Deleted before it finished." : job.error_message,
  });
}
