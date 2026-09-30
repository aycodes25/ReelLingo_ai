import { createReadStream } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import OpenAI from "openai";
import { config } from "./config.js";
import { recordCost } from "./costs.js";
import { getLanguage, languages } from "./languages.js";
import { getMediaInfo, run, runCapture } from "./media.js";
import { responseError, withRetries } from "./retry.js";

const ai = config.openaiApiKey ? new OpenAI({ apiKey: config.openaiApiKey, baseURL: config.openaiBaseUrl, timeout: 600_000 }) : null;

// Whisper accepts files up to 25 MB; 16 kHz mono PCM is ~1.9 MB per minute, so 10 minutes stays well below it.
const TRANSCRIPTION_MAX_CHUNK_SECONDS = 600;
const TRANSCRIPTION_MIN_CHUNK_SECONDS = 240;
const TRANSCRIPTION_MAX_RETRIES = 4;
const CONTEXT_PROMPT_CHARACTERS = 220;

// Languages OpenAI documents as supported by whisper-1. Others (e.g. Yoruba) are auto-detected instead,
// because forcing an unsupported hint lowers accuracy.
const WHISPER_LANGUAGES = new Set([
  "af", "ar", "hy", "az", "be", "bs", "bg", "ca", "zh", "hr", "cs", "da", "nl", "en", "et", "fi", "fr", "gl", "de", "el",
  "he", "hi", "hu", "is", "id", "it", "ja", "kn", "kk", "ko", "lv", "lt", "mk", "ms", "mr", "mi", "ne", "no", "fa", "pl",
  "pt", "ro", "ru", "sr", "sk", "sl", "es", "sw", "sv", "tl", "ta", "th", "tr", "uk", "ur", "vi", "cy",
]);

export function whisperLanguageHint(code) {
  const normalized = code === "fil" ? "tl" : code;
  return WHISPER_LANGUAGES.has(normalized) ? normalized : undefined;
}

async function detectSilences(audioPath) {
  const { stderr } = await runCapture("ffmpeg", ["-v", "info", "-i", audioPath, "-af", "silencedetect=noise=-35dB:d=0.35", "-f", "null", "-"]);
  const silences = [];
  let pendingStart = null;
  for (const line of stderr.split(/\r?\n/)) {
    const started = line.match(/silence_start:\s*(-?\d+(?:\.\d+)?)/);
    const ended = line.match(/silence_end:\s*(-?\d+(?:\.\d+)?)/);
    if (started) pendingStart = Math.max(0, Number(started[1]));
    if (ended && pendingStart !== null) {
      silences.push({ start: pendingStart, end: Number(ended[1]) });
      pendingStart = null;
    }
  }
  return silences;
}

/** Splits audio into chunks Whisper can accept, cutting in the middle of pauses so words are never split. */
export async function splitAudioForTranscription(audioPath, chunksDirectory, { maxSeconds = TRANSCRIPTION_MAX_CHUNK_SECONDS, minSeconds = Math.min(TRANSCRIPTION_MIN_CHUNK_SECONDS, maxSeconds / 2) } = {}) {
  const duration = Number((await getMediaInfo(audioPath)).format?.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("Audio extraction produced an empty audio track.");
  const silences = duration > maxSeconds ? await detectSilences(audioPath) : [];

  const cuts = [0];
  while (duration - cuts[cuts.length - 1] > maxSeconds) {
    const from = cuts[cuts.length - 1];
    const candidates = silences
      .map((silence) => (silence.start + silence.end) / 2)
      .filter((middle) => middle >= from + minSeconds && middle <= from + maxSeconds);
    cuts.push(candidates.length ? candidates[candidates.length - 1] : from + maxSeconds);
  }
  cuts.push(duration);

  const chunks = [];
  for (let index = 0; index < cuts.length - 1; index += 1) {
    const path = join(chunksDirectory, `chunk-${String(index).padStart(4, "0")}.wav`);
    await run("ffmpeg", [
      "-y", "-i", audioPath, "-ss", cuts[index].toFixed(3), "-to", cuts[index + 1].toFixed(3),
      "-c:a", "pcm_s16le", "-ar", "16000", "-ac", "1", path,
    ]);
    chunks.push({ path, offset: cuts[index], duration: cuts[index + 1] - cuts[index] });
  }
  if (chunks.length === 0) throw new Error("Audio extraction produced no transcription chunks.");
  return chunks;
}

export function languageCodeFromName(name) {
  if (!name) return null;
  const normalized = name.toLowerCase().trim();
  const aliases = {
    chinese: "zh", mandarin: "zh", farsi: "fa", tagalog: "fil", pidgin: "pcm",
    "nigerian pidgin": "pcm", fula: "ff", fulfulde: "ff", kanuri: "kr",
    yor: "yo", hau: "ha", ibo: "ig", swa: "sw", amh: "am", eng: "en", fra: "fr", por: "pt", spa: "es", zul: "zu", xho: "xh",
    som: "so", orm: "om", kin: "rw", lin: "ln", wol: "wo", sna: "sn", afr: "af", ara: "ar", twi: "tw", ewe: "ee",
  };
  if (aliases[normalized]) return aliases[normalized];
  if (getLanguage(normalized)) return normalized;
  return languages.find((language) => language.name.toLowerCase() === normalized)?.code || null;
}

export async function transcribeAudioChunks(chunks, requestTranscription, { language, retryDelayMs = 2000, vocabulary = "" } = {}) {
  const segments = [];
  const chunkLanguages = new Set();
  let context = "";

  for (const chunk of chunks) {
    const options = { language };
    // Whisper treats the prompt as the words spoken just before this chunk, which keeps names and spelling consistent.
    // Glossary terms go first so they survive truncation.
    const prompt = [vocabulary, context.slice(-CONTEXT_PROMPT_CHARACTERS)].filter(Boolean).join(" ").trim();
    if (prompt) options.prompt = prompt;
    let response;
    try {
      response = await withRetries(() => requestTranscription(chunk, options), {
        attempts: TRANSCRIPTION_MAX_RETRIES,
        baseDelayMs: retryDelayMs,
        label: `Transcription of ${basename(chunk.path)}`,
      });
    } catch (error) {
      throw new Error(`Transcription failed for ${chunk.path}: ${error.cause?.message || error.message}`);
    }

    const detectedCode = languageCodeFromName(response.language);
    if (detectedCode) chunkLanguages.add(detectedCode);
    const chunkSegments = (response.segments || []).map((segment) => ({
      start: Number(segment.start) + chunk.offset,
      end: Number(segment.end) + chunk.offset,
      text: String(segment.text || "").trim(),
      language: detectedCode || "und",
    })).filter((segment) => segment.text && Number.isFinite(segment.start) && Number.isFinite(segment.end));

    if (chunkSegments.length) {
      segments.push(...chunkSegments);
    } else if (response.text?.trim()) {
      const info = await getMediaInfo(chunk.path);
      segments.push({
        start: chunk.offset,
        end: chunk.offset + Number(info.format.duration || TRANSCRIPTION_MAX_CHUNK_SECONDS),
        text: response.text.trim(),
        language: detectedCode || "und",
      });
    }
    const chunkText = chunkSegments.map((segment) => segment.text).join(" ") || response.text?.trim() || "";
    if (chunkText) context = `${context} ${chunkText}`.trim().slice(-CONTEXT_PROMPT_CHARACTERS * 2);
  }

  if (segments.length === 0) throw new Error("No speech was transcribed from the video. Check its audio track and try again.");
  return { segments, chunkLanguages: [...chunkLanguages] };
}

async function transcribeWithWhisper(audioPath, chunksDirectory, sourceLanguage, vocabulary) {
  if (!ai) throw new Error("OPENAI_API_KEY is required for transcription.");
  const chunks = await splitAudioForTranscription(audioPath, chunksDirectory);
  const result = await transcribeAudioChunks(chunks, (chunk, { language, prompt }) => ai.audio.transcriptions.create({
    model: config.openaiTranscriptionModel,
    file: createReadStream(chunk.path),
    response_format: "verbose_json",
    timestamp_granularities: ["segment"],
    temperature: 0,
    ...(language ? { language } : {}),
    ...(prompt ? { prompt } : {}),
  }), { language: whisperLanguageHint(sourceLanguage), vocabulary });
  const minutes = chunks.reduce((sum, chunk) => sum + (chunk.duration || 0), 0) / 60;
  await recordCost("openai", "transcription", minutes, "minutes", minutes * config.costs.whisperPerMinute);
  return { ...result, speakers: [] };
}

const SCRIBE_MAX_GAP_SECONDS = 1.2;
const SCRIBE_MAX_SEGMENT_SECONDS = 12;

/** Groups Scribe's word timings into sentence-sized segments that never mix two speakers. */
export function wordsToSegments(words, languageCode) {
  const segments = [];
  let current = null;
  for (const word of words) {
    if (word.type === "audio_event") continue;
    const text = String(word.text || "");
    if (word.type === "spacing") {
      if (current) current.text += text;
      continue;
    }
    const start = Number(word.start);
    const end = Number(word.end);
    const speaker = word.speaker_id || "speaker_0";
    const breakHere = !current
      || current.speaker !== speaker
      || start - current.end > SCRIBE_MAX_GAP_SECONDS
      || (end - current.start > SCRIBE_MAX_SEGMENT_SECONDS && /[.!?…]$/.test(current.text.trim()))
      || end - current.start > SCRIBE_MAX_SEGMENT_SECONDS * 2;
    if (breakHere) {
      if (current) segments.push(current);
      current = { start, end, text, speaker, language: languageCode };
    } else {
      current.text += text;
      current.end = end;
    }
  }
  if (current) segments.push(current);
  return segments.map((segment) => ({ ...segment, text: segment.text.replace(/\s+/g, " ").trim() })).filter((segment) => segment.text);
}

/** ElevenLabs Scribe: covers many African languages and labels who is speaking. */
async function transcribeWithScribe(audioPath, workdir, sourceLanguage, durationSeconds) {
  if (!config.elevenlabsApiKey) throw new Error("ELEVENLABS_API_KEY is required for multi-speaker transcription.");
  const compressed = join(workdir, "scribe-input.mp3");
  await run("ffmpeg", ["-y", "-i", audioPath, "-ac", "1", "-ar", "16000", "-c:a", "libmp3lame", "-b:a", "64k", compressed]);
  const form = new FormData();
  form.append("model_id", config.elevenlabsSttModel);
  form.append("diarize", "true");
  form.append("tag_audio_events", "false");
  form.append("timestamps_granularity", "word");
  if (sourceLanguage && sourceLanguage !== "auto") form.append("language_code", sourceLanguage);
  form.append("file", new Blob([await readFile(compressed)], { type: "audio/mpeg" }), "audio.mp3");
  const data = await withRetries(async () => {
    const response = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
      method: "POST",
      headers: { "xi-api-key": config.elevenlabsApiKey },
      body: form,
    });
    if (!response.ok) throw await responseError(response, "ElevenLabs transcription");
    return response.json();
  }, { label: "ElevenLabs transcription" });
  await recordCost("elevenlabs", "transcription", durationSeconds / 3600, "hours", (durationSeconds / 3600) * config.costs.scribePerHour);
  const code = languageCodeFromName(data.language_code) || (sourceLanguage !== "auto" ? sourceLanguage : "und");
  const segments = wordsToSegments(data.words || [], code);
  if (!segments.length) throw new Error("No speech was transcribed from the video. Check its audio track and try again.");
  const speakers = [...new Set(segments.map((segment) => segment.speaker))];
  return { segments, chunkLanguages: getLanguage(code) ? [code] : [], speakers };
}

/**
 * Transcribes with Whisper by default, or with Scribe when speakers must be told apart (or it's configured).
 * Falls back to Whisper if Scribe fails, so a diarization problem never blocks the job.
 */
export async function transcribe(audioPath, workdir, sourceLanguage, { multiSpeaker = false, vocabulary = "", durationSeconds = 0, onNote } = {}) {
  const chunksDirectory = join(workdir, "transcription-chunks");
  await mkdir(chunksDirectory, { recursive: true });
  const useScribe = config.elevenlabsApiKey && (multiSpeaker || config.transcriptionProvider === "elevenlabs");
  if (useScribe) {
    try {
      return await transcribeWithScribe(audioPath, workdir, sourceLanguage, durationSeconds);
    } catch (error) {
      if (!ai) throw error;
      onNote?.(`Speaker separation was unavailable (${error.message.slice(0, 160)}), so every line uses one voice.`);
    }
  } else if (multiSpeaker) {
    onNote?.("Multi-speaker dubbing needs ELEVENLABS_API_KEY; every line uses one voice.");
  }
  return transcribeWithWhisper(audioPath, chunksDirectory, sourceLanguage, vocabulary);
}
