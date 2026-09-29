import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import OpenAI from "openai";
import { config } from "./config.js";
import { getLanguage } from "./languages.js";
import { responseError, withRetries } from "./retry.js";

const ELEVENLABS_API = "https://api.elevenlabs.io";
const TRACK_SAMPLE_RATE = 24000;
const MAX_SEGMENT_SPEEDUP = 1.5;
const MAX_TOTAL_SPEEDUP = 2.5;
const SPEAKER_SAMPLE_SECONDS = 150;
const TTS_CONCURRENCY = 2;

let modelLanguagesCache = null;

export function resetElevenLabsCache() {
  modelLanguagesCache = null;
}

function elevenHeaders(extra = {}) {
  return { "xi-api-key": config.elevenlabsApiKey, ...extra };
}

function runFfmpeg(args, captureStdout = false) {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, { stdio: ["ignore", captureStdout ? "pipe" : "ignore", "pipe"] });
    const chunks = [];
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    if (captureStdout) child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(captureStdout ? Buffer.concat(chunks) : undefined);
      else reject(new Error(stderr.trim().split("\n").slice(-3).join(" ") || `ffmpeg exited with code ${code}`));
    });
  });
}

async function elevenFetch(path, options, context) {
  return withRetries(async () => {
    const response = await fetch(`${ELEVENLABS_API}${path}`, options);
    if (!response.ok) throw await responseError(response, context);
    return response;
  }, { label: context });
}

// Languages the configured model accepts in `language_code`. Sending any other code is rejected with a 400.
async function modelLanguages() {
  if (modelLanguagesCache) return modelLanguagesCache;
  try {
    const response = await elevenFetch("/v1/models", { headers: elevenHeaders() }, "ElevenLabs model lookup");
    const models = await response.json();
    const model = models.find((item) => item.model_id === config.elevenlabsModel);
    modelLanguagesCache = new Set((model?.languages || []).map((language) => language.language_id));
  } catch {
    modelLanguagesCache = new Set();
  }
  return modelLanguagesCache;
}

async function remainingCharacters() {
  try {
    const response = await fetch(`${ELEVENLABS_API}/v1/user/subscription`, { headers: elevenHeaders() });
    if (!response.ok) return null;
    const subscription = await response.json();
    return Number(subscription.character_limit) - Number(subscription.character_count);
  } catch {
    return null;
  }
}

async function createSpeakerSample(sourceAudioPath, segments, outputPath) {
  const picked = [];
  let total = 0;
  for (const segment of segments) {
    if (!(Number.isFinite(segment.start) && Number.isFinite(segment.end) && segment.end > segment.start)) continue;
    picked.push(segment);
    total += segment.end - segment.start;
    if (total >= SPEAKER_SAMPLE_SECONDS) break;
  }
  if (!picked.length) throw new Error("No speech intervals were found to create a voice sample.");
  const filters = picked.map((segment, index) => (
    `[0:a]atrim=start=${Math.max(0, segment.start)}:end=${segment.end},asetpts=PTS-STARTPTS,highpass=f=80,lowpass=f=8000,afftdn[a${index}]`
  ));
  filters.push(`${picked.map((_, index) => `[a${index}]`).join("")}concat=n=${picked.length}:v=0:a=1[out]`);
  const scriptPath = `${outputPath}.filter.txt`;
  await writeFile(scriptPath, filters.join(";\n"));
  const encode = ["-map", "[out]", "-ac", "1", "-ar", "44100", "-c:a", "libmp3lame", "-b:a", "128k", outputPath];
  // The filter graph lives in a file to avoid command-line length limits on long videos.
  // ffmpeg 7+ reads it with "-/filter_complex"; older builds (Debian's 5.x in Docker) use "-filter_complex_script".
  try {
    await runFfmpeg(["-y", "-i", sourceAudioPath, "-/filter_complex", scriptPath, ...encode]);
  } catch (error) {
    if (!/unrecognized option|option not found/i.test(String(error?.message))) throw error;
    await runFfmpeg(["-y", "-i", sourceAudioPath, "-filter_complex_script", scriptPath, ...encode]);
  }
  return outputPath;
}

async function cloneSpeaker(sourceAudioPath, sourceSegments, workdir) {
  const samplePath = join(workdir, "speaker-sample.mp3");
  await createSpeakerSample(sourceAudioPath, sourceSegments, samplePath);
  const form = new FormData();
  form.append("name", `ReelLingo temporary speaker ${Date.now()}`);
  form.append("description", "Temporary clone made from speech in the user's uploaded video.");
  form.append("remove_background_noise", "true");
  form.append("files", new Blob([await readFile(samplePath)], { type: "audio/mpeg" }), "speaker-sample.mp3");
  const response = await elevenFetch("/v1/voices/add", { method: "POST", headers: elevenHeaders(), body: form }, "Speaker voice cloning");
  const clone = await response.json();
  if (!clone.voice_id) throw new Error("ElevenLabs did not return a voice ID for the uploaded speaker.");
  return clone.voice_id;
}

async function deleteVoice(voiceId) {
  try {
    const response = await fetch(`${ELEVENLABS_API}/v1/voices/${encodeURIComponent(voiceId)}`, { method: "DELETE", headers: elevenHeaders() });
    if (!response.ok) console.warn(`Could not delete temporary ElevenLabs voice ${voiceId} (${response.status}).`);
  } catch (error) {
    console.warn("Could not delete temporary ElevenLabs voice.", error);
  }
}

function explainCloneFailure(error) {
  const body = String(error?.cause?.body || error?.body || error?.message || "");
  try {
    const detail = JSON.parse(body).detail;
    if (detail?.message) return detail.message;
  } catch {
    // body was not JSON
  }
  return error instanceof Error ? error.message : String(error);
}

async function synthesizeWithElevenLabs(text, voiceId, languageCode) {
  const body = { model_id: config.elevenlabsModel, text };
  if (languageCode) body.language_code = languageCode;
  const response = await elevenFetch(`/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: elevenHeaders({ "Content-Type": "application/json", Accept: "audio/mpeg" }),
    body: JSON.stringify(body),
  }, "ElevenLabs speech synthesis");
  const audio = Buffer.from(await response.arrayBuffer());
  if (!audio.length) throw new Error("ElevenLabs returned an empty audio clip.");
  return audio;
}

let openai;
async function synthesizeWithOpenAI(text, targetLanguage) {
  if (!config.openaiApiKey) throw new Error("OPENAI_API_KEY is required for speech synthesis.");
  openai ||= new OpenAI({ apiKey: config.openaiApiKey, baseURL: config.openaiBaseUrl, timeout: 120_000 });
  const target = getLanguage(targetLanguage)?.name || targetLanguage;
  return withRetries(async () => {
    const response = await openai.audio.speech.create({
      model: config.openaiTtsModel,
      voice: "alloy",
      input: text,
      instructions: `Speak naturally and clearly in ${target}. Read the text exactly as written.`,
      response_format: "mp3",
    });
    return Buffer.from(await response.arrayBuffer());
  }, { label: "OpenAI speech synthesis" });
}

async function mapWithConcurrency(items, limit, task) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await task(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Synthesizes each translated segment separately and lays the clips on the video timeline,
 * so the dub stays in sync and no sentence is cut off at the end of the video.
 */
export async function dubSegments({ segments, sourceAudioPath, sourceSegments = segments, outputPath, targetLanguage, voiceClone, durationSeconds, workdir }) {
  const speakable = segments.filter((segment) => segment.text?.trim());
  if (!speakable.length) throw new Error("No translated speech is available to dub.");
  const clipsDirectory = join(workdir, "dub-clips");
  await mkdir(clipsDirectory, { recursive: true });

  const characters = speakable.reduce((sum, segment) => sum + segment.text.length, 0);
  let provider = config.elevenlabsApiKey ? "elevenlabs" : "openai";
  let fallbackReason = provider === "openai" ? "ElevenLabs is not configured." : null;
  if (provider === "elevenlabs") {
    const remaining = await remainingCharacters();
    if (remaining !== null && remaining < characters) {
      provider = "openai";
      fallbackReason = `ElevenLabs character quota is too low (${Math.max(0, remaining)} left, ${characters} needed).`;
    }
  }

  let voiceId = config.elevenlabsFallbackVoiceId;
  let cloneId = null;
  if (provider === "elevenlabs" && voiceClone) {
    try {
      cloneId = await cloneSpeaker(sourceAudioPath, sourceSegments, workdir);
      voiceId = cloneId;
    } catch (error) {
      fallbackReason = `Speaker cloning unavailable: ${explainCloneFailure(error)}`;
    }
  }

  try {
    const supported = provider === "elevenlabs" ? await modelLanguages() : new Set();
    const languageCode = supported.has(targetLanguage) ? targetLanguage : undefined;
    const clips = await mapWithConcurrency(speakable, TTS_CONCURRENCY, async (segment, index) => {
      const audio = provider === "elevenlabs"
        ? await synthesizeWithElevenLabs(segment.text.trim(), voiceId, languageCode)
        : await synthesizeWithOpenAI(segment.text.trim(), targetLanguage);
      const path = join(clipsDirectory, `clip-${String(index).padStart(4, "0")}.mp3`);
      await writeFile(path, audio);
      return { path, start: segment.start, end: segment.end };
    });
    await layoutDubTrack(clips, durationSeconds, outputPath);
  } finally {
    if (cloneId) await deleteVoice(cloneId);
  }

  return { voiceCloned: Boolean(cloneId), provider, fallbackReason };
}

async function decodeClip(path, tempo = 1) {
  const filters = [];
  let remaining = tempo;
  while (remaining > 2) {
    filters.push("atempo=2");
    remaining /= 2;
  }
  if (Math.abs(remaining - 1) > 0.001) filters.push(`atempo=${remaining.toFixed(4)}`);
  const args = ["-v", "error", "-i", path];
  if (filters.length) args.push("-af", filters.join(","));
  args.push("-ac", "1", "-ar", String(TRACK_SAMPLE_RATE), "-f", "s16le", "pipe:1");
  return runFfmpeg(args, true);
}

function plan(clips, durations, totalDuration, globalSpeed) {
  let cursor = 0;
  const placements = clips.map((clip, index) => {
    const start = Math.max(clip.start, cursor);
    const nextStart = index + 1 < clips.length ? Math.max(clips[index + 1].start, start) : totalDuration;
    const slot = Math.max(nextStart - start, 0.25);
    const speed = Math.min(Math.max(durations[index] / slot, 1), MAX_SEGMENT_SPEEDUP) * globalSpeed;
    cursor = start + durations[index] / speed;
    return { start, speed };
  });
  return { placements, end: cursor };
}

/** Places each clip at its segment start on a silent track exactly `totalDuration` seconds long. */
export async function layoutDubTrack(clips, totalDuration, outputPath) {
  const ordered = [...clips].sort((first, second) => first.start - second.start);
  const raw = await Promise.all(ordered.map((clip) => decodeClip(clip.path)));
  const durations = raw.map((buffer) => buffer.length / 2 / TRACK_SAMPLE_RATE);

  let globalSpeed = 1;
  let layout = plan(ordered, durations, totalDuration, globalSpeed);
  for (let attempt = 0; attempt < 6 && layout.end > totalDuration + 0.01 && globalSpeed < MAX_TOTAL_SPEEDUP; attempt += 1) {
    globalSpeed = Math.min(globalSpeed * (layout.end / totalDuration) * 1.01, MAX_TOTAL_SPEEDUP);
    layout = plan(ordered, durations, totalDuration, globalSpeed);
  }

  const totalSamples = Math.round(totalDuration * TRACK_SAMPLE_RATE);
  const track = Buffer.alloc(totalSamples * 2);
  for (let index = 0; index < ordered.length; index += 1) {
    const { start, speed } = layout.placements[index];
    const samples = Math.abs(speed - 1) > 0.001 ? await decodeClip(ordered[index].path, speed) : raw[index];
    const offset = Math.round(start * TRACK_SAMPLE_RATE) * 2;
    for (let position = 0; position + 1 < samples.length && offset + position + 1 < track.length; position += 2) {
      const mixed = track.readInt16LE(offset + position) + samples.readInt16LE(position);
      track.writeInt16LE(Math.max(-32768, Math.min(32767, mixed)), offset + position);
    }
  }

  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + track.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(TRACK_SAMPLE_RATE, 24);
  header.writeUInt32LE(TRACK_SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(track.length, 40);
  await writeFile(outputPath, Buffer.concat([header, track]));
  return outputPath;
}
