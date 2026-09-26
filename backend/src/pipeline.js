import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import OpenAI from "openai";
import { config } from "./config.js";
import { updateJob } from "./database.js";
import { getLanguage } from "./languages.js";
import { languages } from "./languages.js";
import { uploadBuffer, uploadFile } from "./storage.js";

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

const TRANSCRIPTION_CHUNK_SECONDS = 120;
const TRANSCRIPTION_MAX_RETRIES = 3;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableTranscriptionError(error) {
  const code = String(error?.code || "").toLowerCase();
  const message = String(error?.message || error || "").toLowerCase();
  return [
    "ecconnreset", "econnreset", "econnaborted", "etag", "etimedout", "timeout",
    "fetch failed", "network", "temporar", "rate limit", "429", "too many requests",
  ].some((token) => code.includes(token) || message.includes(token));
}

export async function splitAudioForTranscription(audioPath, chunksDirectory) {
  await run("ffmpeg", [
    "-y", "-i", audioPath, "-f", "segment", "-segment_time", String(TRANSCRIPTION_CHUNK_SECONDS),
    "-reset_timestamps", "1", "-c:a", "pcm_s16le", "-ar", "16000", "-ac", "1",
    join(chunksDirectory, "chunk-%04d.wav"),
  ]);
  const names = (await readdir(chunksDirectory)).filter((name) => name.endsWith(".wav")).sort();
  if (names.length === 0) throw new Error("Audio extraction produced no transcription chunks.");
  return names.map((name, index) => ({ path: join(chunksDirectory, name), offset: index * TRANSCRIPTION_CHUNK_SECONDS }));
}

function languageCodeFromName(name) {
  if (!name) return null;
  const normalized = name.toLowerCase().trim();
  const aliases = {
    chinese: "zh", mandarin: "zh", farsi: "fa", tagalog: "fil", pidgin: "pcm",
    "nigerian pidgin": "pcm", fula: "ff", fulfulde: "ff", kanuri: "kr",
  };
  if (aliases[normalized]) return aliases[normalized];
  return languages.find((language) => language.name.toLowerCase() === normalized)?.code || null;
}

export async function transcribeAudioChunks(chunks, requestTranscription) {
  const segments = [];
  const chunkLanguages = new Set();

  for (const chunk of chunks) {
    let response;
    let lastError;

    for (let attempt = 1; attempt <= TRANSCRIPTION_MAX_RETRIES; attempt += 1) {
      try {
        response = await requestTranscription(chunk);
        break;
      } catch (error) {
        lastError = error;
        const retryable = isRetryableTranscriptionError(error);
        if (!retryable || attempt === TRANSCRIPTION_MAX_RETRIES) {
          throw new Error(`Transcription failed for ${chunk.path}: ${error instanceof Error ? error.message : String(error)}`);
        }
        await wait(Math.min(2000 * attempt, 8000));
      }
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
        end: chunk.offset + Number(info.format.duration || TRANSCRIPTION_CHUNK_SECONDS),
        text: response.text.trim(),
        language: detectedCode || "und",
      });
    }
  }

  if (segments.length === 0) throw new Error("No speech was transcribed from the video. Check its audio track and try again.");
  return { segments, chunkLanguages: [...chunkLanguages] };
}

async function transcribe(audioPath, chunksDirectory) {
  if (!ai) throw new Error("OPENAI_API_KEY is required for transcription.");
  const chunks = await splitAudioForTranscription(audioPath, chunksDirectory);
  return transcribeAudioChunks(chunks, (chunk) => ai.audio.transcriptions.create({
    model: config.openaiTranscriptionModel,
    file: createReadStream(chunk.path),
    response_format: "verbose_json",
    timestamp_granularities: ["segment"],
    prompt: "Transcribe every spoken word verbatim in its original language. Do not translate or summarize.",
  }));
}

export async function detectSegmentLanguages(segments, requestCompletion, fallbackLanguage = "auto") {
  if (!requestCompletion && !ai) throw new Error("OPENAI_API_KEY is required to identify spoken languages.");
  const complete = requestCompletion || ((request) => ai.chat.completions.create(request));
  const catalog = languages.filter(({ code }) => code !== "auto").map(({ code, name }) => `${code}: ${name}`).join("\n");
  const result = [];

  for (let offset = 0; offset < segments.length; offset += 60) {
    const batch = segments.slice(offset, offset + 60);
    const response = await complete({
      model: config.openaiChatModel,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `Identify the language actually spoken in each short transcript segment. A video may switch languages; classify every segment independently. Return JSON {"segments":[{"index":0,"language":"en"}]}. Use only these codes, or "und" if genuinely uncertain:\n${catalog}`,
        },
        { role: "user", content: JSON.stringify(batch.map((segment, index) => ({ index, text: segment.text }))) },
      ],
    });

    let detected;
    try {
      detected = JSON.parse(response.choices[0]?.message?.content || "{}").segments;
    } catch {
      throw new Error("Language identification returned invalid segment data.");
    }
    if (!Array.isArray(detected) || detected.length !== batch.length) {
      throw new Error("Language identification did not classify every transcript segment.");
    }
    const byIndex = new Map(detected.map((item) => [Number(item.index), String(item.language || "und").toLowerCase()]));
    result.push(...batch.map((segment, index) => {
      const code = byIndex.get(index);
      const fallback = getLanguage(segment.language) ? segment.language : fallbackLanguage;
      return { ...segment, language: getLanguage(code) ? code : getLanguage(fallback) && fallback !== "auto" ? fallback : "und" };
    }));
  }
  return result;
}

export async function translate(segments, targetLanguage, requestCompletion) {
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
    for (let offset = 0; offset < group.length; offset += 60) {
      const batch = group.slice(offset, offset + 60);
      const response = await complete({
        model: config.openaiChatModel,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `Translate every segment from ${source} into natural, conversational ${target}. Translate the words faithfully and preserve each original index. Return JSON {"segments":[{"index":0,"text":"..."}]}. Do not summarize or add commentary.`,
          },
          { role: "user", content: JSON.stringify(batch.map(({ index, text }) => ({ index, text }))) },
        ],
      });

      let responseSegments;
      try {
        responseSegments = JSON.parse(response.choices[0]?.message?.content || "{}").segments;
      } catch {
        throw new Error("Translation provider returned invalid segment data.");
      }
      if (!Array.isArray(responseSegments) || responseSegments.length !== batch.length) {
        throw new Error("Translation provider returned an incomplete translation.");
      }
      const byIndex = new Map(responseSegments.map((item) => [Number(item.index), String(item.text || "").trim()]));
      for (const item of batch) {
        const text = byIndex.get(item.index);
        if (!text) throw new Error(`Translation is missing transcript segment ${item.index + 1}.`);
        translated[item.index] = { ...segments[item.index], text };
      }
    }
  }
  return translated;
}

function splitSpeechText(text, maxLength = 3000) {
  const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text];
  const chunks = [];
  let current = "";
  for (const sentence of sentences) {
    const part = sentence.trim();
    if (!part) continue;
    if (current && current.length + part.length + 1 > maxLength) {
      chunks.push(current);
      current = "";
    }
    current = current ? `${current} ${part}` : part;
  }
  if (current) chunks.push(current);
  return chunks;
}

async function createSpeechSample(sourceAudioPath, segments, outputPath) {
  const speechSegments = segments.filter((segment) => (
    Number.isFinite(segment.start) && Number.isFinite(segment.end) && segment.end > segment.start
  ));
  if (speechSegments.length === 0) throw new Error("No speech intervals were found to create a voice sample.");

  const filters = speechSegments.map((segment, index) => (
    `[0:a]atrim=start=${Math.max(0, segment.start)}:end=${segment.end},asetpts=PTS-STARTPTS,highpass=f=80,lowpass=f=8000,afftdn[a${index}]`
  ));
  const inputs = speechSegments.map((_, index) => `[a${index}]`).join("");
  filters.push(`${inputs}concat=n=${speechSegments.length}:v=0:a=1[out]`);
  await run("ffmpeg", [
    "-y", "-i", sourceAudioPath,
    "-filter_complex", filters.join(";"), "-map", "[out]",
    "-ac", "1", "-ar", "44100", "-c:a", "libmp3lame", "-b:a", "128k", outputPath,
  ]);
  return outputPath;
}

export async function dubWithClonedVoice(segments, sourceAudioPath, outputPath, targetLanguage) {
  const text = segments.map((segment) => segment.text).join(" ").trim();
  if (!text) throw new Error("No translated speech is available to dub.");
  if (!config.elevenlabsApiKey) throw new Error("ELEVENLABS_API_KEY is required to clone the speaker in this video.");

  const target = getLanguage(targetLanguage)?.name || targetLanguage;
  const scratch = await mkdtemp(join(tmpdir(), "reellingo-voice-clone-"));
  let voiceId;
  try {
    const samplePath = join(scratch, "speaker-sample.mp3");
    await createSpeechSample(sourceAudioPath, segments, samplePath);

    const form = new FormData();
    form.append("name", `ReelLingo temporary speaker ${Date.now()}`);
    form.append("description", "Temporary clone made from speech in the user's uploaded video.");
    form.append("remove_background_noise", "true");
    form.append("files", new Blob([await readFile(samplePath)], { type: "audio/mpeg" }), "speaker-sample.mp3");
    const cloneResponse = await fetch("https://api.elevenlabs.io/v1/voices/add", {
      method: "POST",
      headers: { "xi-api-key": config.elevenlabsApiKey },
      body: form,
    });
    if (!cloneResponse.ok) {
      throw new Error(`Could not clone the speaker from this video (${cloneResponse.status}): ${await cloneResponse.text()}`);
    }
    const clone = await cloneResponse.json();
    voiceId = clone.voice_id;
    if (!voiceId) throw new Error("ElevenLabs did not return a voice ID for the uploaded speaker.");

    const speechResponse = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": config.elevenlabsApiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({ model_id: "eleven_multilingual_v2", text, language_code: targetLanguage }),
    });
    if (!speechResponse.ok) {
      throw new Error(`Could not synthesize the translated voice (${speechResponse.status}): ${await speechResponse.text()}`);
    }
    const audio = Buffer.from(await speechResponse.arrayBuffer());
    if (audio.length === 0) throw new Error("ElevenLabs returned an empty translated audio file.");
    await writeFile(outputPath, audio);
    return outputPath;
  } finally {
    if (voiceId) {
      try {
        const deleteResponse = await fetch(`https://api.elevenlabs.io/v1/voices/${encodeURIComponent(voiceId)}`, {
          method: "DELETE",
          headers: { "xi-api-key": config.elevenlabsApiKey },
        });
        if (!deleteResponse.ok) console.warn(`Could not delete temporary ElevenLabs voice ${voiceId} (${deleteResponse.status}).`);
      } catch (error) {
        console.warn("Could not delete temporary ElevenLabs voice.", error);
      }
    }
    await rm(scratch, { recursive: true, force: true });
  }
}

async function dub(segments, sourceAudioPath, outputPath, targetLanguage, voiceClone) {
  const text = segments.map((segment) => segment.text).join(" ").trim();
  if (!text) throw new Error("No translated speech is available to dub.");

  if (voiceClone) return dubWithClonedVoice(segments, sourceAudioPath, outputPath, targetLanguage);

  if (!ai) throw new Error("OPENAI_API_KEY is required for translated speech synthesis.");
  const target = getLanguage(targetLanguage)?.name || targetLanguage;
  const scratch = await mkdtemp(join(tmpdir(), "reellingo-tts-"));
  try {
    const chunks = splitSpeechText(text);
    const parts = [];
    for (let index = 0; index < chunks.length; index += 1) {
      const response = await ai.audio.speech.create({
        model: "gpt-4o-mini-tts",
        voice: "alloy",
        input: chunks[index],
        instructions: `Speak naturally and clearly in ${target}. Do not translate, summarize, or add any words.`,
        response_format: "mp3",
      });
      const partPath = join(scratch, `part-${index}.mp3`);
      await writeFile(partPath, Buffer.from(await response.arrayBuffer()));
      parts.push(partPath);
    }
    const concatPath = join(scratch, "parts.txt");
    await writeFile(concatPath, parts.map((path) => `file '${path.replaceAll("'", "'\\''")}'`).join("\n"));
    await run("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", concatPath, "-c:a", "libmp3lame", outputPath]);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
  return outputPath;
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
    const audioPath = join(workdir, "source.wav");
    await extractAudio(localVideoPath, audioPath);
    const mediaInfo = await getMediaInfo(localVideoPath);
    const durationSeconds = Number(mediaInfo.format?.duration);
    const chunksDirectory = join(workdir, "transcription-chunks");
    await mkdir(chunksDirectory, { recursive: true });

    await updateJob(jobId, { current_step: "transcribing" });
    const { segments: rawTranscript, chunkLanguages } = await transcribe(audioPath, chunksDirectory);

    await updateJob(jobId, { current_step: "detecting_languages" });
    const transcript = await detectSegmentLanguages(rawTranscript, undefined, job.source_language);
    const detectedLanguages = [...new Set([
      ...transcript.map((segment) => segment.language).filter((code) => getLanguage(code)),
      ...chunkLanguages,
    ])];
    await updateJob(jobId, {
      transcript_json: JSON.stringify(transcript),
      detected_languages_json: JSON.stringify(detectedLanguages),
      duration_seconds: durationSeconds,
    });

    await updateJob(jobId, { current_step: "translating" });
    const translated = await translate(transcript, job.target_language);
    await updateJob(jobId, { translated_segments_json: JSON.stringify(translated) });

    await updateJob(jobId, { current_step: "dubbing" });
    const dubbedAudioPath = join(workdir, "translated-audio.mp3");
    await dub(translated, audioPath, dubbedAudioPath, job.target_language, Boolean(job.voice_clone));
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