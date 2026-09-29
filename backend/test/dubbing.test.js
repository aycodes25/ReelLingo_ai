import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

process.env.ELEVENLABS_API_KEY = "test-elevenlabs-key";
process.env.ELEVENLABS_MODEL = "eleven_v4";
process.env.ELEVENLABS_FALLBACK_VOICE_ID = "stock-voice";
const { dubSegments, layoutDubTrack, resetElevenLabsCache } = await import("../src/dubbing.js");

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

async function tone(path, seconds, frequency = 440) {
  await run("ffmpeg", ["-y", "-f", "lavfi", "-i", `sine=frequency=${frequency}:duration=${seconds}`, "-ar", "44100", "-ac", "1", "-c:a", "libmp3lame", path]);
  return readFile(path);
}

async function durationOf(path) {
  return Number.parseFloat(await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", path], true));
}

// Returns per-100ms RMS loudness so tests can see where speech was placed on the timeline.
async function loudnessProfile(path) {
  const raw = await new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", ["-v", "error", "-i", path, "-ac", "1", "-ar", "8000", "-f", "s16le", "pipe:1"], { stdio: ["ignore", "pipe", "pipe"] });
    const chunks = [];
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error("decode failed"))));
  });
  const window = 800;
  const profile = [];
  for (let offset = 0; offset + window * 2 <= raw.length; offset += window * 2) {
    let sum = 0;
    for (let index = offset; index < offset + window * 2; index += 2) sum += raw.readInt16LE(index) ** 2;
    profile.push(Math.sqrt(sum / window));
  }
  return profile;
}

const MODELS_RESPONSE = [{ model_id: "eleven_v4", languages: [{ language_id: "en" }, { language_id: "yo" }] }];

function mockElevenLabs({ cloneStatus = 200, cloneBody = { voice_id: "clone-id" }, clipBytes, failFirstTts = false }) {
  const requests = [];
  let ttsFailures = failFirstTts ? 1 : 0;
  const fetchMock = async (url, options = {}) => {
    const href = String(url);
    requests.push({ url: href, method: options.method || "GET", body: options.body });
    if (href.endsWith("/v1/models")) return Response.json(MODELS_RESPONSE);
    if (href.endsWith("/v1/user/subscription")) return Response.json({ character_count: 0, character_limit: 100000 });
    if (href.endsWith("/v1/voices/add")) return new Response(JSON.stringify(cloneBody), { status: cloneStatus });
    if (href.includes("/v1/text-to-speech/")) {
      if (ttsFailures > 0) {
        ttsFailures -= 1;
        return new Response(JSON.stringify({ detail: "too_many_concurrent_requests" }), { status: 429 });
      }
      return new Response(clipBytes, { status: 200 });
    }
    if (href.includes("/v1/voices/") && options.method === "DELETE") return new Response(null, { status: 200 });
    throw new Error(`Unexpected request ${href}`);
  };
  return { requests, fetchMock };
}

test("falls back to a stock voice when the ElevenLabs plan cannot clone, and still dubs every segment", async () => {
  const dir = await mkdtemp(join(tmpdir(), "reellingo-dub-fallback-"));
  const originalFetch = globalThis.fetch;
  try {
    resetElevenLabsCache();
    const source = join(dir, "source.wav");
    await run("ffmpeg", ["-y", "-f", "lavfi", "-i", "sine=frequency=300:duration=6", "-ar", "16000", "-ac", "1", source]);
    const { requests, fetchMock } = mockElevenLabs({
      cloneStatus: 400,
      cloneBody: { detail: { code: "paid_plan_required", status: "can_not_use_instant_voice_cloning", message: "Your subscription does not include instant voice cloning." } },
      clipBytes: await tone(join(dir, "clip.mp3"), 1),
    });
    globalThis.fetch = fetchMock;

    const output = join(dir, "dub.wav");
    const result = await dubSegments({
      segments: [{ start: 0.5, end: 2, text: "Bawo ni" }, { start: 3, end: 4.5, text: "E kaabo" }],
      sourceAudioPath: source,
      outputPath: output,
      targetLanguage: "yo",
      voiceClone: true,
      durationSeconds: 6,
      workdir: dir,
    });

    assert.equal(result.voiceCloned, false);
    assert.match(result.fallbackReason, /instant voice cloning/i);
    const ttsCalls = requests.filter((request) => request.url.includes("/text-to-speech/"));
    assert.equal(ttsCalls.length, 2);
    for (const call of ttsCalls) {
      assert.ok(call.url.includes("/text-to-speech/stock-voice"));
      const body = JSON.parse(call.body);
      assert.equal(body.model_id, "eleven_v4");
      assert.equal(body.language_code, "yo");
    }
    assert.deepEqual(JSON.parse(ttsCalls[0].body).text, "Bawo ni");
    assert.ok(Math.abs((await durationOf(output)) - 6) < 0.1);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});

test("uses and then deletes the cloned voice, omits unsupported language codes, and retries rate limits", async () => {
  const dir = await mkdtemp(join(tmpdir(), "reellingo-dub-clone-"));
  const originalFetch = globalThis.fetch;
  try {
    resetElevenLabsCache();
    const source = join(dir, "source.wav");
    await run("ffmpeg", ["-y", "-f", "lavfi", "-i", "sine=frequency=300:duration=4", "-ar", "16000", "-ac", "1", source]);
    const { requests, fetchMock } = mockElevenLabs({ clipBytes: await tone(join(dir, "clip.mp3"), 1), failFirstTts: true });
    globalThis.fetch = fetchMock;

    const result = await dubSegments({
      segments: [{ start: 0.2, end: 1.8, text: "Kedu" }],
      sourceAudioPath: source,
      outputPath: join(dir, "dub.wav"),
      targetLanguage: "ig",
      voiceClone: true,
      durationSeconds: 4,
      workdir: dir,
    });

    assert.equal(result.voiceCloned, true);
    const ttsCalls = requests.filter((request) => request.url.includes("/text-to-speech/"));
    assert.equal(ttsCalls.length, 2, "429 should be retried once");
    assert.ok(ttsCalls.every((call) => call.url.includes("/text-to-speech/clone-id")));
    assert.equal(JSON.parse(ttsCalls[1].body).language_code, undefined);
    assert.ok(requests.some((request) => request.method === "DELETE" && request.url.endsWith("/v1/voices/clone-id")));
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});

test("dub clips are placed at their segment times and overlong clips are sped up instead of cut", async () => {
  const dir = await mkdtemp(join(tmpdir(), "reellingo-layout-"));
  try {
    const short = join(dir, "short.mp3");
    const long = join(dir, "long.mp3");
    await tone(short, 1, 440);
    await tone(long, 3, 660);
    const output = join(dir, "track.wav");

    await layoutDubTrack([
      { path: short, start: 2, end: 3 },
      { path: long, start: 5, end: 7 },
    ], 8, output);

    assert.ok(Math.abs((await durationOf(output)) - 8) < 0.1);
    const profile = await loudnessProfile(output);
    const loud = (from, to) => profile.slice(from * 10, to * 10).every((value) => value > 1000);
    const quiet = (from, to) => profile.slice(from * 10, to * 10).every((value) => value < 50);
    assert.ok(quiet(0, 1.9), "silence before the first segment");
    assert.ok(loud(2.05, 2.95), "first clip starts at its segment");
    assert.ok(quiet(3.1, 4.9), "gap between segments stays silent");
    assert.ok(loud(5.05, 7.9), "second clip starts on time");
    const secondClipEnd = profile.findLastIndex((value) => value > 1000) / 10;
    assert.ok(secondClipEnd <= 8, `3s clip was compressed to fit before the video ends (ended at ${secondClipEnd}s)`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("dub track is uniformly compressed when speech would run past the end of the video", async () => {
  const dir = await mkdtemp(join(tmpdir(), "reellingo-layout-overflow-"));
  try {
    const clip = join(dir, "clip.mp3");
    await tone(clip, 3);
    const output = join(dir, "track.wav");
    await layoutDubTrack([{ path: clip, start: 0, end: 1 }, { path: clip, start: 1, end: 2 }], 4, output);
    const profile = await loudnessProfile(output);
    assert.ok(Math.abs((await durationOf(output)) - 4) < 0.1);
    assert.ok(profile.slice(0, 38).every((value) => value > 1000), "all six seconds of speech fit into four without being dropped");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
