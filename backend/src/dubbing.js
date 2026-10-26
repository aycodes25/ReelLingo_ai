import { availableSeconds } from "./fitlines.js";
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
import { NIGERIAN_VOICE_LANGUAGES, spitchVoiceFor, synthesizeWithSpitch, useSpitchVoice } from "./spitch.js";

const ELEVENLABS_API = "https://api.elevenlabs.io";
const TRACK_SAMPLE_RATE = 24000;
const MAX_SEGMENT_SPEEDUP = 1.5;
const MAX_TOTAL_SPEEDUP = 2.5;
const SPEAKER_SAMPLE_SECONDS = 150;
const MIN_CLONE_SECONDS = 4.7; // ElevenLabs requires at least 4.6 seconds of audio to clone
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
    return new Set();
  }
  return modelLanguagesCache;
}

/** Can the configured ElevenLabs model speak this language? true / false, or null when ElevenLabs couldn't be asked. */
export async function elevenSpeaks(language) {
  if (!config.elevenlabsApiKey) return null;
  const supported = await modelLanguages();
  return supported.size ? supported.has(language) : null;
}

// OpenAI's voices read these languages with an English accent, which is wrong for the listener, so they are never used for them.
const OPENAI_CANNOT_SPEAK = new Set(NIGERIAN_VOICE_LANGUAGES);

/** What the ElevenLabs plan allows right now: characters left, and whether it can copy a voice. Null when ElevenLabs couldn't be asked. */
export async function elevenAccount() {
  if (!config.elevenlabsApiKey) return null;
  try {
    const response = await fetch(`${ELEVENLABS_API}/v1/user/subscription`, { headers: elevenHeaders() });
    if (!response.ok) return null;
    const subscription = await response.json();
    return {
      remaining: Number(subscription.character_limit) - Number(subscription.character_count),
      // The free plan can't clone a voice; if ElevenLabs doesn't say, assume it can (a failed attempt falls back to a standard voice).
      canClone: subscription.can_use_instant_voice_cloning === undefined ? null : Boolean(subscription.can_use_instant_voice_cloning),
    };
  } catch {
    return null;
  }
}

async function remainingCharacters() {
  return (await elevenAccount())?.remaining ?? null;
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
    `[0:a]atrim=start=${Math.max(0, segment.start)}:end=${segment.end},asetpts=PTS-STARTPTS,highpass=f=70,afftdn=nf=-25[a${index}]`
  ));
  filters.push(`${picked.map((_, index) => `[a${index}]`).join("")}concat=n=${picked.length}:v=0:a=1[out]`);
  const scriptPath = `${outputPath}.filter.txt`;
  await writeFile(scriptPath, filters.join(";\n"));
  const encode = ["-map", "[out]", "-ac", "1", "-ar", "44100", "-c:a", "libmp3lame", "-b:a", "192k", outputPath];
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
  const body = {
    model_id: config.elevenlabsModel,
    text,
    voice_settings: { stability: config.voiceStability, similarity_boost: config.voiceSimilarity, style: config.voiceStyle, use_speaker_boost: true },
  };
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
  savedVoiceId = null, clipCache = null, voiceScope = "job", preferredVoice = null, refit = null,
}) {
  const speakable = segments.map((segment, index) => ({ ...segment, index })).filter((segment) => segment.text?.trim());
  if (!speakable.length) throw new Error("No translated speech is available to dub.");
  const clipsDirectory = join(workdir, "dub-clips");
  await mkdir(clipsDirectory, { recursive: true });

  // Yoruba, Hausa, Igbo and Pidgin use Spitch's native Nigerian voices unless the creator wants their own (cloned) voice,
  // and a cloned voice is only kept when ElevenLabs can really speak the language (it can't speak these ones).
  const cloning = Boolean(voiceClone || savedVoiceId);
  let nativeVoices = useSpitchVoice(targetLanguage, { cloned: cloning });
  let notice = null;
  const languageName = getLanguage(targetLanguage)?.name || targetLanguage;
  if (!nativeVoices && cloning && config.nativeVoiceWhenCloneCannotSpeak && useSpitchVoice(targetLanguage, { cloned: false })) {
    if ((await elevenAccount())?.canClone === false) {
      nativeVoices = true;
      notice = `Voice cloning isn't available on our voice plan right now, so the native ${languageName} voice was used instead.`;
    } else if (await elevenSpeaks(targetLanguage) === false) {
      nativeVoices = true;
      notice = `A cloned voice can't speak ${languageName} properly, so the native ${languageName} voice was used instead.`;
    }
  }
  let provider = nativeVoices ? "spitch" : config.elevenlabsApiKey ? "elevenlabs" : "openai";
  let fallbackReason = provider === "openai" ? "ElevenLabs is not configured." : null;
  /** Where to go when ElevenLabs can't be used: Spitch for Nigerian languages, OpenAI for the rest, and never a wrong-accent voice. */
  const fallBack = (reason) => {
    if (OPENAI_CANNOT_SPEAK.has(targetLanguage)) {
      if (useSpitchVoice(targetLanguage, { cloned: false })) {
        notice = `${reason} The native ${getLanguage(targetLanguage)?.name || targetLanguage} voice was used instead.`;
        return "spitch";
      }
      throw new Error(`The voice service is out of credit or not set up for ${getLanguage(targetLanguage)?.name || targetLanguage}. ${reason}`);
    }
    fallbackReason = reason;
    return "openai";
  };
  if (provider === "openai" && OPENAI_CANNOT_SPEAK.has(targetLanguage)) provider = fallBack("ElevenLabs is not configured.");
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
  let pending = speakable.filter((segment) => !cached.has(segment.index));

  if (provider === "elevenlabs" && pending.length) {
    const characters = pending.reduce((sum, segment) => sum + segment.text.length, 0);
    const remaining = await remainingCharacters();
    if (remaining !== null && remaining < characters) {
      provider = fallBack(`ElevenLabs character quota is too low (${Math.max(0, remaining)} left, ${characters} needed).`);
      // Lines kept from an earlier run were made with the other voice, so they can't be reused with this one.
      cached.clear();
      pending = speakable;
    }
  }

  // Choose a concrete voice ID per speaker, cloning only speakers who still need new clips.
  // The provider can change above (quota), so the voice key for the cache is worked out after that.
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
      } else if (voiceClone && (needsClips || refit) && !cloningBlocked) {
        const speakerSegments = sourceSegments.filter((segment) => speakerOf(segment) === speaker);
        if (seconds < MIN_CLONE_SECONDS && ranked.length > 1) {
          fallbackReason ||= "Some speakers talk too briefly to clone, so they use a standard voice.";
        } else {
          try {
            voiceId = await cloneSpeaker(sourceAudioPath, speakerSegments.length ? speakerSegments : sourceSegments, workdir, rank);
            clones.push(voiceId);
            cloned = true;
          } catch (error) {
            const reason = explainCloneFailure(error);
            fallbackReason ||= `Speaker cloning unavailable: ${reason}`;
            // A problem with one speaker's sample must not stop the others; a plan or credit problem will hit everyone.
            if (/subscription|plan|quota|credit|permission|unauthori|not allowed|limit/i.test(reason)) cloningBlocked = true;
          }
        }
      }
      voices.set(speaker, voiceId);
      speakerResults.push({ speaker, seconds: Math.round(seconds * 10) / 10, voice: savedVoiceId && rank === 0 ? "saved" : (cloned || (voiceClone && !needsClips)) ? "clone" : "standard" });
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
  let timeline = [];
  const revised = [];
  try {
    const supported = provider === "elevenlabs" ? await modelLanguages() : new Set();
    const languageCode = supported.has(targetLanguage) ? targetLanguage : undefined;
    // Voice lines are made several at a time; each engine has its own limit (Spitch and ElevenLabs refuse requests past it).
    const concurrency = provider === "spitch" ? config.spitchConcurrency : provider === "elevenlabs" ? config.elevenlabsConcurrency : 4;
    const fresh = await mapWithConcurrency(pending, Math.max(1, concurrency), async (segment) => {
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

    // Now the real length of every voice line is known: lines that still can't fit are shortened and spoken again.
    if (refit) {
      const lengths = await mapWithConcurrency(speakable, 8, async (segment) => (await decodeClip(pathByIndex.get(segment.index))).length / 2 / TRACK_SAMPLE_RATE);
      const long = [];
      speakable.forEach((segment, position) => {
        const room = availableSeconds(segments, segment.index, durationSeconds);
        if (lengths[position] > room * 1.12 && segment.text.trim().length > 14) {
          long.push({ index: segment.index, text: segment.text.trim(), maxCharacters: Math.floor(segment.text.trim().length * (room * 1.05) / lengths[position]) });
        }
      });
      const rewrites = long.length ? await refit(long) : new Map();
      const redo = speakable.filter((segment) => rewrites.has(segment.index));
      await mapWithConcurrency(redo, Math.max(1, concurrency), async (segment) => {
        const oldKey = keyFor(segment);
        segment.text = rewrites.get(segment.index);
        const voice = voices.get(speakerOf(segment)) || (provider === "openai" ? "alloy" : provider === "spitch" ? spitchVoiceFor(targetLanguage, 0, preferredVoice) : config.elevenlabsFallbackVoiceId);
        const audio = provider === "spitch"
          ? await synthesizeWithSpitch(segment.text, voice, targetLanguage)
          : provider === "elevenlabs"
            ? await synthesizeWithElevenLabs(segment.text, voice, languageCode)
            : await synthesizeWithOpenAI(segment.text, targetLanguage, voice);
        const path = join(clipsDirectory, `clip-${String(segment.index).padStart(4, "0")}-b.mp3`);
        await writeFile(path, audio);
        const old = produced.findIndex((item) => item.key === oldKey);
        if (old >= 0) produced.splice(old, 1);
        produced.push({ key: keyFor(segment), path });
        pathByIndex.set(segment.index, path);
        revised.push({ index: segment.index, text: segment.text });
      });
    }
    const clips = speakable.map((segment) => ({ index: segment.index, path: pathByIndex.get(segment.index), start: segment.start, end: segment.end }));
    timeline = (await layoutDubTimeline(clips, durationSeconds, outputPath)).placements;
  } finally {
    for (const cloneId of clones) await deleteVoice(cloneId);
  }

  return {
    voiceCloned: clones.length > 0 || Boolean(savedVoiceId),
    provider,
    fallbackReason,
    notice,
    timeline,
    revised,
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
// Voice engines pad every line with a little silence; cutting it off gives back time that would otherwise be paid for by speeding up.
const TRIM_SILENCE = "silenceremove=start_periods=1:start_threshold=-48dB:start_silence=0.04,areverse,silenceremove=start_periods=1:start_threshold=-48dB:start_silence=0.06,areverse";

async function decodeClip(path, tempo = 1) {
  const trimmed = await decodeWith(path, tempo, true).catch(() => null);
  // A clip that is all silence (or too short to measure) is used as it is.
  return trimmed && trimmed.length > TRACK_SAMPLE_RATE * 0.06 * 2 ? trimmed : decodeWith(path, tempo, false);
}

async function decodeWith(path, tempo, trim) {
  const filters = trim ? [TRIM_SILENCE] : [];
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

/**
 * Decides where each line starts and how much it is adjusted in tempo.
 * Lines never overlap: each starts at its original timestamp or as soon as the previous line finishes.
 * When a line fits comfortably, it plays at its natural speed (1.0x).
 * When speech would run past the next speaker's start time, it is gently compressed up to MAX_SEGMENT_SPEEDUP.
 */
function plan(clips, durations, totalDuration, globalSpeed = 1) {
  const maxSegmentSpeed = config.dubMaxSpeed ? Math.min(Math.max(config.dubMaxSpeed, 1.2), MAX_SEGMENT_SPEEDUP) : MAX_SEGMENT_SPEEDUP;
  let cursor = 0;

  const placements = clips.map((clip, index) => {
    const isLast = index + 1 >= clips.length;
    const origStart = clip.start;
    const origEnd = clip.end;
    const nextStart = isLast ? totalDuration : Math.max(clips[index + 1].start, origStart);

    // Never start before the previous clip finishes.
    const start = Math.max(origStart, cursor);

    // The available slot before the next speaker or end of video
    const slot = Math.max(nextStart - start, 0.25);
    const naturalDur = durations[index];

    // If it fits naturally in its own segment or before next speaker, keep speed at 1.0.
    // If it overflows the slot, compress it up to maxSegmentSpeed.
    const speed = Math.min(Math.max(naturalDur / slot, 1), maxSegmentSpeed) * globalSpeed;
    const playDuration = naturalDur / speed;
    cursor = start + playDuration;

    return { start, speed };
  });

  return { placements, end: cursor };
}

/** The subtitle lines timed to the dub: each line shows exactly while its voice is heard. */
export function retimeToDub(segments, timeline) {
  if (!timeline?.length) return segments;
  const byIndex = new Map(timeline.map((line) => [Number(Array.isArray(line) ? line[0] : line.index), Array.isArray(line) ? { start: line[1], end: line[2] } : line]));
  return segments.map((segment, index) => {
    const placed = byIndex.get(index);
    return placed ? { ...segment, start: placed.start, end: Math.max(placed.end, placed.start + 0.3) } : segment;
  });
}

/** Places each clip at its segment start on a silent track exactly `totalDuration` seconds long. */
export async function layoutDubTrack(clips, totalDuration, outputPath) {
  return (await layoutDubTimeline(clips, totalDuration, outputPath)).path;
}

/**
 * Like layoutDubTrack, but also reports where each line really landed: its start and end on the finished track and how much it
 * was sped up. Subtitles are timed from this, so they always match what is heard.
 */
export async function layoutDubTimeline(clips, totalDuration, outputPath) {
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
  const placed = ordered.map((clip, index) => {
    const { start, speed } = layout.placements[index];
    return { index: clip.index, start, end: start + durations[index] / speed, speed, naturalSeconds: durations[index], slotStart: clip.start, slotEnd: clip.end };
  });
  return { path: outputPath, placements: placed, globalSpeed };
}
