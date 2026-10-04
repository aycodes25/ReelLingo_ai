import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(stderr))));
  });
}

const dir = await mkdtemp(join(tmpdir(), "reellingo-e2e-"));
const tone = join(dir, "tone.mp3");
await run("ffmpeg", ["-y", "-f", "lavfi", "-i", "sine=frequency=660:duration=0.8", "-ac", "1", "-ar", "44100", "-c:a", "libmp3lame", tone]);
const toneBytes = await readFile(tone);

// A stand-in for the OpenAI API: Whisper, chat (language ID, translation, metadata) and speech.
const calls = { transcription: 0, chat: 0, speech: 0 };
const openaiServer = createServer((request, response) => {
  const chunks = [];
  request.on("data", (chunk) => chunks.push(chunk));
  request.on("end", () => {
    const body = Buffer.concat(chunks).toString("utf8");
    response.setHeader("Content-Type", "application/json");
    if (request.url.endsWith("/audio/transcriptions")) {
      calls.transcription += 1;
      response.end(JSON.stringify({ language: "yoruba", text: "Bawo ni E kaabo", segments: [{ start: 0.2, end: 1.3, text: "Bawo ni" }, { start: 1.6, end: 2.8, text: "E kaabo" }] }));
      return;
    }
    if (request.url.endsWith("/chat/completions")) {
      calls.chat += 1;
      const payload = JSON.parse(body);
      const system = payload.messages[0].content;
      const user = payload.messages[1].content;
      let content;
      if (system.includes("social video metadata")) content = { title: "Welcome to Lagos", description: "A warm greeting.", hashtags: ["lagos", "#naija"] };
      else if (system.includes("short social-media clips")) content = { clips: [{ start_index: 0, end_index: 2, title: "The best bit" }, { start_index: 5, end_index: 5, title: "Too short" }] };
      else if (system.includes("Identify the language")) content = { segments: JSON.parse(user).map((item) => ({ index: item.index, language: "yo" })) };
      else content = { segments: JSON.parse(user).map((item) => ({ index: item.index, text: `EN ${item.text}` })) };
      response.end(JSON.stringify({ id: "x", object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(content) }, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 20 } }));
      return;
    }
    if (request.url.endsWith("/audio/speech")) {
      calls.speech += 1;
      response.setHeader("Content-Type", "audio/mpeg");
      response.end(toneBytes);
      return;
    }
    response.statusCode = 404;
    response.end("{}");
  });
});
await new Promise((resolve) => openaiServer.listen(0, "127.0.0.1", resolve));

Object.assign(process.env, {
  MOCK_MODE: "false",
  OPENAI_API_KEY: "test-openai",
  OPENAI_BASE_URL: `http://127.0.0.1:${openaiServer.address().port}/v1`,
  ELEVENLABS_API_KEY: "test-elevenlabs",
  ELEVENLABS_FALLBACK_VOICE_ID: "stock-voice",
  SPITCH_API_KEY: "test-spitch",
  SEPARATION_PROVIDER: "ffmpeg",
  SUPABASE_URL: "",
  SUPABASE_KEY: "",
  WORKER_MODE: "off",
  RESEND_API_KEY: "",
  DATABASE_URL: `sqlite:///${join(dir, "jobs.db").replaceAll("\\", "/")}`,
  LOCAL_STORAGE_DIR: join(dir, "storage"),
});

// ElevenLabs goes through global fetch.
const eleven = { tts: [], clones: 0, deletes: 0, scribe: 0 };
// Spitch (native Nigerian voices, translation and Yoruba tone marks) goes through global fetch too.
const spitch = { speech: [], translate: [], diacritics: [] };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  const href = String(url);
  if (href.startsWith("https://api.spitch.app/v1/")) {
    const body = JSON.parse(options.body);
    if (href.endsWith("/speech")) {
      spitch.speech.push(body);
      return new Response(toneBytes, { status: 200, headers: { "Content-Type": "audio/mpeg" } });
    }
    if (href.endsWith("/translate")) {
      spitch.translate.push(body);
      return Response.json({ request_id: "t", text: body.text === "Bawo ni" ? "Bawo ni" : "E kaabo" });
    }
    if (href.endsWith("/diacritics")) {
      spitch.diacritics.push(body);
      return Response.json({ request_id: "d", text: body.text.replace("Bawo", "Báwo").replace("E kaabo", "Ẹ káàbọ̀") });
    }
  }
  if (!href.startsWith("https://api.elevenlabs.io")) return realFetch(url, options);
  if (href.endsWith("/v1/models")) return Response.json([{ model_id: "eleven_v4", languages: [{ language_id: "en" }] }]);
  if (href.endsWith("/v1/user/subscription")) return Response.json({ character_count: 0, character_limit: 100000 });
  if (href.endsWith("/v1/voices/add")) {
    eleven.clones += 1;
    return Response.json({ voice_id: `clone-${eleven.clones}` });
  }
  if (href.includes("/v1/voices/") && options.method === "DELETE") {
    eleven.deletes += 1;
    return new Response(null, { status: 200 });
  }
  if (href.includes("/v1/text-to-speech/")) {
    eleven.tts.push({ voice: href.split("/v1/text-to-speech/")[1].split("?")[0], text: JSON.parse(options.body).text });
    return new Response(toneBytes, { status: 200 });
  }
  if (href.endsWith("/v1/speech-to-text")) {
    eleven.scribe += 1;
    return Response.json({
      language_code: "yor",
      words: [
        { type: "word", text: "Bawo", start: 0.2, end: 0.6, speaker_id: "speaker_0" }, { type: "spacing", text: " " },
        { type: "word", text: "ni", start: 0.6, end: 1.3, speaker_id: "speaker_0" },
        { type: "word", text: "E", start: 1.6, end: 1.9, speaker_id: "speaker_1" }, { type: "spacing", text: " " },
        { type: "word", text: "kaabo", start: 1.9, end: 2.8, speaker_id: "speaker_1" },
      ],
    });
  }
  throw new Error(`Unexpected ElevenLabs call ${href}`);
};

const database = await import("../src/database.js");
const { runJob } = await import("../src/pipeline.js");
const { uploadFile, localPath } = await import("../src/storage.js");
const { jobCosts } = await import("../src/costs.js");
const { getMediaInfo } = await import("../src/media.js");
await database.initializeDatabase();

test.after(async () => {
  globalThis.fetch = realFetch;
  openaiServer.close();
  await database.closeDatabase();
  await rm(dir, { recursive: true, force: true });
});

async function storedVideo(name, { audioOnly = false } = {}) {
  const path = join(dir, name);
  const audio = ["-f", "lavfi", "-i", "sine=frequency=300:duration=3", "-f", "lavfi", "-i", "sine=frequency=700:duration=3"];
  if (audioOnly) {
    await run("ffmpeg", ["-y", ...audio, "-filter_complex", "[0:a][1:a]amerge=inputs=2[a]", "-map", "[a]", "-c:a", "libmp3lame", path]);
  } else {
    await run("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=green:s=320x240:d=3:r=24", ...audio, "-filter_complex", "[1:a][2:a]amerge=inputs=2[a]", "-map", "0:v", "-map", "[a]", "-c:v", "libx264", "-c:a", "aac", "-shortest", path]);
  }
  const key = `uploads/${name}`;
  await uploadFile(key, path);
  return key;
}

test("a video goes through the whole pipeline, keeps its background, and a re-dub only re-voices edited lines", async () => {
  const input = await storedVideo("market.mp4");
  let job = await database.createJob({
    user_id: "creator", source_language: "yo", target_language: "en", voice_clone: true, input_storage_path: input, original_filename: "market.mp4",
    options_json: { keep_background: true, captions: "classic", formats: ["1:1"], watermark: true, tone: "natural" },
  });
  job = await runJob(job);
  assert.equal(job.status, "done", job.error_message);
  const kinds = job.outputs_json.map((output) => output.format || output.aspect || output.kind);
  for (const kind of ["video", "audio", "srt", "vtt", "ass", "captioned", "1:1"]) assert.ok(kinds.includes(kind), `missing ${kind} output`);
  assert.deepEqual(job.translated_segments_json.map((segment) => segment.text), ["EN Bawo ni", "EN E kaabo"]);
  assert.equal(job.metadata_json.title, "Welcome to Lagos");
  assert.deepEqual(job.metadata_json.hashtags, ["#lagos", "#naija"]);
  assert.equal(job.options_json.background_cached, true, "the separated background is stored for re-dubs");
  assert.equal(eleven.tts.length, 2);
  assert.equal(eleven.clones, 1);
  assert.equal(eleven.deletes, 1, "temporary clones are deleted");
  const square = job.outputs_json.find((output) => output.aspect === "1:1");
  const squareVideo = (await getMediaInfo(localPath(square.path))).streams.find((stream) => stream.codec_type === "video");
  assert.equal(Number(squareVideo.width), Number(squareVideo.height));
  const costs = await jobCosts(job.id);
  assert.ok(costs.total_usd > 0);
  assert.ok(costs.items.some((item) => item.provider === "elevenlabs" && item.operation === "speech"));

  // Edit one line and re-dub: transcription and translation are reused; only the edited line is synthesized.
  const transcriptionCalls = calls.transcription;
  const translated = [...job.translated_segments_json];
  translated[1] = { ...translated[1], text: "You are welcome" };
  await database.updateJob(job.id, { translated_segments_json: translated, status: "queued", redub_count: 1 });
  eleven.tts = [];
  job = await runJob(await database.getJob(job.id));
  assert.equal(job.status, "done", job.error_message);
  assert.equal(calls.transcription, transcriptionCalls, "no second transcription");
  assert.deepEqual(eleven.tts.map((call) => call.text), ["You are welcome"]);
});

test("review mode pauses before dubbing and resumes after approval", async () => {
  const input = await storedVideo("review.mp4");
  let job = await database.createJob({ user_id: "creator", source_language: "yo", target_language: "en", voice_clone: false, input_storage_path: input, options_json: { review: true, keep_background: false } });
  job = await runJob(job);
  assert.equal(job.status, "awaiting_review");
  assert.equal(job.output_video_path, null);
  job = await database.updateJob(job.id, { review_state: "approved", status: "queued" });
  eleven.tts = [];
  job = await runJob(job);
  assert.equal(job.status, "done", job.error_message);
  assert.ok(eleven.tts.every((call) => call.voice === "stock-voice"), "standard voice when cloning is off");
});

test("audio-only uploads produce a dubbed MP3", async () => {
  const input = await storedVideo("podcast.mp3", { audioOnly: true });
  let job = await database.createJob({ user_id: "creator", source_language: "yo", target_language: "en", voice_clone: false, input_storage_path: input, media_type: "audio", options_json: { keep_background: false } });
  job = await runJob(job);
  assert.equal(job.status, "done", job.error_message);
  assert.equal(job.outputs_json[0].kind, "audio");
  assert.match(job.output_video_path, /\.mp3$/);
});

test("multi-speaker videos are diarized and each speaker gets their own voice", async () => {
  const input = await storedVideo("interview.mp4");
  eleven.tts = [];
  const clonesBefore = eleven.clones;
  const scribeBefore = eleven.scribe;
  let job = await database.createJob({ user_id: "creator", source_language: "yo", target_language: "en", voice_clone: true, input_storage_path: input, options_json: { multi_speaker: true, keep_background: false } });
  job = await runJob(job);
  assert.equal(job.status, "done", job.error_message);
  assert.equal(eleven.scribe - scribeBefore, 1);
  assert.deepEqual(job.speakers_json.map((speaker) => speaker.id), ["speaker_0", "speaker_1"]);
  assert.equal(eleven.clones - clonesBefore, 0, "speakers under 4 seconds use distinct stock voices instead of clones");
  assert.equal(new Set(eleven.tts.map((call) => call.voice)).size, 2);
});

test("subtitles-only projects make subtitle files and a captioned copy, with no voice at all", async () => {
  const input = await storedVideo("subtitles.mp4");
  eleven.tts = [];
  let job = await database.createJob({ user_id: "creator", source_language: "yo", target_language: "en", voice_clone: false, input_storage_path: input, options_json: { mode: "subtitles", captions: "boxed" } });
  job = await runJob(job);
  assert.equal(job.status, "done", job.error_message);
  assert.equal(eleven.tts.length, 0, "no voice is generated");
  const kinds = job.outputs_json.map((output) => output.format || output.kind);
  for (const kind of ["srt", "vtt", "srt-original", "ass", "captioned"]) assert.ok(kinds.includes(kind), `missing ${kind}`);
  const captioned = job.outputs_json.find((output) => output.kind === "captioned");
  const info = await getMediaInfo(localPath(captioned.path));
  assert.ok(info.streams.some((stream) => stream.codec_type === "audio"), "the original audio is kept");
});

test("Yoruba dubs use Spitch's native voices, Spitch translation and Yoruba tone marks", async () => {
  const input = await storedVideo("yoruba.mp4");
  eleven.tts = [];
  spitch.speech = [];
  let job = await database.createJob({ user_id: "creator", source_language: "en", target_language: "yo", voice_clone: false, input_storage_path: input, options_json: { keep_background: false, nigerian_voice: "sade" } });
  job = await runJob(job);
  assert.equal(job.status, "done", job.error_message);
  assert.equal(eleven.tts.length, 0, "ElevenLabs isn't used for a native Yoruba voice");
  assert.ok(spitch.translate.every((call) => call.target === "yo"));
  assert.deepEqual(job.translated_segments_json.map((segment) => segment.text), ["Báwo ni", "Ẹ káàbọ̀"], "tone marks are restored");
  assert.deepEqual(spitch.speech.map((call) => call.text), ["Báwo ni", "Ẹ káàbọ̀"]);
  assert.ok(spitch.speech.every((call) => call.voice === "sade" && call.language === "yo"), "the creator's chosen voice");
  const costs = await jobCosts(job.id);
  assert.ok(costs.items.some((item) => item.provider === "spitch" && item.operation === "speech"));
});

test("a cloned voice for a Yoruba dub still uses ElevenLabs (Spitch voices are stock voices)", async () => {
  const input = await storedVideo("yoruba-clone.mp4");
  eleven.tts = [];
  spitch.speech = [];
  const job = await runJob(await database.createJob({ user_id: "creator", source_language: "en", target_language: "yo", voice_clone: true, input_storage_path: input, options_json: { keep_background: false } }));
  assert.equal(job.status, "done", job.error_message);
  assert.equal(spitch.speech.length, 0);
  assert.equal(eleven.tts.length, 2);
});

test("human review pauses for a native speaker, then the job continues once they submit", async () => {
  const { query } = await import("../src/db.js");
  const reviews = await import("../src/reviews.js");
  const input = await storedVideo("reviewed.mp4");
  let job = await runJob(await database.createJob({ user_id: "creator", source_language: "yo", target_language: "en", voice_clone: false, input_storage_path: input, options_json: { human_review: true, keep_background: false } }));
  assert.equal(job.status, "awaiting_review");
  assert.equal(job.review_state, "human_pending");
  assert.equal(job.output_video_path, null);
  await query("INSERT INTO profiles (user_id, email, referral_code, is_reviewer, reviewer_languages) VALUES ('rev', 'rev@example.com', 'REV0001', $1, 'en')", [true]);
  const reviewer = await reviews.reviewerProfile("rev");
  const { open } = await reviews.tasksForReviewer(reviewer);
  const task = open.find((item) => item.job_id === job.id);
  assert.ok(task, "the task is offered to English reviewers");
  assert.equal(task.payout_ngn, Math.round(task.minutes * 300));
  await reviews.claimTask(task.id, reviewer);
  assert.equal(await reviews.isReviewingJob("rev", job.id), true);
  await reviews.submitTask(task.id, reviewer, "Fixed a name");
  job = await database.getJob(job.id);
  assert.equal(job.status, "queued");
  assert.equal(job.review_state, "approved");
  job = await runJob(job);
  assert.equal(job.status, "done", job.error_message);
  assert.equal((await reviews.reviewerEarnings("rev")).owed_ngn, task.payout_ngn);
  assert.equal((await reviews.markReviewerPaid("rev")).tasks, 1);
  assert.equal((await reviews.reviewerEarnings("rev")).paid_ngn, task.payout_ngn);
});

test("short clips are cut from a finished dub as captioned vertical videos", async () => {
  const path = join(dir, "long.mp4");
  await run("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=orange:s=320x240:d=60:r=24", "-f", "lavfi", "-i", "sine=frequency=500:duration=60", "-shortest", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", path]);
  await uploadFile("jobs/long/output.mp4", path);
  const segments = Array.from({ length: 6 }, (_, index) => ({ start: index * 10, end: index * 10 + 9.5, text: `Line ${index + 1} of the talk` }));
  let job = await database.createJob({ user_id: "creator", source_language: "yo", target_language: "en", input_storage_path: "", options_json: { task: "clips", captions: "bold" } });
  job = await database.updateJob(job.id, {
    status: "processing", duration_seconds: 60, translated_segments_json: segments, outputs_json: [{ kind: "video", label: "Dubbed video (MP4)", path: "jobs/long/output.mp4" }],
  });
  job = await runJob(job);
  assert.equal(job.status, "done", job.error_message || job.processing_note);
  const clips = job.outputs_json.filter((output) => output.kind === "clip");
  assert.equal(clips.length, 1, "clips shorter than 15 seconds are skipped");
  assert.equal(clips[0].label, "Clip 1: The best bit");
  assert.equal(clips[0].start, 0);
  assert.equal(clips[0].end, 29.5);
  assert.equal(job.options_json.task, undefined, "the clips task is cleared");
  const video = (await getMediaInfo(localPath(clips[0].path))).streams.find((stream) => stream.codec_type === "video");
  assert.ok(Number(video.height) > Number(video.width), "clips are vertical");
  assert.ok(job.outputs_json.some((output) => output.kind === "video"), "the original dub is kept");
});
