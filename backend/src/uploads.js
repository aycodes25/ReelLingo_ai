import { FileStore } from "@tus/file-store";
import { Server } from "@tus/server";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getCurrentUser } from "./auth.js";
import { config } from "./config.js";
import { logger } from "./logger.js";

export const tusDirectory = join(tmpdir(), "reellingo-tus");
const datastore = new FileStore({ directory: tusDirectory, expirationPeriodInMilliseconds: 24 * 3600 * 1000 });

async function userFrom(request) {
  return getCurrentUser(request.headers.get("authorization"), request.headers.get("x-api-key"));
}

/**
 * Resumable uploads (tus protocol): large videos on flaky mobile connections continue where they stopped
 * instead of restarting. The finished upload's ID is then passed to POST /jobs as `upload_id`.
 */
export const tusServer = new Server({
  path: "/uploads",
  datastore,
  maxSize: config.uploadLimitBytes,
  respectForwardedHeaders: true,
  allowedOrigins: [config.frontendUrl],
  allowedCredentials: true,
  allowedHeaders: ["Authorization", "X-API-Key", "X-Workspace"],
  async onIncomingRequest(request, uploadId) {
    const user = await userFrom(request);
    if (!user) throw { status_code: 401, body: "Sign in to upload.\n" };
    if (uploadId && request.method !== "POST") {
      const upload = await datastore.getUpload(uploadId).catch(() => null);
      if (upload && upload.metadata?.userId !== user.id) throw { status_code: 403, body: "This upload belongs to another account.\n" };
    }
  },
  async onUploadCreate(request, upload) {
    const user = await userFrom(request);
    return { metadata: { ...upload.metadata, userId: user.id } };
  },
});

/** Returns a finished upload owned by this user as a local file, or throws. */
export async function claimUpload(uploadId, userId) {
  if (!/^[\w-]+$/.test(String(uploadId))) throw new Error("Invalid upload ID.");
  const upload = await datastore.getUpload(uploadId).catch(() => null);
  if (!upload || upload.metadata?.userId !== userId) throw new Error("Upload not found. Please upload the video again.");
  if (upload.size === undefined || upload.offset !== upload.size) throw new Error("The upload hasn't finished yet.");
  return {
    path: join(tusDirectory, uploadId),
    originalname: upload.metadata?.filename || "video.mp4",
    mimetype: upload.metadata?.filetype || "video/mp4",
    size: upload.size,
    release: () => datastore.remove(uploadId).catch(() => rm(join(tusDirectory, uploadId), { force: true })),
  };
}

export async function cleanupExpiredUploads() {
  try {
    return await datastore.deleteExpired();
  } catch (error) {
    logger.warn({ err: error }, "Could not delete expired resumable uploads");
    return 0;
  }
}
