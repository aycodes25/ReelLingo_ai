import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const run = promisify(execFile);
const dataDirectory = await mkdtemp(join(tmpdir(), "reellingo-speed-"));
Object.assign(process.env, {
  MOCK_MODE: "false",
  OPENAI_API_KEY: "test-openai",
  ELEVENLABS_API_KEY: "test-elevenlabs",
  ELEVENLABS_MODEL: "eleven_v4",
  ELEVENLABS_FALLBACK_VOICE_ID: "stock-voice",
  SPITCH_API_KEY: "",
  SUPABASE_URL: "",
  SUPABASE_KEY: "",
  WORKER_MODE: "off",
  RESEND_API_KEY: "",
  DATABASE_URL: `sqlite:///${join(dataDirectory, "jobs.db").replaceAll("\\", "/")}`,
  LOCAL_STORAGE_DIR: join(dataDirectory, "storage"),
});

const database = await import("../src/database.js");
const { config } = await import("../src/config.js");
const { query } = await import("../src/db.js");
const { runCapture, resetCommandCache } = await import("../src/media.js");
const { providerPlan, separateBackground } = await import("../src/separation.js");
const { dubSegments, resetElevenLabsCache } = await import("../src/dubbing.js");
const { videoEncodeArgs } = await import("../src/render.js");
const { cachedBackground, runJob } = await import("../src/pipeline.js");
const { uploadFile, fileExists } = await import("../src/storage.js");
const { friendlyError } = await import("../src/friendly.js");
const { loadSettings, SETTINGS } = await import("../src/settings.js");

await database.initializeDatabase();
test.after(async () => {
  await database.closeDatabase();
  await rm(dataDirectory, { recursive: true, force: true });
});

// ---------- stopping work that is no longer wanted ----------

test("a tool that is still running can be stopped (so a failed job doesn't leave Demucs working in the background)", async () => {
  const controller = new AbortController();
  const started = Date.now();
  const running = runCapture(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { signal: controller.signal });
  setTimeout(() => controller.abort(), 300);
  await assert.rejects(running, /was stopped/);
  assert.ok(Date.now() - started < 5000, "it stopped at once instead of running on");
  await assert.rejects(runCapture(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { signal: AbortSignal.abort() }), /was stopped/, "already cancelled: never starts");
});

// ---------- removing the speech from the original sound ----------

test("the ElevenLabs separation method is gone: an old setting means automatic, and nothing is sent to ElevenLabs", async () => {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push(String(url));
    return realFetch(url, options);
  };
  try {
    config.separationProvider = "elevenlabs";
    resetCommandCache();
    config.demucsCommand = "definitely-not-installed-demucs";
    const stereo = join(dataDirectory, "stereo.wav");
    await run("ffmpeg", ["-y", "-f", "lavfi", "-i", "sine=frequency=300:duration=2", "-f", "lavfi", "-i", "sine=frequency=500:duration=2", "-filter_complex", "[0][1]amerge=inputs=2", "-ar", "44100", stereo]);
    const plan = await providerPlan(120);
    assert.deepEqual(plan.order, ["ffmpeg"], "no Demucs here, and no ElevenLabs");
    const result = await separateBackground(stereo, dataDirectory, 2);
    assert.equal(result.provider, "ffmpeg");
    assert.ok(result.backgroundPath);
    assert.equal(calls.filter((url) => url.includes("elevenlabs")).length, 0, "ElevenLabs was never called, so no characters were used");
  } finally {
    globalThis.fetch = realFetch;
    config.separationProvider = "auto";
    config.demucsCommand = "demucs";
    resetCommandCache();
  }
  assert.ok(!SETTINGS.find((setting) => setting.key === "separation_provider").options.includes("elevenlabs"), "the admin isn't offered it any more");
  await query("INSERT INTO app_settings (key, value) VALUES ('separation_provider', $1) ON CONFLICT (key) DO UPDATE SET value = $1", [JSON.stringify("elevenlabs")]);
  await loadSettings();
  assert.equal(config.separationProvider, "auto", "an old saved choice falls back to automatic");
  await query("DELETE FROM app_settings WHERE key = 'separation_provider'");
});

test("slow, high-quality separation is only used when it will finish in time; longer videos use the fast method and say so", async () => {
  resetCommandCache();
  config.demucsCommand = process.execPath; // anything that can be started counts as "Demucs is installed" here
  config.demucsSecondsPerVideoSecond = 3;
  config.separationTimeLimitMinutes = 20;
  try {
    assert.deepEqual((await providerPlan(5 * 60)).order, ["demucs", "ffmpeg"], "5 minutes of video: about 15 minutes of work, within the limit");
    const long = await providerPlan(120 * 60);
    assert.deepEqual(long.order, ["ffmpeg"], "two hours of video would take six hours with Demucs");
    assert.match(long.note, /faster method/);
    config.separationProvider = "demucs";
    assert.deepEqual((await providerPlan(120 * 60)).order, ["demucs", "ffmpeg"], "an admin who picks Demucs explicitly gets it");
    config.separationProvider = "ffmpeg";
    assert.deepEqual((await providerPlan(60)).order, ["ffmpeg"]);
    config.separationProvider = "none";
    assert.deepEqual((await providerPlan(60)).order, []);
    config.separationProvider = "auto";
    config.separationTimeLimitMinutes = 400;
    assert.deepEqual((await providerPlan(120 * 60)).order, ["demucs", "ffmpeg"], "a computer with a graphics card can raise the limit");
  } finally {
    config.separationProvider = "auto";
    config.separationTimeLimitMinutes = 20;
    config.demucsCommand = "demucs";
    resetCommandCache();
  }
});

test("a background made by the old ElevenLabs method (it still had the original voice in it) is never reused", async () => {
  const job = await database.createJob({
    user_id: "cachey", source_language: "pcm", target_language: "yo",
    options_json: { background_cached: true, background_provider: "elevenlabs" },
  });
  const stored = join(dataDirectory, "old-background.m4a");
  await run("ffmpeg", ["-y", "-f", "lavfi", "-i", "sine=frequency=200:duration=1", "-c:a", "aac", stored]);
  await uploadFile(`jobs/${job.id}/work/background.m4a`, stored, "audio/mp4");
  const stereo = join(dataDirectory, "stereo2.wav");
  await run("ffmpeg", ["-y", "-f", "lavfi", "-i", "sine=frequency=300:duration=2", "-f", "lavfi", "-i", "sine=frequency=500:duration=2", "-filter_complex", "[0][1]amerge=inputs=2", "-ar", "44100", stereo]);
  config.separationProvider = "ffmpeg";
  try {
    const notes = [];
    const fresh = await cachedBackground(job, stereo, dataDirectory, 2, notes);
    assert.ok(fresh);
    assert.equal(job.options_json.background_provider, "ffmpeg", "it was made again, with a method that works");
    assert.ok(await fileExists(`jobs/${job.id}/work/background.m4a`));
    // A background made properly is reused.
    const again = await cachedBackground(job, stereo, dataDirectory, 2, notes);
    assert.match(again, /background-cached\.m4a$/);
  } finally {
    config.separationProvider = "auto";
    await database.updateJob(job.id, { status: "done" }); // not waiting for a worker in the later tests
  }
});

// ---------- which voice speaks ----------

const MODELS = [{ model_id: "eleven_v4", languages: [{ language_id: "en" }, { language_id: "fr" }, { language_id: "yo" }, { language_id: "ha" }] }];

async function clip(seconds = 1) {
  const path = join(dataDirectory, `clip-${seconds}.mp3`);
  await run("ffmpeg", ["-y", "-f", "lavfi", "-i", `sine=frequency=440:duration=${seconds}`, "-ar", "44100", "-ac", "1", "-c:a", "libmp3lame", path]);
  return readFile(path);
}

/** Stands in for ElevenLabs and Spitch. `account` is what the ElevenLabs plan says it can do. */
function mockVoices({ account = { character_count: 0, character_limit: 100000, can_use_instant_voice_cloning: true }, audio }) {
  const requests = [];
  let open = 0;
  let mostOpen = 0;
  const fetchMock = async (url, options = {}) => {
    const href = String(url);
    requests.push({ url: href, method: options.method || "GET", body: options.body });
    if (href.endsWith("/v1/models")) return Response.json(MODELS);
    if (href.endsWith("/v1/user/subscription")) return Response.json(account);
    if (href.endsWith("/v1/voices/add")) return Response.json({ voice_id: "clone-id" });
    if (href.includes("/v1/voices/") && options.method === "DELETE") return new Response(null, { status: 200 });
    if (href.includes("/v1/text-to-speech/") || href.startsWith(config.spitchApiUrl)) {
      open += 1;
      mostOpen = Math.max(mostOpen, open);
      await new Promise((resolve) => setTimeout(resolve, 40));
      open -= 1;
      return new Response(audio, { status: 200 });
    }
    throw new Error(`Unexpected request ${href}`);
  };
  return { requests, fetchMock, mostOpen: () => mostOpen };
}

async function dub({ targetLanguage, voiceClone, lines = 2, workdir }) {
  const source = join(workdir, "source.wav");
  await run("ffmpeg", ["-y", "-f", "lavfi", "-i", "sine=frequency=300:duration=12", "-ar", "16000", "-ac", "1", source]);
  return dubSegments({
    segments: Array.from({ length: lines }, (_, index) => ({ start: index * 1.5, end: index * 1.5 + 1.2, text: `Line ${index + 1}` })),
    sourceAudioPath: source, outputPath: join(workdir, "dub.wav"), targetLanguage, voiceClone, durationSeconds: 12, workdir,
  });
}

async function withVoices(mock, task, { spitch = true } = {}) {
  const realFetch = globalThis.fetch;
  const dir = await mkdtemp(join(dataDirectory, "dub-"));
  globalThis.fetch = mock.fetchMock;
  config.spitchApiKey = spitch ? "test-spitch" : "";
  resetElevenLabsCache();
  try {
    return await task(dir);
  } finally {
    globalThis.fetch = realFetch;
    config.spitchApiKey = "";
  }
}

test("a plan that can't clone voices gets the native Nigerian voice, instead of a stand-in that sounds wrong", async () => {
  const mock = mockVoices({ audio: await clip(), account: { character_count: 0, character_limit: 100000, can_use_instant_voice_cloning: false } });
  const result = await withVoices(mock, (dir) => dub({ targetLanguage: "yo", voiceClone: true, workdir: dir }));
  assert.equal(result.provider, "spitch");
  assert.match(result.notice, /Voice cloning isn't available on our voice plan right now, so the native Yoruba voice was used instead/);
  assert.equal(mock.requests.filter((request) => request.url.endsWith("/v1/voices/add")).length, 0, "no clone was attempted");
  assert.equal(mock.requests.filter((request) => request.url.includes("/text-to-speech/")).length, 0, "ElevenLabs didn't speak");
  assert.equal(mock.requests.filter((request) => request.url.startsWith(config.spitchApiUrl)).length, 2);
});

test("a language ElevenLabs can't speak (Igbo, Pidgin) is never read by a cloned voice", async () => {
  const mock = mockVoices({ audio: await clip() });
  const result = await withVoices(mock, (dir) => dub({ targetLanguage: "ig", voiceClone: true, workdir: dir }));
  assert.equal(result.provider, "spitch");
  assert.match(result.notice, /A cloned voice can't speak Igbo properly, so the native Igbo voice was used instead/);
});

test("a language ElevenLabs can speak keeps the cloned voice (nothing changes for French or Yoruba on a plan that can clone)", async () => {
  for (const targetLanguage of ["fr", "yo"]) {
    const mock = mockVoices({ audio: await clip() });
    const result = await withVoices(mock, (dir) => dub({ targetLanguage, voiceClone: true, workdir: dir }));
    assert.equal(result.provider, "elevenlabs", targetLanguage);
    assert.equal(result.notice, null);
    assert.equal(mock.requests.filter((request) => request.url.endsWith("/v1/voices/add")).length, 1, `${targetLanguage}: the voice was cloned`);
  }
});

test("when ElevenLabs runs out of characters, Nigerian languages go to the native voice and never to a voice that can't speak them", async () => {
  const lowQuota = { character_count: 9990, character_limit: 10000, can_use_instant_voice_cloning: true };
  const mock = mockVoices({ audio: await clip(), account: lowQuota });
  const result = await withVoices(mock, (dir) => dub({ targetLanguage: "yo", voiceClone: true, workdir: dir }));
  assert.equal(result.provider, "spitch");
  assert.match(result.notice, /ElevenLabs character quota is too low .* The native Yoruba voice was used instead/);
  assert.equal(result.fallbackReason, null, "it isn't reported as 'dubbed with an OpenAI voice'");

  // Without the native voices there's nothing honest to fall back to: fail clearly (and the admins are told) instead of mumbling in English.
  const noSpitch = mockVoices({ audio: await clip(), account: lowQuota });
  await assert.rejects(
    withVoices(noSpitch, (dir) => dub({ targetLanguage: "yo", voiceClone: true, workdir: dir }), { spitch: false }),
    (error) => /out of credit/.test(error.message) && friendlyError(error).kind === "credit" && friendlyError(error).alertsAdmin === true,
  );
  assert.equal(noSpitch.requests.filter((request) => request.url.includes("/text-to-speech/")).length, 0);
});

test("the admin can turn the native-voice switch off", async () => {
  config.nativeVoiceWhenCloneCannotSpeak = false;
  try {
    const mock = mockVoices({ audio: await clip(), account: { character_count: 0, character_limit: 100000, can_use_instant_voice_cloning: false } });
    const result = await withVoices(mock, (dir) => dub({ targetLanguage: "yo", voiceClone: true, workdir: dir }));
    assert.equal(result.provider, "elevenlabs");
  } finally {
    config.nativeVoiceWhenCloneCannotSpeak = true;
  }
});

test("voice lines are made several at a time, up to the plan's limit and no more", async () => {
  const audio = await clip();
  for (const limit of [1, 3]) {
    config.elevenlabsConcurrency = limit;
    const mock = mockVoices({ audio });
    await withVoices(mock, (dir) => dub({ targetLanguage: "fr", voiceClone: false, lines: 8, workdir: dir }));
    assert.equal(mock.mostOpen(), limit, `limit ${limit}: that many at once, never more`);
  }
  config.elevenlabsConcurrency = 2;
});

// ---------- faster video export ----------

test("the video export speed is an admin setting, with a safe default", () => {
  const presetOf = () => videoEncodeArgs()[videoEncodeArgs().indexOf("-preset") + 1];
  for (const [speed, preset] of [["balanced", "veryfast"], ["fast", "superfast"], ["fastest", "ultrafast"], ["nonsense", "superfast"]]) {
    config.exportSpeed = speed;
    assert.equal(presetOf(), preset, speed);
  }
  assert.ok(videoEncodeArgs().includes("yuv420p"), "plays everywhere");
  config.exportSpeed = "fast";
});

// ---------- the same video can't be processed twice at once ----------

test("only the attempt that owns a job can keep it alive; a requeued job's old attempt finds out and stops", async () => {
  assert.equal(config.jobStaleMs, 300000, "a heavy step can't make a healthy job look dead after two minutes");
  const job = await database.createJob({ user_id: "owner", source_language: "yo", target_language: "en", options_json: {} });
  const first = await database.claimNextJob();
  assert.equal(first.id, job.id);
  assert.equal(first.attempts, 1);
  assert.equal(await database.touchJob(job.id, 1), true, "the owner's heartbeat is accepted");

  // Its heartbeat goes quiet for too long, so the job goes back in the queue and a second attempt claims it.
  await query("UPDATE jobs SET heartbeat_at = $1 WHERE id = $2", ["2020-01-01 00:00:00", job.id]);
  assert.deepEqual(await database.requeueStaleJobs({ staleMs: 1000 }), { requeued: 1, failed: 0 });
  assert.equal(await database.touchJob(job.id, 1), false, "while it waits in the queue, nobody owns it");
  const second = await database.claimNextJob();
  assert.equal(second.attempts, 2);
  assert.equal(await database.touchJob(job.id, 1), false, "the first attempt has lost the job…");
  assert.equal(await database.touchJob(job.id, 2), true, "…and the second one owns it");
});

test("an attempt that has lost its job stops at the next step, without failing it or touching the new attempt's work", async () => {
  const video = join(dataDirectory, "owned.mp4");
  await run("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=blue:s=320x240:d=2:r=24", "-f", "lavfi", "-i", "sine=frequency=300:duration=2", "-shortest", "-c:v", "libx264", "-c:a", "aac", video]);
  const inputPath = await uploadFile("uploads/owned.mp4", video, "video/mp4");
  const job = await database.createJob({ user_id: "stopper", source_language: "yo", target_language: "en", input_storage_path: inputPath, options_json: {} });
  const claimed = await database.claimNextJob();
  assert.equal(claimed.id, job.id);
  claimed.lease = { lost: true }; // what the worker sets when its heartbeat is refused
  const result = await runJob(claimed);
  assert.equal(result, null, "it quietly stopped");
  const after = await database.getJob(job.id);
  assert.equal(after.status, "processing", "not marked failed: the other attempt is still working");
  assert.equal(after.error_message, null);
  assert.equal(after.current_step, "queued", "it never wrote its own progress over the owner's");
});

test("technical errors become readable, and the Spitch busy message tells people to press Retry", () => {
  assert.equal(friendlyError(new Error("Spitch translation (429): concurrency_limit_exceeded")).kind, "busy");
});

// ---------- listening to the gaps ----------

test("the gaps between spoken lines tell us whether there is music to keep", async () => {
  const { measureQuietGaps } = await import("../src/separation.js");
  const speech = "sine=frequency=300:duration=10,volume='if(between(t,0.2,2)+between(t,3,5),1,0)':eval=frame";
  const lines = [{ start: 0.2, end: 2 }, { start: 3, end: 5 }];
  const quiet = join(dataDirectory, "gaps-quiet.wav");
  await run("ffmpeg", ["-y", "-f", "lavfi", "-i", speech, "-ar", "16000", "-ac", "1", quiet]);
  const bed = join(dataDirectory, "gaps-bed.wav");
  await run("ffmpeg", ["-y", "-f", "lavfi", "-i", speech, "-f", "lavfi", "-i", "anoisesrc=d=10:c=pink:a=0.1", "-filter_complex", "[0][1]amix=inputs=2:duration=first:normalize=0", "-ar", "16000", "-ac", "1", bed]);

  const silent = await measureQuietGaps(quiet, lines, 10);
  assert.ok(silent.seconds > 4, "there was enough silence to judge");
  assert.ok(silent.meanDb <= -60, `almost no sound between the lines (${silent.meanDb} dB)`);
  const music = await measureQuietGaps(bed, lines, 10);
  assert.ok(music.meanDb > -40, `a steady sound under the speech is heard in the gaps (${music.meanDb} dB)`);
  assert.ok(music.meanDb > silent.meanDb + 20);

  // Nonstop speech leaves no gaps to listen to: the answer is "can't tell", which keeps the full separation.
  assert.equal(await measureQuietGaps(quiet, [{ start: 0, end: 4.8 }, { start: 5, end: 9.9 }], 10), null);
  assert.equal(await measureQuietGaps(quiet, [], 2), null, "a clip too short to judge");
});
