import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import OpenAI from "openai";
import { config } from "./config.js";
import { updateJob } from "./database.js";
import { getLanguage, languages } from "./languages.js";
import { uploadBuffer, uploadFile } from "./storage.js";
import { dubSegments } from "./dubbing.js";
import { withRetries } from "./retry.js";

const ai = config.openaiApiKey ? new OpenAI({
  apiKey: config.openaiApiKey,
  baseURL: config.openaiBaseUrl,
  timeout: 600_000,
}) : null;

function run(command, args) {
  return new Promise((resolve, reject) => {
    const process = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    process.stderr.setEncoding("utf8");
    process.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    process.on("error", reject);
    process.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
    });
  });
}

export async function mergeAudioVideo(videoPath, audioPath, outputVideoPath) {
  const videoInfo = await getMediaInfo(videoPath);
  const duration = Number(videoInfo.format?.duration);
  if (!Number.isFinite(duration) || duration <= 0 || !videoInfo.streams.some((stream) => stream.codec_type === "video")) {
    throw new Error("Could not determine input video duration.");
  }
  await assertAudibleAudio(audioPath);

  await run("ffmpeg", [
    "-y", "-i", videoPath, "-i", audioPath,
    "-map", "0:v:0", "-map", "1:a:0",
    "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
    "-af", "apad", "-t", String(duration),
    "-metadata:s:a:0", "title=ReelLingo translated dub",
    "-movflags", "+faststart", outputVideoPath,
  ]);

  const outputInfo = await getMediaInfo(outputVideoPath);
  const audioStream = outputInfo.streams.find((stream) => stream.codec_type === "audio");
  if (!audioStream || Number(outputInfo.format?.duration) < duration - 0.25) {
    throw new Error("The exported video is missing its complete audio or video stream.");
  }
  await assertAudibleAudio(outputVideoPath);

  return outputVideoPath;
}

export async function assertAudibleAudio(filePath) {
  const info = await getMediaInfo(filePath);
  if (!info.streams.some((stream) => stream.codec_type === "audio")) {
    throw new Error("Dub generation produced no audio stream.");
  }
  const { stderr } = await runCapture("ffmpeg", ["-v", "info", "-i", filePath, "-af", "volumedetect", "-f", "null", "-"]);
  const peak = stderr.match(/max_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/i);
  if (!peak || Number(peak[1]) <= -55) {
    throw new Error("Dub generation produced silent audio. The job was not marked complete.");
  }
}

async function extractAudio(videoPath, audioPath) {
  await run("ffmpeg", [
    "-y", "-i", videoPath, "-vn", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1", audioPath,
  ]);
  return audioPath;
}

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
    chunks.push({ path, offset: cuts[index] });
  }
  if (chunks.length === 0) throw new Error("Audio extraction produced no transcription chunks.");
  return chunks;
}

function languageCodeFromName(name) {
  if (!name) return null;
  const normalized = name.toLowerCase().trim();
  const aliases = {
    chinese: "zh", mandarin: "zh", farsi: "fa", tagalog: "fil", pidgin: "pcm",
    "nigerian pidgin": "pcm", fula: "ff", fulfulde: "ff", kanuri: "kr",
  };
  if (aliases[normalized]) return aliases[normalized];
  if (getLanguage(normalized)) return normalized;
  return languages.find((language) => language.name.toLowerCase() === normalized)?.code || null;
}

export async function transcribeAudioChunks(chunks, requestTranscription, { language, retryDelayMs = 2000 } = {}) {
  const segments = [];
  const chunkLanguages = new Set();
  let context = "";

  for (const chunk of chunks) {
    const options = { language };
    // Whisper treats the prompt as the words spoken just before this chunk, which keeps names and spelling consistent.
    if (context) options.prompt = context.slice(-CONTEXT_PROMPT_CHARACTERS);
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

async function transcribe(audioPath, chunksDirectory, sourceLanguage) {
  if (!ai) throw new Error("OPENAI_API_KEY is required for transcription.");
  const chunks = await splitAudioForTranscription(audioPath, chunksDirectory);
  return transcribeAudioChunks(chunks, (chunk, { language, prompt }) => ai.audio.transcriptions.create({
    model: config.openaiTranscriptionModel,
    file: createReadStream(chunk.path),
    response_format: "verbose_json",
    timestamp_granularities: ["segment"],
    temperature: 0,
    ...(language ? { language } : {}),
    ...(prompt ? { prompt } : {}),
  }), { language: whisperLanguageHint(sourceLanguage) });
}

const CHAT_BATCH_SIZE = 40;
const CHAT_OUTPUT_ATTEMPTS = 3;

class IncompleteOutputError extends Error {}

// Retries network failures, and re-asks when the model returns JSON that is invalid or misses a segment.
async function completeSegmentBatch(complete, request, expectedCount, { retryDelayMs = 2000, label }) {
  let lastProblem;
  for (let attempt = 1; attempt <= CHAT_OUTPUT_ATTEMPTS; attempt += 1) {
    const response = await withRetries(() => complete(request), { baseDelayMs: retryDelayMs, label });
    let items;
    try {
      items = JSON.parse(response.choices[0]?.message?.content || "{}").segments;
    } catch {
      lastProblem = new IncompleteOutputError(`${label} returned invalid segment data.`);
      continue;
    }
    if (!Array.isArray(items)) {
      lastProblem = new IncompleteOutputError(`${label} returned invalid segment data.`);
      continue;
    }
    const byIndex = new Map(items.map((item) => [Number(item.index), item]));
    if (byIndex.size < expectedCount || [...Array(expectedCount).keys()].some((index) => !byIndex.has(index))) {
      lastProblem = new IncompleteOutputError(`${label} returned ${byIndex.size} of ${expectedCount} segments.`);
      continue;
    }
    return byIndex;
  }
  throw lastProblem;
}

export async function detectSegmentLanguages(segments, requestCompletion, fallbackLanguage = "auto", { retryDelayMs } = {}) {
  if (!requestCompletion && !ai) throw new Error("OPENAI_API_KEY is required to identify spoken languages.");
  const complete = requestCompletion || ((request) => ai.chat.completions.create(request));
  const catalog = languages.filter(({ code }) => code !== "auto").map(({ code, name }) => `${code}: ${name}`).join("\n");
  const result = [];

  for (let offset = 0; offset < segments.length; offset += CHAT_BATCH_SIZE) {
    const batch = segments.slice(offset, offset + CHAT_BATCH_SIZE);
    const byIndex = await completeSegmentBatch(complete, {
      model: config.openaiChatModel,
      response_format: { type: "json_object" },
      temperature: 0,
      messages: [
        {
          role: "system",
          content: `Identify the language actually spoken in each short transcript segment. A video may switch languages; classify every segment independently. Return JSON {"segments":[{"index":0,"language":"en"}]} with exactly one entry per input segment. Use only these codes, or "und" if genuinely uncertain:\n${catalog}`,
        },
        { role: "user", content: JSON.stringify(batch.map((segment, index) => ({ index, text: segment.text }))) },
      ],
    }, batch.length, { retryDelayMs, label: "Language identification" });

    result.push(...batch.map((segment, index) => {
      const code = String(byIndex.get(index)?.language || "und").toLowerCase();
      const fallback = getLanguage(segment.language) ? segment.language : fallbackLanguage;
      return { ...segment, language: getLanguage(code) ? code : getLanguage(fallback) && fallback !== "auto" ? fallback : "und" };
    }));
  }
  return result;
}

export async function translate(segments, targetLanguage, requestCompletion, { retryDelayMs } = {}) {
  const target = getLanguage(targetLanguage)?.name || targetLanguage;
  if (!requestCompletion && !ai) throw new Error("OPENAI_API_KEY is required for translation.");
  const complete = requestCompletion || ((request) => ai.chat.completions.create(request));
  const translated = new Array(segments.length);
  const groups = new Map();

  segments.forEach((segment, index) => {
    const code = getLanguage(segment.language) ? segment.language : "und";
    if (!groups.has(code)) groups.set(code, []);
    groups.get(code).push({ index, ...segment });
  });

  for (const [sourceCode, group] of groups) {
    const source = getLanguage(sourceCode)?.name || "the spoken source language";
    for (let offset = 0; offset < group.length; offset += CHAT_BATCH_SIZE) {
      const batch = group.slice(offset, offset + CHAT_BATCH_SIZE);
      const byIndex = await completeSegmentBatch(complete, {
        model: config.openaiChatModel,
        response_format: { type: "json_object" },
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content: `Translate every segment from ${source} into natural, conversational ${target}. Translate every word faithfully, keep names as spoken, and never merge, split, skip or summarize segments. Return JSON {"segments":[{"index":0,"text":"..."}]} with exactly one entry per input segment, preserving each index.`,
          },
          { role: "user", content: JSON.stringify(batch.map((item, index) => ({ index, text: item.text }))) },
        ],
      }, batch.length, { retryDelayMs, label: "Translation" });

      batch.forEach((item, index) => {
        const text = String(byIndex.get(index)?.text || "").trim();
        if (!text) throw new Error(`Translation is missing transcript segment ${item.index + 1}.`);
        translated[item.index] = { ...segments[item.index], text };
      });
    }
  }
  return translated;
}

function timestamp(seconds) {
  const milliseconds = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const wholeSeconds = Math.floor((milliseconds % 60_000) / 1000);
  const remainder = milliseconds % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(wholeSeconds).padStart(2, "0")},${String(remainder).padStart(3, "0")}`;
}

function generateSrt(segments) {
  return segments.map((segment, index) => (
    `${index + 1}\n${timestamp(segment.start)} --> ${timestamp(segment.end)}\n${segment.text}`
  )).join("\n\n") + "\n";
}

export async function runPipeline(jobId, localVideoPath, job) {
  const workdir = await mkdtemp(join(tmpdir(), `reellingo-${jobId}-`));
  try {
    if (config.mockMode) {
      throw new Error("Live dubbing is not configured. Set OPENAI_API_KEY in backend/.env; demo placeholders are never exported as a finished dub.");
    }
    await updateJob(jobId, { status: "processing", current_step: "extracting_audio", error_message: null });
    const mediaInfo = await getMediaInfo(localVideoPath);
    const durationSeconds = Number(mediaInfo.format?.duration);
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error("Could not read the video's duration.");
    if (!mediaInfo.streams.some((stream) => stream.codec_type === "audio")) {
      throw new Error("This video has no audio track, so there is no speech to translate.");
    }
    const audioPath = join(workdir, "source.wav");
    const speakerAudioPath = join(workdir, "speaker.wav");
    await extractAudio(localVideoPath, audioPath);
    await run("ffmpeg", ["-y", "-i", localVideoPath, "-vn", "-acodec", "pcm_s16le", "-ar", "44100", "-ac", "1", speakerAudioPath]);
    const chunksDirectory = join(workdir, "transcription-chunks");
    await mkdir(chunksDirectory, { recursive: true });

    await updateJob(jobId, { current_step: "transcribing", duration_seconds: durationSeconds });
    const { segments: rawTranscript, chunkLanguages } = await transcribe(audioPath, chunksDirectory, job.source_language);

    await updateJob(jobId, { current_step: "detecting_languages" });
    const transcript = await detectSegmentLanguages(rawTranscript, undefined, job.source_language);
    const detectedLanguages = [...new Set([
      ...transcript.map((segment) => segment.language).filter((code) => getLanguage(code)),
      ...chunkLanguages,
    ])];
    await updateJob(jobId, {
      transcript_json: JSON.stringify(transcript),
      detected_languages_json: JSON.stringify(detectedLanguages),
    });

    await updateJob(jobId, { current_step: "translating" });
    const translated = await translate(transcript, job.target_language);
    await updateJob(jobId, { translated_segments_json: JSON.stringify(translated) });

    await updateJob(jobId, { current_step: "dubbing" });
    const dubbedAudioPath = join(workdir, "translated-audio.wav");
    const dubResult = await dubSegments({
      segments: translated,
      sourceSegments: transcript,
      sourceAudioPath: speakerAudioPath,
      outputPath: dubbedAudioPath,
      targetLanguage: job.target_language,
      voiceClone: Boolean(job.voice_clone),
      durationSeconds,
      workdir,
    });
    if (dubResult.fallbackReason) {
      const voice = dubResult.provider === "openai" ? "an OpenAI voice" : "a standard ElevenLabs voice";
      await updateJob(jobId, { voice_clone: dubResult.voiceCloned, processing_note: `Dubbed with ${voice}. ${dubResult.fallbackReason}` });
    }
    await assertAudibleAudio(dubbedAudioPath);

    await updateJob(jobId, { current_step: "merging" });
    const outputPath = join(workdir, "output.mp4");
    await mergeAudioVideo(localVideoPath, dubbedAudioPath, outputPath);

    await updateJob(jobId, { current_step: "generating_subtitles" });
    const videoStoragePath = await uploadFile(`jobs/${jobId}/output.mp4`, outputPath, "video/mp4");
    const srtStoragePath = await uploadBuffer(`jobs/${jobId}/subtitles.srt`, Buffer.from(generateSrt(translated)), "text/plain; charset=utf-8");
    await updateJob(jobId, {
      output_video_path: videoStoragePath,
      output_srt_path: srtStoragePath,
      status: "done",
      current_step: "done",
    });
  } catch (error) {
    console.error(`Job ${jobId} failed:`, error);
    await updateJob(jobId, { status: "failed", error_message: error instanceof Error ? error.message : String(error) });
  } finally {
    await rm(workdir, { recursive: true, force: true });
    await rm(localVideoPath, { force: true });
  }
}

function runCapture(command, args) {
  return new Promise((resolve, reject) => {
    const process = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    process.stdout.setEncoding("utf8");
    process.stderr.setEncoding("utf8");
    process.stdout.on("data", (chunk) => { stdout += chunk; });
    process.stderr.on("data", (chunk) => { stderr += chunk; });
    process.on("error", reject);
    process.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
    });
  });
}

async function getMediaInfo(filePath) {
  const { stdout } = await runCapture("ffprobe", [
    "-v", "error", "-show_streams", "-show_format", "-of", "json", filePath,
  ]);
  return JSON.parse(stdout);
}