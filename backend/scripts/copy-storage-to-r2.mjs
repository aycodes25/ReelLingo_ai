// Copies every file from Supabase Storage into Cloudflare R2, so existing projects keep working after the switch.
// You run this yourself, from the backend folder:
//   npm run storage:copy-to-r2              (copy)
//   npm run storage:copy-to-r2 -- --dry-run (only show what would be copied)
// It only READS from Supabase and never deletes anything there. Files already in R2 are skipped, so it's safe to run again.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStorageDriver } from "../src/storage.js";

const dryRun = process.argv.includes("--dry-run");
const source = createStorageDriver("supabase");
const target = createStorageDriver("r2");
const workdir = await mkdtemp(join(tmpdir(), "reellingo-copy-"));

const megabytes = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

try {
  console.log("Listing files in Supabase Storage…");
  const files = await source.listFilesWithSizes("");
  const total = files.reduce((sum, file) => sum + file.size, 0);
  console.log(`Found ${files.length} file(s), ${megabytes(total)} in total.${dryRun ? " (dry run: nothing will be copied)" : ""}`);
  let copied = 0;
  let skipped = 0;
  let failed = 0;
  for (const [index, file] of files.entries()) {
    const label = `[${index + 1}/${files.length}] ${file.path} (${megabytes(file.size)})`;
    if (await target.fileExists(file.path)) {
      skipped += 1;
      console.log(`${label} — already in R2, skipped`);
      continue;
    }
    if (dryRun) {
      console.log(`${label} — would copy`);
      continue;
    }
    const localCopy = join(workdir, `file-${index}`);
    try {
      await source.downloadFile(file.path, localCopy);
      await target.uploadFile(file.path, localCopy, "application/octet-stream");
      copied += 1;
      console.log(`${label} — copied`);
    } catch (error) {
      failed += 1;
      console.log(`${label} — FAILED: ${error.message}`);
    } finally {
      await rm(localCopy, { force: true });
    }
  }
  console.log(`\nDone. Copied ${copied}, already there ${skipped}, failed ${failed}.`);
  if (failed) console.log("Run the command again to retry the failed files.");
  process.exitCode = failed ? 1 : 0;
} finally {
  await rm(workdir, { recursive: true, force: true });
}
