import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import OpenAI from "openai";
import { config } from "./config.js";
import { recordCost } from "./costs.js";
import { getLanguage } from "./languages.js";
import { logger } from "./logger.js";
import { runCapture } from "./media.js";
import { responseError, withRetries } from "./retry.js";
import { spitchVoiceFor, synthesizeWithSpitch, useSpitchVoice } from "./spitch.js";

const ELEVENLABS_API = "https://api.elevenlabs.io";
const TRACK_SAMPLE_RATE = 24000;
const MAX_SEGMENT_SPEEDUP = 1.5;
const MAX_TOTAL_SPEEDUP = 2.5;
const SPEAKER_SAMPLE_SECONDS = 150;
const MIN_CLONE_SECONDS = 4;
const TTS_CONCURRENCY = 2;
const OPENAI_VOICES = ["alloy", "onyx", "nova", "echo", "shimmer", "fable"];

let modelLanguagesCache = null;

export function resetElevenLabsCache() {
  modelLanguagesCache = null;
}

function elevenHeaders(extra = {}) {
  return { "xi-api-key": config.elevenlabsApiKey, ...extra };
}

async function runFfmpeg(args, captureStdout = false) {
  const { stdout } = await runCapture("ffmpeg", args, { binary: true });
  return captureStdout ? stdout : undefined;
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

export async function createSpeakerSample(sourceAudioPath, segments, outputPath) {
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

/** Creates an ElevenLabs instant voice clone from an audio sample file. */
export async function cloneFromSample(samplePath, name, description) {
  const form = new FormData();
  form.append("name", name);
  form.append("description", description);
  form.append("remove_background_noise", "true");
  form.append("files", new Blob([await readFile(samplePath)], { type: "audio/mpeg" }), "speaker-sample.mp3");
  const response = await elevenFetch("/v1/voices/add", { method: "POST", headers: elevenHeaders(), body: form }, "Speaker voice cloning");
  const clone = await response.json();
  if (!clone.voice_id) throw new Error("ElevenLabs did not return a voice ID for the uploaded speaker.");
  return clone.voice_id;
}

async function cloneSpeaker(sourceAudioPath, sourceSegments, workdir, label) {
  const samplePath = join(workdir, `speaker-sample-${label}.mp3`);
  await createSpeakerSample(sourceAudioPath, sourceSegments, samplePath);
  return cloneFromSample(samplePath, `ReelLingo temporary speaker ${Date.now()}`, "Temporary clone made from speech in the user's uploaded video.");
}

export async function deleteVoice(voiceId) {
  try {
    const response = await fetch(`${ELEVENLABS_API}/v1/voices/${encodeURIComponent(voiceId)}`, { method: "DELETE", headers: elevenHeaders() });
    if (!response.ok) logger.warn({ voiceId, status: response.status }, "Could not delete ElevenLabs voice");
  } catch (error) {
    logger.warn({ err: error, voiceId }, "Could not delete ElevenLabs voice");
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

export async function synthesizeWithElevenLabs(text, voiceId, languageCode) {
  const body = { model_id: config.elevenlabsModel, text };
  if (languageCode) body.language_code = languageCode;
  const response = await elevenFetch(`/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: elevenHeaders({ "Content-Type": "application/json", Accept: "audio/mpeg" }),
    body: JSON.stringify(body),
  }, "ElevenLabs speech synthesis");
  const audio = Buffer.from(await response.arrayBuffer());
  if (!audio.length) throw new Error("ElevenLabs returned an empty audio clip.");
  await recordCost("elevenlabs", "speech", text.length, "characters", (text.length / 1000) * config.costs.elevenlabsPer1kChars);
  return audio;
}

let openai;
export async function synthesizeWithOpenAI(text, targetLanguage, voice = "alloy") {
  if (!config.openaiApiKey) throw new Error("OPENAI_API_KEY is required for speech synthesis.");
  openai ||= new OpenAI({ apiKey: config.openaiApiKey, baseURL: config.openaiBaseUrl, timeout: 120_000 });
  const target = getLanguage(targetLanguage)?.name || targetLanguage;
  const audio = await withRetries(async () => {
    const response = await openai.audio.speech.create({
      model: config.openaiTtsModel,
      voice,
      input: text,
      instructions: `Speak naturally and clearly in ${target}. Read the text exactly as written.`,
      response_format: "mp3",
    });
    return Buffer.from(await response.arrayBuffer());
  }, { label: "OpenAI speech synthesis" });
  await recordCost("openai", "speech", text.length, "characters", (text.length / 1000) * config.costs.openaiTtsPer1kChars);
  return audio;
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

function speakerOf(segment) {
  return segment.speaker || "speaker_0";
}

/** Speakers ordered by how long they talk, so the main speaker gets the saved voice and the first stock voice. */
export function rankSpeakers(segments) {
  const talk = new Map();
  for (const segment of segments) {
    const speaker = speakerOf(segment);
    talk.set(speaker, (talk.get(speaker) || 0) + Math.max(0, segment.end - segment.start));
  }
  return [...talk.entries()].sort((first, second) => second[1] - first[1]).map(([speaker, seconds]) => ({ speaker, seconds }));
}

function stockVoiceFor(rank) {
  if (rank === 0) return config.elevenlabsFallbackVoiceId;
  const others = config.elevenlabsStockVoices.filter((voice) => voice !== config.elevenlabsFallbackVoiceId);
  return others.length ? others[(rank - 1) % others.length] : config.elevenlabsFallbackVoiceId;
}

export function clipCacheKey(parts) {
  return createHash("sha1").update(JSON.stringify(parts)).digest("hex").slice(0, 20);
}

/**
 * Synthesizes each translated segment and lays the clips on the video timeline.
 * Each speaker gets their own voice: a saved voice, a temporary clone of their speech, or a distinct stock voice.
 * `clipCache` ({ get(key) → path|null }) lets a re-dub reuse clips whose text and voice haven't changed.
 */
export async function dubSegments({
  segments, sourceAudioPath, sourceSegments = segments, outputPath, targetLanguage, voiceClone, durationSeconds, workdir,
  savedVoiceId = null, clipCache = null, voiceScope = "job", preferredVoice = null,
}) {
  const speakable = segments.map((segment, index) => ({ ...segment, index })).filter((segment) => segment.text?.trim());
  if (!speakable.length) throw new Error("No translated speech is available to dub.");
  const clipsDirectory = join(workdir, "dub-clips");
  await mkdir(clipsDirectory, { recursive: true });

  // Yoruba, Hausa, Igbo and Pidgin use Spitch's native Nigerian voices unless the creator wants their own (cloned) voice.
  const nativeVoices = useSpitchVoice(targetLanguage, { cloned: Boolean(voiceClone || savedVoiceId) });
  let provider = nativeVoices ? "spitch" : config.elevenlabsApiKey ? "elevenlabs" : "openai";
  let fallbackReason = provider === "openai" ? "ElevenLabs is not configured." : null;
  const ranked = rankSpeakers(sourceSegments.length ? sourceSegments : speakable);
  const rankOf = new Map(ranked.map((item, index) => [item.speaker, index]));

  const voiceKeyFor = (speaker) => {
    const rank = rankOf.get(speaker) ?? 0;
    if (provider === "spitch") return `spitch:${spitchVoiceFor(targetLanguage, rank, preferredVoice)}`;
    if (provider === "openai") return `openai:${OPENAI_VOICES[rank % OPENAI_VOICES.length]}`;
    if (savedVoiceId && rank === 0) return `saved:${savedVoiceId}`;
    if (voiceClone) return `clone:${voiceScope}:${speaker}`;
    return `stock:${stockVoiceFor(rank)}`;
  };
  const keyFor = (segment) => clipCacheKey([provider, config.elevenlabsModel, voiceKeyFor(speakerOf(segment)), targetLanguage, segment.text.trim()]);

  const cached = new Map();
  if (clipCache) {
    for (const segment of speakable) {
      const hit = await clipCache.get(keyFor(segment));
      if (hit) cached.set(segment.index, hit);
    }
  }
  const pending = speakable.filter((segment) => !cached.has(segment.index));

  if (provider === "elevenlabs" && pending.length) {
    const characters = pending.reduce((sum, segment) => sum + segment.text.length, 0);
    const remaining = await remainingCharacters();
    if (remaining !== null && remaining < characters) {
      provider = "openai";
      fallbackReason = `ElevenLabs character quota is too low (${Math.max(0, remaining)} left, ${characters} needed).`;
    }
  }

  // Choose a concrete voice ID per speaker, cloning only speakers who still need new clips.
  const voices = new Map();
  const clones = [];
  const speakerResults = [];
  if (provider === "elevenlabs") {
    let cloningBlocked = false;
    for (const { speaker, seconds } of ranked) {
      const rank = rankOf.get(speaker);
      let voiceId = stockVoiceFor(rank);
      let cloned = false;
      const needsClips = pending.some((segment) => speakerOf(segment) === speaker);
      if (savedVoiceId && rank === 0) {
        voiceId = savedVoiceId;
      } else if (voiceClone && needsClips && !cloningBlocked) {
        const speakerSegments = sourceSegments.filter((segment) => speakerOf(segment) === speaker);
        if (seconds < MIN_CLONE_SECONDS && ranked.length > 1) {
          fallbackReason ||= "Some speakers talk too briefly to clone, so they use a standard voice.";
        } else {
          try {
            voiceId = await cloneSpeaker(sourceAudioPath, speakerSegments.length ? speakerSegments : sourceSegments, workdir, rank);
            clones.push(voiceId);
            cloned = true;
          } catch (error) {
            fallbackReason = `Speaker cloning unavailable: ${explainCloneFailure(error)}`;
            cloningBlocked = true;
          }
        }
      }
      voices.set(speaker, voiceId);
      speakerResults.push({ speaker, seconds: Math.round(seconds * 10) / 10, voice: savedVoiceId && rank === 0 ? "saved" : cloned ? "clone" : "standard" });
    }
  } else if (provider === "spitch") {
    for (const { speaker, seconds } of ranked) {
      voices.set(speaker, spitchVoiceFor(targetLanguage, rankOf.get(speaker), preferredVoice));
      speakerResults.push({ speaker, seconds: Math.round(seconds * 10) / 10, voice: "native" });
    }
  } else {
    for (const { speaker, seconds } of ranked) {
      voices.set(speaker, OPENAI_VOICES[rankOf.get(speaker) % OPENAI_VOICES.length]);
      speakerResults.push({ speaker, seconds: Math.round(seconds * 10) / 10, voice: "standard" });
    }
  }

  const produced = [];
  try {
    const supported = provider === "elevenlabs" ? await modelLanguages() : new Set();
    const languageCode = supported.has(targetLanguage) ? targetLanguage : undefined;
    const fresh = await mapWithConcurrency(pending, TTS_CONCURRENCY, async (segment) => {
      const voice = voices.get(speakerOf(segment)) || (provider === "openai" ? "alloy" : provider === "spitch" ? spitchVoiceFor(targetLanguage, 0, preferredVoice) : config.elevenlabsFallbackVoiceId);
      const audio = provider === "spitch"
        ? await synthesizeWithSpitch(segment.text.trim(), voice, targetLanguage)
        : provider === "elevenlabs"
          ? await synthesizeWithElevenLabs(segment.text.trim(), voice, languageCode)
          : await synthesizeWithOpenAI(segment.text.trim(), targetLanguage, voice);
      const path = join(clipsDirectory, `clip-${String(segment.index).padStart(4, "0")}.mp3`);
      await writeFile(path, audio);
      produced.push({ key: keyFor(segment), path });
      return { index: segment.index, path };
    });
    const pathByIndex = new Map([...cached.entries(), ...fresh.map((clip) => [clip.index, clip.path])]);
    const clips = speakable.map((segment) => ({ path: pathByIndex.get(segment.index), start: segment.start, end: segment.end }));
    await layoutDubTrack(clips, durationSeconds, outputPath);
  } finally {
    for (const cloneId of clones) await deleteVoice(cloneId);
  }

  return {
    voiceCloned: clones.length > 0 || Boolean(savedVoiceId),
    provider,
    fallbackReason,
    newClips: produced,
    reusedClips: cached.size,
    speakers: speakerResults,
    keys: speakable.map((segment) => ({ index: segment.index, key: keyFor(segment) })),
  };
}

/**
 * Synthesizes each translated segment separately and lays the clips on the video timeline,
 * so the dub stays in sync and no sentence is cut off at the end of the video.
 */
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
