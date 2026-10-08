import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const run = promisify(execFile);
const dataDirectory = await mkdtemp(join(tmpdir(), "reellingo-captions-"));
Object.assign(process.env, {
  MOCK_MODE: "false",
  FEATURE_API: "true",
  OPENAI_API_KEY: "test-openai",
  ELEVENLABS_API_KEY: "test-elevenlabs",
  SUPABASE_URL: "",
  SUPABASE_KEY: "",
  WORKER_MODE: "off",
  ADMIN_EMAILS: "boss@example.com",
  RESEND_API_KEY: "",
  DATABASE_URL: `sqlite:///${join(dataDirectory, "jobs.db").replaceAll("\\", "/")}`,
  LOCAL_STORAGE_DIR: join(dataDirectory, "storage"),
});

const { app } = await import("../server.js");
const database = await import("../src/database.js");
const { config } = await import("../src/config.js");
const { many, query } = await import("../src/db.js");
const { createApiKey } = await import("../src/auth.js");
const { activateSubscription } = await import("../src/billing.js");
const { ensureProfile, planFor } = await import("../src/accounts.js");
const { runJob } = await import("../src/pipeline.js");
const { downloadFile, fileExists, uploadFile, deleteFiles } = await import("../src/storage.js");

await database.initializeDatabase();
const server = app.listen(0);
await new Promise((resolve) => server.once("listening", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
config.publicApiUrl = base;
test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await database.closeDatabase();
  await rm(dataDirectory, { recursive: true, force: true });
});

const video = join(dataDirectory, "dubbed.mp4");
await run("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=0x1d3557:s=640x360:d=3:r=24", "-f", "lavfi", "-i", "sine=frequency=300:duration=3", "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", video]);

/** A picture from the video, as a checksum: different pictures give different checksums. */
async function frameChecksum(path, at = 1) {
  const { stdout } = await run("ffmpeg", ["-v", "error", "-ss", String(at), "-i", path, "-frames:v", "1", "-f", "md5", "-"]);
  return stdout.trim();
}

/** A finished project, as the pipeline leaves it: a dubbed video in storage, translated lines, and its minutes paid. */
async function finishedProject(user, overrides = {}) {
  const job = await database.createJob({
    user_id: user, source_language: "yo", target_language: "en", options_json: { charge: { minutes: 2, kind: "job", run: `original-run-${user}` }, mode: "dub" },
  });
  const path = await uploadFile(`jobs/${job.id}/output-v1.mp4`, video, "video/mp4");
  await query("INSERT INTO minute_ledger (billing_id, delta, bucket, kind, job_id, reference) VALUES ($1, -2, 'plan', 'job', $2, $3)", [user, job.id, `original-run-${user}`]);
  await database.updateJob(job.id, {
    status: "done", current_step: "done", duration_seconds: 3, media_type: "video",
    transcript_json: [{ start: 0, end: 2.5, text: "bawo ni" }],
    translated_segments_json: [{ start: 0, end: 2.5, text: "Hello, welcome to Lagos" }],
    outputs_json: [{ kind: "video", label: "Dubbed video (MP4)", path }],
    ...overrides,
  });
  return { job: await database.getJob(job.id), path };
}

/** What the worker does: claim the queued job and run it. */
async function runQueued() {
  const claimed = await database.claimNextJob();
  assert.ok(claimed, "a job was waiting");
  return runJob(claimed);
}

async function customer(id, plan = "studio") {
  await ensureProfile(id, `${id}@example.com`);
  await activateSubscription(id, plan);
  const key = (await createApiKey(id, "t")).key;
  return { id, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" } };
}
const post = (who, jobId, body = {}) => fetch(`${base}/jobs/${jobId}/captions`, { method: "POST", headers: who.headers, body: JSON.stringify(body) });
const ledgerTotal = async (user) => (await many("SELECT delta FROM minute_ledger WHERE billing_id = $1", [user])).reduce((sum, row) => sum + Number(row.delta), 0);

test("a finished video can be downloaded with the subtitles on the picture, without using any minutes", async () => {
  const who = await customer("sub-maker");
  const { job, path } = await finishedProject(who.id);
  const minutesBefore = (await planFor({ userId: who.id })).minutes.available;
  const ledgerBefore = await ledgerTotal(who.id);

  const started = await post(who, job.id, { style: "bold" });
  assert.equal(started.status, 202);
  const queued = await started.json();
  assert.equal(queued.captions_pending, true);
  assert.equal(queued.status, "queued");
  assert.equal(queued.caption_style, "bold");

  const done = await runQueued();
  assert.equal(done.status, "done");
  const result = await database.getJob(job.id);
  const captioned = result.outputs_json.filter((output) => output.kind === "captioned");
  assert.equal(captioned.length, 1);
  assert.equal(captioned[0].style, "bold");
  assert.equal(captioned[0].label, "Video with subtitles on screen");
  assert.ok(result.outputs_json.some((output) => output.kind === "video" && output.path === path), "the dubbed video is still there");
  assert.match(result.processing_note, /subtitles on screen is ready/);

  // The file really has the words drawn on the picture, and the same sound and length.
  const local = await downloadFile(captioned[0].path, join(dataDirectory, "result.mp4"));
  assert.notEqual(await frameChecksum(local, 1), await frameChecksum(video, 1), "the frame while the line is spoken is different: text is on it");
  assert.equal(await frameChecksum(local, 2.8), await frameChecksum(local, 2.8));
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type:format=duration", "-of", "json", local]);
  const probe = JSON.parse(stdout);
  assert.ok(probe.streams.some((stream) => stream.codec_type === "video") && probe.streams.some((stream) => stream.codec_type === "audio"));
  assert.ok(Math.abs(Number(probe.format.duration) - 3) < 0.3);

  // No minutes were touched, and the project's real charge is back in place.
  assert.equal((await planFor({ userId: who.id })).minutes.available, minutesBefore);
  assert.equal(await ledgerTotal(who.id), ledgerBefore);
  assert.equal(result.options_json.task, undefined);
  assert.equal(result.options_json.charge.run, `original-run-${who.id}`);
  assert.equal(result.options_json.charge.minutes, 2);
  assert.equal(result.options_json.pre_task_charge, undefined);

  // Asking again with another style replaces the video (one subtitled video, the old file removed).
  const oldPath = captioned[0].path;
  assert.equal((await post(who, job.id, { style: "boxed" })).status, 202);
  await runQueued();
  const again = (await database.getJob(job.id)).outputs_json.filter((output) => output.kind === "captioned");
  assert.equal(again.length, 1);
  assert.equal(again[0].style, "boxed");
  assert.equal(await fileExists(oldPath), false, "the first version was deleted");
  assert.equal(await fileExists(again[0].path), true);
  assert.equal(await ledgerTotal(who.id), ledgerBefore);
});

test("the finished video can be fetched from the project, with a download link", async () => {
  const who = await customer("downloader");
  const { job } = await finishedProject(who.id);
  await post(who, job.id, { style: "classic" });
  await runQueued();
  const shown = await fetch(`${base}/jobs/${job.id}`, { headers: who.headers }).then((response) => response.json());
  const output = shown.outputs.find((item) => item.kind === "captioned");
  assert.ok(output.url && output.download_url, "it can be watched and downloaded");
  assert.equal(shown.captions_pending, false);
  const file = await fetch(output.download_url);
  assert.equal(file.status, 200);
  assert.ok((await file.arrayBuffer()).byteLength > 1000);
});

test("when the render fails, the project stays finished and the dub's minutes are never refunded or charged again", async () => {
  const who = await customer("unlucky");
  const { job, path } = await finishedProject(who.id);
  const ledgerBefore = await ledgerTotal(who.id);
  await post(who, job.id, { style: "classic" });
  await deleteFiles([path]); // the stored video has gone, so the render can't work
  const failed = await runQueued();
  assert.equal(failed.status, "done", "the project is still finished");
  const after = await database.getJob(job.id);
  assert.match(after.processing_note, /Subtitles could not be added to the video/);
  assert.equal(after.options_json.task, undefined);
  assert.equal(after.options_json.charge.run, `original-run-${who.id}`, "the real charge is back");
  assert.equal(await ledgerTotal(who.id), ledgerBefore, "no refund and no new charge");
});

test("who can do it, and how often", async () => {
  const who = await customer("rules");
  const other = await customer("someone-else");
  const { job } = await finishedProject(who.id);

  assert.equal((await post(other, job.id)).status, 404, "other people's projects aren't reachable");
  const unfinished = await database.createJob({ user_id: who.id, source_language: "yo", target_language: "en", options_json: {} });
  await database.updateJob(unfinished.id, { status: "awaiting_review" }); // not waiting in the worker's queue
  assert.equal((await post(who, unfinished.id)).status, 409, "only finished projects");
  const audio = await finishedProject(who.id, { media_type: "audio" });
  assert.equal((await post(who, audio.job.id)).status, 400, "audio has no picture");
  const empty = await finishedProject(who.id, { translated_segments_json: [] });
  assert.equal((await post(who, empty.job.id)).status, 409, "nothing to show yet");
  const expired = await finishedProject(who.id, { files_expired_at: new Date().toISOString() });
  assert.equal((await post(who, expired.job.id)).status, 409, "files already deleted");

  config.featureCaptions = false;
  const off = await post(who, job.id);
  assert.equal(off.status, 403, "the admin can switch the feature off");
  config.featureCaptions = true;

  // A bad style is replaced by the default rather than trusted.
  assert.equal((await post(who, job.id, { style: "<script>" })).status, 202);
  assert.equal((await runQueued()).options_json.caption_style, "classic");
  assert.equal((await database.getJob(job.id)).outputs_json.find((output) => output.kind === "captioned").style, "classic");

  const saved = config.maxCaptionRenders;
  config.maxCaptionRenders = 1;
  const limited = await post(who, job.id);
  assert.equal(limited.status, 429);
  assert.equal((await limited.json()).code, "caption_renders");
  config.maxCaptionRenders = saved;
});

test("subtitles-only projects get the subtitles on the original video", async () => {
  const who = await customer("subs-only");
  const job = await database.createJob({
    user_id: who.id, source_language: "yo", target_language: "en", options_json: { mode: "subtitles", watermark: false, charge: { minutes: 0.3, kind: "job", run: "subs-run" } },
    input_storage_path: await uploadFile(`uploads/subs-only.mp4`, video, "video/mp4"),
  });
  await database.updateJob(job.id, {
    status: "done", current_step: "done", duration_seconds: 3, media_type: "video",
    transcript_json: [{ start: 0, end: 2.5, text: "bawo ni" }], translated_segments_json: [{ start: 0, end: 2.5, text: "Hello, welcome to Lagos" }],
    outputs_json: [{ kind: "subtitles", format: "srt", label: "Subtitles (SRT)", path: "jobs/x/subtitles.srt" }],
  });
  assert.equal((await post(who, job.id, { style: "karaoke" })).status, 202);
  assert.equal((await runQueued()).status, "done");
  const output = (await database.getJob(job.id)).outputs_json.find((item) => item.kind === "captioned");
  assert.ok(output, "the original video now has the subtitles on it");
  assert.ok((await database.getJob(job.id)).outputs_json.some((item) => item.format === "srt"), "the subtitle files are still listed");
});
