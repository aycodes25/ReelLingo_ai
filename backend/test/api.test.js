import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

function run(command, args, capture = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", capture ? "pipe" : "ignore", "pipe"] });
    const stdout = [];
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    if (capture) child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(capture ? Buffer.concat(stdout).toString("utf8") : undefined);
      else reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
    });
  });
}

test("demo API exposes regional languages and protects job routes", async (context) => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "reellingo-api-"));
  process.env.MOCK_MODE = "true";
  process.env.OPENAI_API_KEY = "";
  process.env.ELEVENLABS_API_KEY = "";
  process.env.SUPABASE_URL = "";
  process.env.SUPABASE_KEY = "";
  process.env.DATABASE_URL = `sqlite:///${join(dataDirectory, "jobs.db").replaceAll("\\", "/")}`;
  process.env.LOCAL_STORAGE_DIR = join(dataDirectory, "storage");

  const [{ app }, database] = await Promise.all([
    import("../server.js"),
    import("../src/database.js"),
  ]);
  await database.initializeDatabase();
  const server = app.listen(0);
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  context.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await database.closeDatabase();
    await rm(dataDirectory, { recursive: true, force: true });
  });

  const health = await fetch(`${baseUrl}/health`).then((response) => response.json());
  assert.equal(health.mode, "demo");
  assert.equal(health.capabilities.authentication, false);

  const languages = await fetch(`${baseUrl}/languages`).then((response) => response.json());
  assert.ok(languages.length >= 45);
  for (const code of ["auto", "yo", "ig", "ha", "pcm", "sw", "fr", "ja", "hi"]) {
    assert.ok(languages.some((language) => language.code === code), `missing ${code}`);
  }

  const unauthorized = await fetch(`${baseUrl}/jobs`);
  assert.equal(unauthorized.status, 401);

  const auth = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "creator@example.test", password: "demo-password" }),
  }).then((response) => response.json());
  assert.equal(auth.access_token, "local-demo-token");

  const headers = { Authorization: `Bearer ${auth.access_token}` };
  const emptyJobs = await fetch(`${baseUrl}/jobs`, { headers }).then((response) => response.json());
  assert.deepEqual(emptyJobs, []);
  const blockedUpload = await fetch(`${baseUrl}/jobs`, { method: "POST", headers });
  assert.equal(blockedUpload.status, 503);
  assert.match((await blockedUpload.json()).detail, /OPENAI_API_KEY/);

  const job = await database.createJob({
    user_id: "local-user",
    source_language: "yo",
    target_language: "en",
    voice_clone: false,
    input_storage_path: "uploads/test.mp4",
  });
  const response = await fetch(`${baseUrl}/jobs/${job.id}`, { headers });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, "queued");
  await database.updateJob(job.id, {
    transcript_json: JSON.stringify([{ start: 0, end: 1, text: "Bawo ni", language: "yo" }]),
    translated_segments_json: JSON.stringify([{ start: 0, end: 1, text: "How are you", language: "yo" }]),
    detected_languages_json: JSON.stringify(["yo", "en"]),
    duration_seconds: 12.5,
  });
  const persisted = await fetch(`${baseUrl}/jobs/${job.id}`, { headers }).then((result) => result.json());
  assert.equal(persisted.transcript[0].text, "Bawo ni");
  assert.equal(persisted.translated_segments[0].text, "How are you");
  assert.deepEqual(persisted.detected_languages.map((language) => language.code), ["yo", "en"]);
  assert.equal(persisted.duration_seconds, 12.5);

  const wrongOwner = await database.createJob({
    user_id: "another-user",
    source_language: "yo",
    target_language: "en",
    voice_clone: false,
    input_storage_path: "uploads/private.mp4",
  });
  assert.equal((await fetch(`${baseUrl}/jobs/${wrongOwner.id}`, { headers })).status, 404);

  const inputVideo = join(dataDirectory, "pipeline-input.mp4");
  await run("ffmpeg", [
    "-y", "-f", "lavfi", "-i", "color=c=black:s=160x120:d=2:r=24",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-shortest",
    "-c:v", "libx264", "-c:a", "aac", inputVideo,
  ]);
  const pipelineJob = await database.createJob({
    user_id: "local-user",
    source_language: "yo",
    target_language: "en",
    voice_clone: false,
    input_storage_path: "uploads/pipeline-input.mp4",
  });
  const { runPipeline } = await import("../src/pipeline.js");
  await runPipeline(pipelineJob.id, inputVideo, pipelineJob);
  const finished = await database.getJob(pipelineJob.id);
  assert.equal(finished.status, "failed");
  assert.match(finished.error_message, /Live dubbing is not configured/);
  const finishedResponse = await fetch(`${baseUrl}/jobs/${pipelineJob.id}`, { headers }).then((response) => response.json());
  assert.equal(finishedResponse.demo_mode, true);
  assert.equal(finishedResponse.output_video_url, null);
  assert.equal(finishedResponse.transcript, null);
});