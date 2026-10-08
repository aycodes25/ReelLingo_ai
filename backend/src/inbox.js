import { createHash } from "node:crypto";
import { copyFile, mkdir, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";

/**
 * A freshly uploaded video is kept on this computer for a while. When the worker runs here too (the usual setup), it uses
 * that copy instead of downloading the same file back from storage, which skips a slow round trip over the internet.
 * Other servers simply don't find it and download as before. Nothing depends on it: if it's missing, storage is used.
 */
const INBOX = join(tmpdir(), "reellingo-inbox");

const fileFor = (storagePath) => join(INBOX, `${createHash("sha1").update(String(storagePath)).digest("hex")}${extname(String(storagePath))}`);

export async function saveToInbox(storagePath, localPath) {
  try {
    await mkdir(INBOX, { recursive: true });
    await copyFile(localPath, fileFor(storagePath));
  } catch {
    // The inbox is only a shortcut; if it can't be written, storage is used.
  }
}

/** The local copy of a stored upload, or null. */
export async function findInInbox(storagePath) {
  if (!storagePath) return null;
  const path = fileFor(storagePath);
  try {
    return (await stat(path)).size > 0 ? path : null;
  } catch {
    return null;
  }
}

/** Removes copies older than `maxAgeMs` (called from the worker's hourly cleanup). */
export async function purgeInbox(maxAgeMs = 24 * 3600 * 1000, now = Date.now()) {
  let removed = 0;
  try {
    for (const name of await readdir(INBOX)) {
      const path = join(INBOX, name);
      const { mtimeMs } = await stat(path);
      if (now - mtimeMs > maxAgeMs) {
        await rm(path, { force: true });
        removed += 1;
      }
    }
  } catch {
    // no inbox yet
  }
  return removed;
}
