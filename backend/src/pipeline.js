import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { consumeCredit, findCredit, listGlossary, planFor, rewardReferralIfDue } from "./accounts.js";
import { config } from "./config.js";
import { runWithJob } from "./costs.js";
import { getJob, updateJob } from "./database.js";
import { one, query } from "./db.js";
import { dubSegments } from "./dubbing.js";
import { importFromUrl } from "./importer.js";
import { getLanguage } from "./languages.js";
import { lipSync } from "./lipsync.js";
import { logger } from "./logger.js";
import { getMediaInfo, run } from "./media.js";
import { notifyJob } from "./notify.js";
import {
  assertAudibleAudio, displaySize, exportAudioOnly, generateSrt, generateVtt, mergeAudioVideo, writeAss, ASPECTS, aspectSize, encodeAudio,
} from "./render.js";
import { mixDubWithBackground, separateBackground } from "./separation.js";
import { deleteFiles, downloadFile, fileExists, getSignedUrl, uploadBuffer, uploadFile } from "./storage.js";
import { transcribe } from "./transcription.js";
import { detectSegmentLanguages, generateMetadata, translate } from "./translation.js";

export { splitAudioForTranscription, transcribeAudioChunks, whisperLanguageHint } from "./transcription.js";
export { detectSegmentLanguages, translate } from "./translation.js";
export { assertAudibleAudio, mergeAudioVideo } from "./render.js";

/** Thrown when a job pauses on purpose (waiting for the creator to review the translation). */
class PausedForReview extends Error {}

function extensionFor(mimetype, filename) {
  const fromName = extname(filename || "").toLowerCase();
  if (fromName) return fromName;
  if (mimetype?.startsWith("audio/")) return ".mp3";
  return ".mp4";
}

async function probeInput(path) {
  const info = await getMediaInfo(path);
  const durationSeconds = Number(info.format?.duration);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error("Could not read the video's duration.");
  if (!info.streams.some((stream) => stream.codec_type === "audio")) {
    throw new Error("This file has no audio track, so there is no speech to translate.");
  }
  const hasVideo = info.streams.some((stream) => stream.codec_type === "video" && stream.disposition?.attached_pic !== 1);
  return { info, durationSeconds, hasVideo };
}

/** Checks an imported file against the plan the same way an upload is checked, using a credit or trimming if allowed. */
async function enforceImportLimits(job, durationSeconds) {
  const plan = await planFor({ userId: job.user_id, teamId: job.team_id });
  const minutes = durationSeconds / 60;
  if (minutes <= plan.maxVideoMinutes) return {};
  if (job.options_json.trim_to_fit) return { trimSeconds: plan.maxVideoMinutes * 60, note: `Trimmed to the first ${plan.maxVideoMinutes} minutes to fit your plan.` };
  const credit = await findCredit(plan.billingId, Math.ceil(minutes));
  if (credit && await consumeCredit(credit.id, job.id)) return { creditId: credit.id };
  throw new Error(`This video is ${Math.ceil(minutes)} minutes long. Your plan allows ${plan.maxVideoMinutes} minutes. Retry with “trim to fit”, buy a longer pay-as-you-go credit, or upgrade.`);
}

async function acquireInput(job, workdir, step) {
  if (job.source_url && !job.input_storage_path) {
    await step("importing");
    const importDirectory = join(workdir, "import");
    await mkdir(importDirectory, { recursive: true });
    const imported = await importFromUrl(job.source_url, importDirectory);
    const { durationSeconds, hasVideo } = await probeInput(imported.path);
    const limits = await enforceImportLimits(job, durationSeconds);
    const storagePath = `uploads/${randomUUID()}${extensionFor(imported.mimetype, imported.filename)}`;
    await uploadFile(storagePath, imported.path, imported.mimetype);
    const options = limits.trimSeconds ? { ...job.options_json, trim_seconds: limits.trimSeconds } : job.options_json;
    Object.assign(job, await updateJob(job.id, {
      input_storage_path: storagePath,
      original_filename: job.original_filename || imported.filename,
      media_type: hasVideo ? "video" : "audio",
      options_json: options,
      ...(limits.creditId ? { credit_id: limits.creditId } : {}),
    }));
    return { path: imported.path, notes: limits.note ? [limits.note] : [] };
  }
  if (!job.input_storage_path) throw new Error("This project has no source video.");
  if (job.files_expired_at) throw new Error("The original upload has been deleted under the retention policy. Upload the video again.");
  const localPath = join(workdir, `input${extname(job.input_storage_path) || ".mp4"}`);
  await downloadFile(job.input_storage_path, localPath);
  return { path: localPath, notes: [] };
}

async function trimInput(inputPath, seconds, workdir) {
  const trimmed = join(workdir, `trimmed${extname(inputPath) || ".mp4"}`);
  await run("ffmpeg", ["-y", "-i", inputPath, "-t", String(seconds), "-map", "0", "-c", "copy", "-avoid_negative_ts", "make_zero", trimmed]);
  return trimmed;
}

/** Reuses the batch leader's transcript so a video dubbed into several languages is only transcribed once. */
async function leaderTranscript(job) {
  if (!job.depends_on) return null;
  const leader = await getJob(job.depends_on);
  if (!leader?.transcript_json?.length) return null;
  return { transcript: leader.transcript_json, detected: leader.detected_languages_json || [], speakers: leader.speakers_json || null };
}

async function savedVoiceFor(job) {
  const voiceId = Number(job.options_json.voice_id);
  if (!voiceId) return null;
  const voice = await one("SELECT * FROM voices WHERE id = $1 AND user_id = $2", [voiceId, job.user_id]);
  if (!voice) return null;
  await query("UPDATE voices SET last_used_at = CURRENT_TIMESTAMP WHERE id = $1", [voiceId]);
  return voice.provider_voice_id;
}

/** Clip cache backed by storage: each synthesized line is kept under jobs/<id>/clips/<key>.mp3. */
function storageClipCache(job, workdir) {
  const known = new Set(Array.isArray(job.clips_json) ? job.clips_json : []);
  const directory = join(workdir, "cached-clips");
  return {
    known,
    async get(key) {
      if (!known.has(key)) return null;
      try {
        return await downloadFile(`jobs/${job.id}/clips/${key}.mp3`, join(directory, `${key}.mp3`));
      } catch {
        known.delete(key);
        return null;
      }
    },
  };
}

async function cachedBackground(job, mixPath, workdir, durationSeconds, notes) {
  const key = `jobs/${job.id}/work/background.m4a`;
  if (job.options_json.background_cached && await fileExists(key)) {
    return downloadFile(key, join(workdir, "background-cached.m4a"));
  }
  const { backgroundPath, provider, note } = await separateBackground(mixPath, workdir, durationSeconds);
  if (note) notes.push(note);
  if (!backgroundPath) return null;
  const encoded = join(workdir, "background.m4a");
  await run("ffmpeg", ["-y", "-i", backgroundPath, "-c:a", "aac", "-b:a", "160k", encoded]);
  await uploadFile(key, encoded, "audio/mp4");
  await updateJob(job.id, { options_json: { ...job.options_json, background_cached: true, background_provider: provider } });
  job.options_json.background_cached = true;
  return encoded;
}

/**
 * Runs (or resumes) a job. Finished steps are skipped: a transcript or translation already saved on the job is reused,
 * so retries and re-dubs never pay for them twice.
 */
export async function processJob(job, { localInputPath = null } = {}) {
  const workdir = await mkdtemp(join(tmpdir(), `reellingo-${job.id}-`));
  const notes = [];
  const step = (current_step, extra = {}) => updateJob(job.id, { status: "processing", current_step, error_message: null, ...extra });
  try {
    if (config.mockMode) {
      throw new Error("Live dubbing is not configured. Set OPENAI_API_KEY in backend/.env; demo placeholders are never exported as a finished dub.");
    }
    const options = job.options_json || {};

    let inputPath;
    if (localInputPath) {
      inputPath = localInputPath;
    } else {
      const acquired = await acquireInput(job, workdir, step);
      inputPath = acquired.path;
      notes.push(...acquired.notes);
    }
    await step("extracting_audio");
    if (job.options_json.trim_seconds) inputPath = await trimInput(inputPath, job.options_json.trim_seconds, workdir);
    const { info, durationSeconds, hasVideo } = await probeInput(inputPath);
    const isAudioOnly = job.media_type === "audio" || !hasVideo;
    const audioPath = join(workdir, "source.wav");
    const speakerAudioPath = join(workdir, "speaker.wav");
    const mixPath = join(workdir, "mix.wav");
    await run("ffmpeg", ["-y", "-i", inputPath, "-vn", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1", audioPath]);
    await run("ffmpeg", ["-y", "-i", inputPath, "-vn", "-acodec", "pcm_s16le", "-ar", "44100", "-ac", "1", speakerAudioPath]);

    const glossary = await listGlossary(job.user_id);
    let transcript = job.transcript_json;
    let speakers = job.speakers_json;
    if (!transcript?.length) {
      const shared = await leaderTranscript(job);
      if (shared) {
        transcript = shared.transcript;
        speakers = shared.speakers;
        await updateJob(job.id, {
          transcript_json: transcript, detected_languages_json: shared.detected, speakers_json: speakers, duration_seconds: durationSeconds,
        });
      } else {
        await step("transcribing", { duration_seconds: durationSeconds });
        const vocabulary = glossary.map((entry) => entry.term).join(", ").slice(0, 400);
        const result = await transcribe(audioPath, workdir, job.source_language, {
          multiSpeaker: Boolean(options.multi_speaker), vocabulary, durationSeconds, onNote: (note) => notes.push(note),
        });
        await step("detecting_languages");
        transcript = await detectSegmentLanguages(result.segments, undefined, job.source_language);
        const detectedLanguages = [...new Set([
          ...transcript.map((segment) => segment.language).filter((code) => getLanguage(code)),
          ...result.chunkLanguages,
        ])];
        speakers = result.speakers.length ? result.speakers.map((id, index) => ({ id, label: `Speaker ${index + 1}` })) : null;
        await updateJob(job.id, { transcript_json: transcript, detected_languages_json: detectedLanguages, speakers_json: speakers, duration_seconds: durationSeconds });
      }
    }

    let translated = job.translated_segments_json;
    if (!translated?.length || translated.length !== transcript.length) {
      await step("translating");
      translated = await translate(transcript, job.target_language, undefined, { glossary, tone: options.tone || "natural" });
      await updateJob(job.id, { translated_segments_json: translated });
    }

    if (!job.metadata_json) {
      try {
        const metadata = await generateMetadata(translated, job.target_language, { originalTitle: job.original_filename || "" });
        await updateJob(job.id, { metadata_json: metadata });
      } catch (error) {
        logger.warn({ err: error, jobId: job.id }, "Metadata generation failed");
      }
    }

    if (options.review && job.review_state !== "approved") {
      await updateJob(job.id, { status: "awaiting_review", current_step: "review", review_state: "pending", heartbeat_at: null });
      throw new PausedForReview();
    }

    let background = null;
    if (options.keep_background !== false) {
      await step("separating");
      const stereo = Number(info.streams.find((stream) => stream.codec_type === "audio")?.channels || 1) >= 2 ? 2 : 1;
      await run("ffmpeg", ["-y", "-i", inputPath, "-vn", "-acodec", "pcm_s16le", "-ar", "44100", "-ac", String(stereo), mixPath]);
      background = await cachedBackground(job, mixPath, workdir, durationSeconds, notes);
    }

    await step("dubbing");
    const dubbedAudioPath = join(workdir, "translated-audio.wav");
    const clipCache = storageClipCache(job, workdir);
    const dubResult = await dubSegments({
      segments: translated,
      sourceSegments: transcript,
      sourceAudioPath: speakerAudioPath,
      outputPath: dubbedAudioPath,
      targetLanguage: job.target_language,
      voiceClone: Boolean(job.voice_clone),
      savedVoiceId: await savedVoiceFor(job),
      durationSeconds,
      workdir,
      clipCache,
      voiceScope: `job${job.id}`,
    });
    for (const clip of dubResult.newClips) await uploadFile(`jobs/${job.id}/clips/${clip.key}.mp3`, clip.path, "audio/mpeg");
    const currentKeys = [...new Set(dubResult.keys.map((item) => item.key))];
    const staleKeys = [...clipCache.known].filter((key) => !currentKeys.includes(key));
    if (staleKeys.length) await deleteFiles(staleKeys.map((key) => `jobs/${job.id}/clips/${key}.mp3`)).catch(() => undefined);
    await updateJob(job.id, { clips_json: currentKeys, speakers_json: speakers ? speakers.map((speaker) => ({ ...speaker, voice: dubResult.speakers.find((item) => item.speaker === speaker.id)?.voice })) : null });
    if (dubResult.fallbackReason) {
      const voice = dubResult.provider === "openai" ? "an OpenAI voice" : "a standard ElevenLabs voice";
      notes.push(`Some or all lines were dubbed with ${voice}. ${dubResult.fallbackReason}`);
      await updateJob(job.id, { voice_clone: dubResult.voiceCloned });
    }
    await assertAudibleAudio(dubbedAudioPath);

    let finalAudioPath = dubbedAudioPath;
    if (background) {
      await step("mixing");
      finalAudioPath = await mixDubWithBackground(dubbedAudioPath, background, join(workdir, "final-audio.wav"));
    }

    await step("merging");
    const watermark = Boolean(options.watermark);
    const outputs = [];
    const prefix = `jobs/${job.id}`;
    const version = Date.now().toString(36);
    const audioMp3 = join(workdir, "dub.mp3");
    let mainPath;
    if (isAudioOnly) {
      await exportAudioOnly(finalAudioPath, audioMp3, { watermark });
      mainPath = await uploadFile(`${prefix}/output-${version}.mp3`, audioMp3, "audio/mpeg");
      outputs.push({ kind: "audio", label: "Dubbed audio (MP3)", path: mainPath });
    } else {
      const outputPath = join(workdir, "output.mp4");
      await mergeAudioVideo(inputPath, finalAudioPath, outputPath, { watermark });
      mainPath = await uploadFile(`${prefix}/output-${version}.mp4`, outputPath, "video/mp4");
      outputs.push({ kind: "video", label: "Dubbed video (MP4)", path: mainPath });
      await encodeAudio(finalAudioPath, audioMp3);
      outputs.push({ kind: "audio", label: "Dubbed audio only (MP3)", path: await uploadFile(`${prefix}/audio-${version}.mp3`, audioMp3, "audio/mpeg") });
    }

    await step("generating_subtitles");
    const srtPath = await uploadBuffer(`${prefix}/subtitles.srt`, Buffer.from(generateSrt(translated)), "text/plain; charset=utf-8");
    outputs.push({ kind: "subtitles", format: "srt", label: "Subtitles (SRT)", path: srtPath });
    outputs.push({ kind: "subtitles", format: "vtt", label: "Subtitles (VTT)", path: await uploadBuffer(`${prefix}/subtitles.vtt`, Buffer.from(generateVtt(translated)), "text/vtt; charset=utf-8") });

    if (!isAudioOnly && (options.captions || options.formats?.length)) {
      await step("rendering");
      const size = displaySize(info);
      if (options.captions) {
        const assPath = await writeAss(join(workdir, "captions.ass"), translated, { ...size, style: options.captions });
        outputs.push({ kind: "subtitles", format: "ass", label: "Styled subtitles (ASS)", path: await uploadFile(`${prefix}/subtitles.ass`, assPath, "text/plain; charset=utf-8") });
        const captioned = join(workdir, "captioned.mp4");
        await mergeAudioVideo(inputPath, finalAudioPath, captioned, { watermark, assPath });
        outputs.push({ kind: "captioned", label: "Video with burned-in captions", path: await uploadFile(`${prefix}/captioned-${version}.mp4`, captioned, "video/mp4") });
      }
      for (const aspect of options.formats || []) {
        if (!ASPECTS[aspect]) continue;
        const target = aspectSize(size, aspect);
        const slug = aspect.replace(":", "x");
        const assPath = options.captions ? await writeAss(join(workdir, `captions-${slug}.ass`), translated, { ...target, style: options.captions }) : null;
        const variant = join(workdir, `format-${slug}.mp4`);
        await mergeAudioVideo(inputPath, finalAudioPath, variant, { watermark, assPath, aspect });
        outputs.push({ kind: "format", aspect, label: ASPECTS[aspect].label, path: await uploadFile(`${prefix}/format-${slug}-${version}.mp4`, variant, "video/mp4") });
      }
    }

    if (!isAudioOnly && options.lip_sync) {
      await step("lip_syncing");
      try {
        const lipsyncPath = join(workdir, "lipsync.mp4");
        const audioOutput = outputs.find((output) => output.kind === "audio");
        await lipSync({
          videoUrl: await getSignedUrl(job.input_storage_path, 6 * 3600),
          audioUrl: await getSignedUrl(audioOutput.path, 6 * 3600),
          outputPath: lipsyncPath,
          durationSeconds,
        });
        outputs.push({ kind: "lipsync", label: "Lip-synced video", path: await uploadFile(`${prefix}/lipsync-${version}.mp4`, lipsyncPath, "video/mp4") });
      } catch (error) {
        notes.push(`Lip-sync could not be completed: ${error.message}`);
      }
    }

    const previous = await getJob(job.id);
    const oldPaths = (previous?.outputs_json || []).map((output) => output.path).filter((path) => !outputs.some((output) => output.path === path));
    await updateJob(job.id, {
      output_video_path: mainPath,
      output_srt_path: srtPath,
      outputs_json: outputs,
      processing_note: notes.length ? notes.join(" ") : null,
      status: "done",
      current_step: "done",
      completed_at: new Date().toISOString(),
      heartbeat_at: null,
    });
    if (oldPaths.length) await deleteFiles(oldPaths).catch(() => undefined);
    const finished = await getJob(job.id);
    await notifyJob(finished, "done");
    await rewardReferralIfDue(job.user_id).catch((error) => logger.warn({ err: error }, "Referral reward failed"));
    return finished;
  } catch (error) {
    if (error instanceof PausedForReview) {
      await notifyJob(await getJob(job.id), "review");
      return getJob(job.id);
    }
    logger.error({ err: error, jobId: job.id }, "Job failed");
    const failed = await updateJob(job.id, {
      status: "failed",
      error_message: error instanceof Error ? error.message : String(error),
      processing_note: notes.length ? notes.join(" ") : null,
      heartbeat_at: null,
    });
    await notifyJob(failed, "failed");
    return failed;
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
}

export async function runJob(job, options) {
  return runWithJob(job, () => processJob(job, options));
}

/** Backwards-compatible entry point: processes a job using a video file that's already on disk. */
export async function runPipeline(jobId, localVideoPath, job) {
  const current = job?.options_json ? job : await getJob(jobId);
  try {
    await stat(localVideoPath);
  } catch {
    return runJob(current);
  }
  const result = await runJob(current, { localInputPath: localVideoPath });
  await rm(localVideoPath, { force: true });
  return result;
}
