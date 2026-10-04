import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { config } from "./config.js";
import { recordCost } from "./costs.js";
import { responseError, wait, withRetries } from "./retry.js";
import { hasRemoteStorage } from "./storage.js";

const POLL_INTERVAL_MS = 10_000;
const MAX_WAIT_MS = 45 * 60 * 1000;

export function lipSyncAvailable() {
  return Boolean(config.syncApiKey) && hasRemoteStorage() && config.featureLipSync;
}

export function lipSyncUnavailableReason() {
  if (!config.featureLipSync) return "Lip-sync is currently turned off.";
  if (!config.syncApiKey) return "Lip-sync needs SYNC_API_KEY (sync.so) in backend/.env.";
  if (!hasRemoteStorage()) return "Lip-sync needs cloud storage (Cloudflare R2 or Supabase) so the lip-sync service can fetch your video.";
  return null;
}

async function syncFetch(path, options = {}) {
  return withRetries(async () => {
    const response = await fetch(`${config.syncApiUrl}${path}`, {
      ...options,
      headers: { "x-api-key": config.syncApiKey, "Content-Type": "application/json", ...(options.headers || {}) },
    });
    if (!response.ok) throw await responseError(response, "Lip-sync request");
    return response.json();
  }, { label: "Lip-sync request" });
}

/**
 * Re-renders the speaker's mouth movements to match the dubbed audio.
 * Both inputs must be URLs the service can download (signed storage URLs).
 */
export async function lipSync({ videoUrl, audioUrl, outputPath, durationSeconds, onProgress }) {
  const reason = lipSyncUnavailableReason();
  if (reason) throw new Error(reason);
  const created = await syncFetch("/v2/generate", {
    method: "POST",
    body: JSON.stringify({
      model: config.syncModel,
      input: [{ type: "video", url: videoUrl }, { type: "audio", url: audioUrl }],
      options: { sync_mode: "cut_off" },
    }),
  });
  const started = Date.now();
  let status = created;
  while (!["COMPLETED", "FAILED", "REJECTED", "CANCELED"].includes(String(status.status).toUpperCase())) {
    if (Date.now() - started > MAX_WAIT_MS) throw new Error("Lip-sync took too long and was abandoned.");
    await wait(POLL_INTERVAL_MS);
    await onProgress?.();
    status = await syncFetch(`/v2/generate/${encodeURIComponent(created.id)}`);
  }
  if (String(status.status).toUpperCase() !== "COMPLETED" || !status.outputUrl) {
    throw new Error(`Lip-sync failed: ${status.error || status.status}`);
  }
  const response = await fetch(status.outputUrl);
  if (!response.ok || !response.body) throw new Error(`Could not download the lip-synced video (${response.status}).`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(outputPath));
  await recordCost("sync", "lipsync", durationSeconds / 60, "minutes", (durationSeconds / 60) * config.costs.lipsyncPerMinute);
  return outputPath;
}
