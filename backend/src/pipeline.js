import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { listGlossary, planFor } from "./accounts.js";
import { pickHighlights, renderClip } from "./clips.js";
import { config } from "./config.js";
import { runWithJob } from "./costs.js";
import { getJob, updateJob } from "./database.js";
import { one, query } from "./db.js";
import { dubSegments, retimeToDub } from "./dubbing.js";
import { fitLines, shortenLines } from "./fitlines.js";
import { compareDub, reviewTranslation, speakerSummary } from "./quality.js";
import { findInInbox } from "./inbox.js";
import { importFromUrl } from "./importer.js";
import { getLanguage } from "./languages.js";
import { lipSync } from "./lipsync.js";
import { logger } from "./logger.js";
import { getMediaInfo, run } from "./media.js";
import { alertAdminsOnce, friendlyError } from "./friendly.js";
import { ensureCharged, jobMinutes, lineHash, newCharge, NotEnoughMinutes, perMinuteWeight, refundRun, secondsAffordable } from "./minutes.js";
import { notifyJob } from "./notify.js";
import {
  CAPTION_STYLES, assertAudibleAudio, displaySize, exportAudioOnly, generateSrt, generateVtt, mergeAudioVideo, writeAss, ASPECTS, aspectSize, encodeAudio,
} from "./render.js";
import { openReviewTask } from "./reviews.js";
import { measureQuietGaps, mixDubWithBackground, separateBackground } from "./separation.js";
import { deleteFiles, downloadFile, fileExists, getSignedUrl, uploadBuffer, uploadFile } from "./storage.js";
import { listenToAudio, secondOpinionTranscript, transcribe } from "./transcription.js";
import { detectSegmentLanguages, generateMetadata, translate } from "./translation.js";

export { splitAudioForTranscription, transcribeAudioChunks, whisperLanguageHint } from "./transcription.js";
export { detectSegmentLanguages, translate } from "./translation.js";
export { assertAudibleAudio, mergeAudioVideo } from "./render.js";

const subtitlesOnly_ = (options) => options.mode === "subtitles";

/** Adds to the project's quality report without disturbing anything else saved on the project. */
async function saveQualityReport(jobId, patch) {
  const latest = await getJob(jobId);
  const report = { ...(latest.options_json?.quality_report || {}), ...patch };
  await updateJob(jobId, { options_json: { ...latest.options_json, quality_report: report } });
}

const round2 = (value) => Math.round(Number(value) * 100) / 100;

/** Thrown when a job pauses on purpose (waiting for the creator to review the translation). */
class PausedForReview extends Error {}

/** Thrown when another attempt has taken over this job (it was requeued), so this copy must stop instead of repeating the work. */
class JobSuperseded extends Error {}

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

/**
 * Charges an imported video once its length is known (the same rules as an upload): the plan's longest video,
 * then the account's minutes. With "trim to fit" it keeps only what the plan and minutes allow.
 */
async function chargeImport(job, durationSeconds) {
  const plan = await planFor({ userId: job.user_id, teamId: job.team_id });
  const options = job.options_json;
  const weights = { mode: options.mode || "dub", lipSync: Boolean(options.lip_sync), humanReview: Boolean(options.human_review) };
  let seconds = durationSeconds;
  let trimSeconds = null;
  const notes = [];
  if (seconds / 60 > plan.maxVideoMinutes) {
    if (!options.trim_to_fit) {
      throw new Error(`This video is ${Math.ceil(seconds / 60)} minutes long. Your plan allows ${plan.maxVideoMinutes} minutes. Retry with “trim to fit”, or upgrade.`);
    }
    trimSeconds = plan.maxVideoMinutes * 60;
    seconds = trimSeconds;
    notes.push(`Trimmed to the first ${plan.maxVideoMinutes} minutes to fit your plan.`);
  }
  let minutes = jobMinutes({ durationSeconds: seconds, ...weights });
  if (minutes > plan.minutes.available && options.trim_to_fit) {
    const affordable = secondsAffordable(plan.minutes.available, perMinuteWeight(weights));
    if (affordable >= 10 && affordable < seconds) {
      trimSeconds = affordable;
      minutes = jobMinutes({ durationSeconds: affordable, ...weights });
      notes.push(`Trimmed to the first ${Math.floor(affordable / 60)}:${String(affordable % 60).padStart(2, "0")} to fit the minutes you have left.`);
    }
  }
  const nextOptions = { ...options, charge: newCharge(minutes, "job"), charge_on_import: false, ...(trimSeconds ? { trim_seconds: trimSeconds } : {}) };
  Object.assign(job, await updateJob(job.id, { options_json: nextOptions }));
  await ensureCharged(job, { billingId: plan.billingId, allowance: plan.plan.minutes_per_month, periodEnd: plan.periodEnd });
  return { notes };
}

async function acquireInput(job, workdir, step) {
  if (job.source_url && !job.input_storage_path) {
    await step("importing");
    const importDirectory = join(workdir, "import");
    await mkdir(importDirectory, { recursive: true });
    const imported = await importFromUrl(job.source_url, importDirectory);
    const { durationSeconds, hasVideo } = await probeInput(imported.path);
    const charged = job.options_json.charge_on_import ? await chargeImport(job, durationSeconds) : { notes: [] };
    const storagePath = `uploads/${randomUUID()}${extensionFor(imported.mimetype, imported.filename)}`;
    await uploadFile(storagePath, imported.path, imported.mimetype);
    Object.assign(job, await updateJob(job.id, {
      input_storage_path: storagePath,
      original_filename: job.original_filename || imported.filename,
      media_type: hasVideo ? "video" : "audio",
    }));
    return { path: imported.path, notes: charged.notes };
  }
  if (!job.input_storage_path) throw new Error("This project has no source video.");
  if (job.files_expired_at) throw new Error("The original upload has been deleted under the retention policy. Upload the video again.");
  // The upload is usually still on this computer: use it instead of fetching it back from storage.
  const local = await findInInbox(job.input_storage_path);
  if (local) return { path: local, notes: [] };
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

export async function cachedBackground(job, mixPath, workdir, durationSeconds, notes, signal) {
  const key = `jobs/${job.id}/work/background.m4a`;
  // A background made by the old ElevenLabs method still had the original voice in it, so it is never reused.
  const trusted = job.options_json.background_provider !== "elevenlabs";
  if (job.options_json.background_cached && trusted && await fileExists(key)) {
    return downloadFile(key, join(workdir, "background-cached.m4a"));
  }
  const { backgroundPath, provider, note } = await separateBackground(mixPath, workdir, durationSeconds, { signal });
  if (note) notes.push(note);
  if (!backgroundPath) return null;
  const encoded = join(workdir, "background.m4a");
  await run("ffmpeg", ["-y", "-i", backgroundPath, "-c:a", "aac", "-b:a", "160k", encoded]);
  await uploadFile(key, encoded, "audio/mp4");
  await updateJob(job.id, { options_json: { ...job.options_json, background_cached: true, background_provider: provider } });
  job.options_json.background_cached = true;
  job.options_json.background_provider = provider;
  return encoded;
}

/**
 * Runs (or resumes) a job. Finished steps are skipped: a transcript or translation already saved on the job is reused,
 * so retries and re-dubs never pay for them twice.
 */
export async function processJob(job, { localInputPath = null } = {}) {
  const workdir = await mkdtemp(join(tmpdir(), `reellingo-${job.id}-`));
  const notes = [];
  const stopBackground = new AbortController();
  let backgroundTask = null;
  // Finished files are saved to storage while the next step is already running; everything is awaited before the job is marked done.
  const pendingSaves = [];
  const save = (path, localPath, contentType) => {
    const saving = uploadFile(path, localPath, contentType);
    saving.catch(() => undefined); // a failure is raised when the saves are awaited; this only stops it being reported twice
    pendingSaves.push(saving);
    return path;
  };
  const runStartedAt = Date.now();
  const step = (current_step, extra = {}) => {
    if (job.lease?.lost) throw new JobSuperseded();
    logger.info({ jobId: job.id, step: current_step, seconds: Math.round((Date.now() - runStartedAt) / 1000) }, "Step started");
    return updateJob(job.id, { status: "processing", current_step, error_message: null, ...extra });
  };
  try {
    if (config.mockMode) {
      throw new Error("Live dubbing is not configured. Set OPENAI_API_KEY in backend/.env; demo placeholders are never exported as a finished dub.");
    }
    const options = job.options_json || {};
    if (options.task === "clips") return await makeClips(job, workdir);
    if (options.task === "captions") return await makeCaptionedVideo(job, workdir);
    const subtitlesOnly = options.mode === "subtitles";

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

    // Removing the speech from the original sound (to keep its music and effects) is the slowest step, and it doesn't need
    // the transcript or the translation. So it starts now and runs alongside them; it only has to be ready for the final mix.
    // Projects that stop for a review first do it afterwards instead (their work folder is cleared while they wait).
    const wantsBackground = !subtitlesOnly && options.keep_background !== false;
    const startBackground = () => (async () => {
      const stereo = Number(info.streams.find((stream) => stream.codec_type === "audio")?.channels || 1) >= 2 ? 2 : 1;
      await run("ffmpeg", ["-y", "-i", inputPath, "-vn", "-acodec", "pcm_s16le", "-ar", "44100", "-ac", String(stereo), mixPath], { signal: stopBackground.signal });
      return cachedBackground(job, mixPath, workdir, durationSeconds, notes, stopBackground.signal);
    })().catch((error) => {
      if (stopBackground.signal.aborted) return null;
      logger.warn({ err: error, jobId: job.id }, "Could not keep the background audio");
      notes.push("The original background sound could not be kept, so the dub plays on its own.");
      return null;
    });
    let backgroundSettled = false;
    if (wantsBackground && !options.review && !options.human_review) {
      backgroundTask = startBackground().finally(() => { backgroundSettled = true; });
    }

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
        if (job.source_language === "auto" || config.detectLanguagesAlways) {
          await step("detecting_languages");
          transcript = await detectSegmentLanguages(result.segments, undefined, job.source_language);
        } else {
          // The creator named the language, so there's no need to ask an AI which language each line is in.
          transcript = result.segments.map((segment) => ({ ...segment, language: getLanguage(segment.language) && segment.language !== "und" ? segment.language : job.source_language }));
        }
        const detectedLanguages = [...new Set([
          ...transcript.map((segment) => segment.language).filter((code) => getLanguage(code)),
          ...result.chunkLanguages,
        ])];
        speakers = result.speakers.length ? result.speakers.map((id, index) => ({ id, label: `Speaker ${index + 1}` })) : null;
        await updateJob(job.id, { transcript_json: transcript, detected_languages_json: detectedLanguages, speakers_json: speakers, duration_seconds: durationSeconds });
      }
    }

    // Now that we know where people speak, listen to the gaps between them. If those are nearly silent there is no music or effects
    // to keep, so the (slow) separation running since the start is cancelled and the dub simply plays on its own.
    if (backgroundTask && !backgroundSettled && config.skipQuietBackground) {
      const gaps = await measureQuietGaps(audioPath, transcript, durationSeconds).catch(() => null);
      if (gaps && gaps.meanDb <= config.quietBackgroundDb) {
        logger.info({ jobId: job.id, ...gaps }, "No background sound between the lines, so background separation was skipped");
        stopBackground.abort();
        notes.push("No background music was detected, so the dub plays on its own.");
      }
    }

    // A second engine listens to the same audio while the translation is made, to catch words the first one got wrong.
    const wantsReview = config.qualityCheck && !subtitlesOnly_(options) && !options.quality_report?.translation && job.source_language !== "pcm" && Boolean(speakers?.length);
    const secondOpinion = wantsReview
      ? secondOpinionTranscript(audioPath, workdir, job.source_language).catch((error) => { logger.warn({ err: error, jobId: job.id }, "Second transcript failed"); return null; })
      : null;
    let translated = job.translated_segments_json;
    if (!translated?.length || translated.length !== transcript.length) {
      await step("translating");
      translated = await translate(transcript, job.target_language, undefined, { glossary, tone: options.tone || "natural", onNote: (note) => notes.push(note) });
      await updateJob(job.id, { translated_segments_json: translated });
    }

    if (config.qualityCheck && !options.quality_report?.translation) {
      try {
        const review = await reviewTranslation({
          transcript, translated, alternate: await secondOpinion, sourceLanguage: job.source_language, targetLanguage: job.target_language, onNote: (note) => notes.push(note),
        });
        if (review.changed) {
          transcript = review.transcript;
          translated = review.translated;
          await updateJob(job.id, { transcript_json: transcript, translated_segments_json: translated });
        }
        await saveQualityReport(job.id, { version: 1, at: new Date().toISOString(), speakers: speakerSummary(transcript), ...review.report });
      } catch (error) {
        logger.warn({ err: error, jobId: job.id }, "Quality review failed");
      }
    }

    if (!job.metadata_json) {
      try {
        const metadata = await generateMetadata(translated, job.target_language, { originalTitle: job.original_filename || "" });
        await updateJob(job.id, { metadata_json: metadata });
      } catch (error) {
        logger.warn({ err: error, jobId: job.id }, "Metadata generation failed");
      }
    }

    // Human review by a native speaker comes first, then the creator's own review (if they asked for either).
    if (options.human_review && !["human_done", "approved", "pending"].includes(job.review_state)) {
      Object.assign(job, await getJob(job.id));
      await openReviewTask(job);
      await updateJob(job.id, { status: "awaiting_review", current_step: "human_review", review_state: "human_pending", heartbeat_at: null });
      throw new PausedForReview("human");
    }
    if (options.review && job.review_state !== "approved") {
      await updateJob(job.id, { status: "awaiting_review", current_step: "review", review_state: "pending", heartbeat_at: null });
      throw new PausedForReview();
    }

    if (subtitlesOnly) return await finishSubtitles(job, { inputPath, info, isAudioOnly, translated, transcript, notes, workdir });

    // The background track keeps being prepared while the voice is made (it is only needed for the final mix below).
    if (wantsBackground && !backgroundTask) backgroundTask = startBackground().finally(() => { backgroundSettled = true; });

    // Lines too long to say in the time on screen are shortened now, so the voice doesn't have to rush them.
    const fitted = await fitLines(translated, job.target_language, durationSeconds, { onNote: (note) => notes.push(note) });
    if (fitted.shortened) {
      translated = fitted.segments;
      await updateJob(job.id, { translated_segments_json: translated });
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
      preferredVoice: options.nigerian_voice || null,
      refit: config.fitLines ? (lines) => shortenLines(lines, job.target_language).catch(() => new Map()) : null,
    });
    if (dubResult.revised?.length) {
      translated = translated.map((segment, index) => dubResult.revised.find((line) => line.index === index) ? { ...segment, text: dubResult.revised.find((line) => line.index === index).text } : segment);
      await updateJob(job.id, { translated_segments_json: translated });
    }
    // Where each line really landed in the dub (start, end, speed-up): subtitles and clips are timed from this, so they match what is heard.
    if (dubResult.timeline?.length) {
      const latest = await getJob(job.id);
      job.options_json = { ...latest.options_json, dub_timeline: dubResult.timeline.map((line) => [line.index, round2(line.start), round2(line.end), round2(line.speed), round2(line.naturalSeconds)]) };
      await updateJob(job.id, { options_json: job.options_json });
    }
    for (const clip of dubResult.newClips) await uploadFile(`jobs/${job.id}/clips/${clip.key}.mp3`, clip.path, "audio/mpeg");
    const currentKeys = [...new Set(dubResult.keys.map((item) => item.key))];
    const staleKeys = [...clipCache.known].filter((key) => !currentKeys.includes(key));
    if (staleKeys.length) await deleteFiles(staleKeys.map((key) => `jobs/${job.id}/clips/${key}.mp3`)).catch(() => undefined);
    await updateJob(job.id, { clips_json: currentKeys, speakers_json: speakers ? speakers.map((speaker) => ({ ...speaker, voice: dubResult.speakers.find((item) => item.speaker === speaker.id)?.voice })) : null });
    if (dubResult.notice) notes.push(dubResult.notice);
    if (dubResult.fallbackReason) {
      const voice = dubResult.provider === "openai" ? "an OpenAI voice" : "a standard ElevenLabs voice";
      notes.push(`Some or all lines were dubbed with ${voice}. ${dubResult.fallbackReason}`);
      await updateJob(job.id, { voice_clone: dubResult.voiceCloned });
    }
    await assertAudibleAudio(dubbedAudioPath);
    // Listen to the finished dub while the background and video are put together, and check it says what it should.
    const dubCheck = config.qualityCheck && dubResult.timeline?.length
      ? Promise.race([
        listenToAudio(dubbedAudioPath, workdir, job.target_language, durationSeconds)
          .then((heard) => compareDub({ words: heard.words, timeline: job.options_json.dub_timeline, translated, targetLanguage: job.target_language, heardLanguage: heard.language })),
        new Promise((resolve) => setTimeout(() => resolve(null), 150_000)),
      ]).catch((error) => { logger.warn({ err: error, jobId: job.id }, "Dub check failed"); return null; })
      : null;

    let background = null;
    if (backgroundTask) {
      if (!backgroundSettled) await step("separating"); // only shows if the voice finished first
      background = await backgroundTask;
    }
    let finalAudioPath = dubbedAudioPath;
    if (background) {
      await step("mixing");
      finalAudioPath = await mixDubWithBackground(dubbedAudioPath, background, join(workdir, "final-audio.wav"));
    }

    await step("merging");
    const watermark = Boolean(options.watermark);
    const earlierOutputs = (await getJob(job.id))?.outputs_json || []; // from a previous run: replaced (and deleted) when the new ones are ready
    const outputs = [];
    const prefix = `jobs/${job.id}`;
    const version = Date.now().toString(36);
    const audioMp3 = join(workdir, "dub.mp3");
    let mainPath;
    if (isAudioOnly) {
      await exportAudioOnly(finalAudioPath, audioMp3, { watermark });
      mainPath = save(`${prefix}/output-${version}.mp3`, audioMp3, "audio/mpeg");
      outputs.push({ kind: "audio", label: "Dubbed audio (MP3)", path: mainPath });
    } else {
      const outputPath = join(workdir, "output.mp4");
      await mergeAudioVideo(inputPath, finalAudioPath, outputPath, { watermark });
      mainPath = save(`${prefix}/output-${version}.mp4`, outputPath, "video/mp4");
      outputs.push({ kind: "video", label: "Dubbed video (MP4)", path: mainPath });
      await encodeAudio(finalAudioPath, audioMp3);
      outputs.push({ kind: "audio", label: "Dubbed audio only (MP3)", path: save(`${prefix}/audio-${version}.mp3`, audioMp3, "audio/mpeg") });
    }

    await step("generating_subtitles");
    // Subtitles follow the dubbed voice (where each line really starts and ends), not the original speech timing.
    const subtitleLines = retimeToDub(translated, job.options_json?.dub_timeline);
    const srtPath = await uploadBuffer(`${prefix}/subtitles.srt`, Buffer.from(generateSrt(subtitleLines)), "text/plain; charset=utf-8");
    outputs.push({ kind: "subtitles", format: "srt", label: "Subtitles (SRT)", path: srtPath });
    outputs.push({ kind: "subtitles", format: "vtt", label: "Subtitles (VTT)", path: await uploadBuffer(`${prefix}/subtitles.vtt`, Buffer.from(generateVtt(subtitleLines)), "text/vtt; charset=utf-8") });

    if (dubCheck) {
      const dub = await dubCheck;
      if (dub) await saveQualityReport(job.id, { dub });
      else await saveQualityReport(job.id, { dub: { checked: false } });
    }

    // Captioned and resized copies, and lip-sync, take a while. The dubbed video itself is ready now, so show it
    // and keep making the extras behind it (a failure there only costs the extras, not the dub).
    const extrasWanted = !isAudioOnly && Boolean(options.captions || options.formats?.length || options.lip_sync);
    let mainShown = false;
    if (extrasWanted && config.deferExtras) {
      await Promise.all(pendingSaves);
      const current = await getJob(job.id);
      await updateJob(job.id, {
        output_video_path: mainPath, output_srt_path: srtPath, completed_at: new Date().toISOString(),
        outputs_json: [...outputs, ...earlierOutputs.filter((output) => output.kind === "clip")],
        options_json: { ...current.options_json, extras_running: true },
        processing_note: notes.length ? notes.join(" ") : null,
      });
      await notifyJob(await getJob(job.id), "done");
      mainShown = true;
    }
    const extra = async (task) => {
      if (!mainShown) return task();
      try {
        await task();
      } catch (error) {
        if (error instanceof JobSuperseded) throw error;
        logger.warn({ err: error, jobId: job.id }, "An extra version could not be made");
        notes.push(`An extra version (captions, sizes or lip-sync) could not be made: ${friendlyError(error).text}`);
      }
    };

    if (!isAudioOnly && (options.captions || options.formats?.length)) await extra(async () => {
      await step("rendering");
      const size = displaySize(info);
      if (options.captions) {
        const assPath = await writeAss(join(workdir, "captions.ass"), subtitleLines, { ...size, style: options.captions });
        outputs.push({ kind: "subtitles", format: "ass", label: "Styled subtitles (ASS)", path: await uploadFile(`${prefix}/subtitles.ass`, assPath, "text/plain; charset=utf-8") });
        const captioned = join(workdir, "captioned.mp4");
        await mergeAudioVideo(inputPath, finalAudioPath, captioned, { watermark, assPath });
        outputs.push({ kind: "captioned", label: "Video with burned-in captions", path: save(`${prefix}/captioned-${version}.mp4`, captioned, "video/mp4") });
      }
      for (const aspect of options.formats || []) {
        if (!ASPECTS[aspect]) continue;
        const target = aspectSize(size, aspect);
        const slug = aspect.replace(":", "x");
        const assPath = options.captions ? await writeAss(join(workdir, `captions-${slug}.ass`), subtitleLines, { ...target, style: options.captions }) : null;
        const variant = join(workdir, `format-${slug}.mp4`);
        await mergeAudioVideo(inputPath, finalAudioPath, variant, { watermark, assPath, aspect });
        // Saving this one runs while the next one is being drawn.
        const output = { kind: "format", aspect, label: ASPECTS[aspect].label, path: `${prefix}/format-${slug}-${version}.mp4` };
        outputs.push(output);
        save(output.path, variant, "video/mp4");
      }
    });

    await Promise.all(pendingSaves); // lip-sync reads the saved video, and the files must be there before anything is shown as ready
    if (!isAudioOnly && options.lip_sync) await extra(async () => {
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
    });

    const previous = await getJob(job.id);
    const oldPaths = earlierOutputs.map((output) => output.path).filter((path) => !outputs.some((output) => output.path === path));
    // Clips made from an earlier version of the dub are kept until new ones are made.
    const keptClips = (previous?.outputs_json || []).filter((output) => output.kind === "clip");
    await updateJob(job.id, {
      output_video_path: mainPath,
      output_srt_path: srtPath,
      outputs_json: [...outputs, ...keptClips],
      processing_note: notes.length ? notes.join(" ") : null,
      options_json: { ...(await getJob(job.id)).options_json, dubbed_hashes: translated.map((segment) => lineHash(segment.text)), extras_running: undefined },
      status: "done",
      current_step: "done",
      completed_at: new Date().toISOString(),
      heartbeat_at: null,
    });
    if (oldPaths.length) await deleteFiles(oldPaths.filter((path) => !keptClips.some((clip) => clip.path === path))).catch(() => undefined);
    const finished = await getJob(job.id);
    if (!mainShown) await notifyJob(finished, "done"); // already told them when the dubbed video was ready
    return finished;
  } catch (error) {
    // Another attempt owns this job now. It carries on from the saved steps; this one just stops.
    if (error instanceof JobSuperseded) return null;
    if (error instanceof PausedForReview) {
      // Human reviews wait for a reviewer, so the creator isn't asked to do anything yet.
      if (error.message !== "human") await notifyJob(await getJob(job.id), "review");
      return getJob(job.id);
    }
    return failJob(job, error, notes);
  } finally {
    // If the job ended early (failed, paused for review), stop the background work and wait for it to let go of the files.
    stopBackground.abort();
    await backgroundTask?.catch(() => undefined);
    await Promise.allSettled(pendingSaves);
    // Developers can keep the temporary folder to listen to the separated tracks and the dub (scripts/dev/dub-local.mjs).
    if (process.env.REELLINGO_KEEP_WORKDIR) logger.info({ jobId: job.id, workdir }, "Keeping the work folder");
    else await rm(workdir, { recursive: true, force: true });
  }
}

/**
 * A failed run gives its minutes back. Short clips are an extra on a finished project, so if they fail the
 * project stays finished and only the clips' minutes are refunded.
 */
async function failJob(job, error, notes = []) {
  const technical = error instanceof Error ? error.message : String(error);
  logger.error({ err: error, jobId: job.id }, "Job failed");
  // The customer reads a sentence they can act on; the full provider message stays in the log (and the admins are
  // emailed when something on our side, like credit or a key, needs fixing).
  const friendly = friendlyError(error);
  if (friendly.alertsAdmin) {
    void alertAdminsOnce(friendly.kind, `ReelLingo: a service needs attention (${friendly.kind === "credit" ? "out of credit" : "connection problem"})`,
      `Project #${job.id} could not finish. The customer was told we're fixing it and their minutes were returned.\n\nWhat the service said:\n${technical.slice(0, 800)}\n\nCheck Admin → API usage.`);
  }
  const message = friendly.text;
  const latest = (await getJob(job.id)) || job;
  const refunded = await refundRun(latest).catch((refundError) => {
    logger.error({ err: refundError, jobId: job.id }, "Refund after failure failed");
    return 0;
  });
  const refundNote = refunded ? ` The ${refunded} minute${refunded === 1 ? " was" : "s were"} returned to your balance.` : "";
  if (latest.options_json?.task === "clips") {
    const { task, ...options } = latest.options_json;
    return updateJob(job.id, {
      status: "done", current_step: "done", heartbeat_at: null, options_json: options,
      processing_note: `Short clips could not be made: ${message}${refundNote}`,
    });
  }
  if (latest.options_json?.task === "captions") {
    // The finished video is untouched: only the extra render failed, so the project stays finished.
    return updateJob(job.id, {
      status: "done", current_step: "done", heartbeat_at: null, options_json: afterCaptionTask(latest.options_json),
      processing_note: `Subtitles could not be added to the video: ${message}`,
    });
  }
  const failed = await updateJob(job.id, {
    status: "failed",
    error_message: error instanceof NotEnoughMinutes ? message : `${message}${refundNote}`,
    processing_note: notes.length ? notes.join(" ") : null,
    heartbeat_at: null,
  });
  await notifyJob(failed, "failed");
  return failed;
}

/** Subtitles-only projects: translated subtitle files, plus a captioned copy of the original video if requested. */
async function finishSubtitles(job, { inputPath, info, isAudioOnly, translated, transcript, notes, workdir }) {
  const options = job.options_json || {};
  const prefix = `jobs/${job.id}`;
  const version = Date.now().toString(36);
  const outputs = [];
  await updateJob(job.id, { status: "processing", current_step: "generating_subtitles" });
  const srtPath = await uploadBuffer(`${prefix}/subtitles.srt`, Buffer.from(generateSrt(translated)), "text/plain; charset=utf-8");
  outputs.push({ kind: "subtitles", format: "srt", label: `Subtitles in ${getLanguage(job.target_language)?.name || job.target_language} (SRT)`, path: srtPath });
  outputs.push({ kind: "subtitles", format: "vtt", label: "Subtitles (VTT)", path: await uploadBuffer(`${prefix}/subtitles.vtt`, Buffer.from(generateVtt(translated)), "text/vtt; charset=utf-8") });
  outputs.push({ kind: "subtitles", format: "srt-original", label: "Original-language subtitles (SRT)", path: await uploadBuffer(`${prefix}/subtitles-original.srt`, Buffer.from(generateSrt(transcript)), "text/plain; charset=utf-8") });

  let mainPath = null;
  if (!isAudioOnly && (options.captions || options.formats?.length)) {
    await updateJob(job.id, { status: "processing", current_step: "rendering" });
    const size = displaySize(info);
    const watermark = Boolean(options.watermark);
    const style = options.captions || "classic";
    const assPath = await writeAss(join(workdir, "captions.ass"), translated, { ...size, style });
    outputs.push({ kind: "subtitles", format: "ass", label: "Styled subtitles (ASS)", path: await uploadFile(`${prefix}/subtitles.ass`, assPath, "text/plain; charset=utf-8") });
    const captioned = join(workdir, "captioned.mp4");
    // The original audio is kept: only captions (and the watermark on free plans) are added.
    await mergeAudioVideo(inputPath, inputPath, captioned, { watermark, assPath });
    mainPath = await uploadFile(`${prefix}/captioned-${version}.mp4`, captioned, "video/mp4");
    outputs.push({ kind: "captioned", label: "Video with burned-in subtitles", path: mainPath });
    for (const aspect of options.formats || []) {
      if (!ASPECTS[aspect]) continue;
      const target = aspectSize(size, aspect);
      const slug = aspect.replace(":", "x");
      const variantAss = await writeAss(join(workdir, `captions-${slug}.ass`), translated, { ...target, style });
      const variant = join(workdir, `format-${slug}.mp4`);
      await mergeAudioVideo(inputPath, inputPath, variant, { watermark, assPath: variantAss, aspect });
      outputs.push({ kind: "format", aspect, label: ASPECTS[aspect].label, path: await uploadFile(`${prefix}/format-${slug}-${version}.mp4`, variant, "video/mp4") });
    }
  }
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
  const finished = await getJob(job.id);
  await notifyJob(finished, "done");
  return finished;
}

/** The project's options once an add-on task is over: no task marker, and the real charge for the dub is back in place. */
function afterCaptionTask(options) {
  const { task, pre_task_charge: charge, ...rest } = options;
  return { ...rest, charge: charge ?? undefined };
}

/**
 * "Download video with subtitles": burns the project's subtitles into the finished video so they show while it plays,
 * in any player, on any phone, with no separate file. It doesn't re-dub anything and uses no minutes.
 */
async function makeCaptionedVideo(job, workdir) {
  const step = (current_step) => updateJob(job.id, { status: "processing", current_step, error_message: null });
  try {
    const options = job.options_json || {};
    const style = CAPTION_STYLES[options.caption_style] ? options.caption_style : "classic";
    const segments = job.translated_segments_json || [];
    if (!segments.length) throw new Error("This project has no subtitles to add.");
    const outputs = job.outputs_json || [];
    // Put the subtitles on the finished (dubbed) video. Subtitles-only projects use the original video.
    const dubbed = outputs.find((output) => output.kind === "lipsync") || outputs.find((output) => output.kind === "video");
    let sourcePath = dubbed?.path;
    let watermark = false; // the dubbed video already carries the plan's watermark
    if (!sourcePath) {
      if (!job.input_storage_path || job.files_expired_at) throw new Error("The video for this project is no longer stored.");
      sourcePath = job.input_storage_path;
      watermark = Boolean(options.watermark);
    }
    await step("rendering");
    const videoPath = await downloadFile(sourcePath, join(workdir, "source-video.mp4"));
    const info = await getMediaInfo(videoPath);
    const assPath = await writeAss(join(workdir, "captions.ass"), segments, { ...displaySize(info), style });
    const rendered = join(workdir, "with-subtitles.mp4");
    // The picture is re-drawn with the subtitles on it; the sound is kept as it is.
    await mergeAudioVideo(videoPath, videoPath, rendered, { watermark, assPath });
    const version = Date.now().toString(36);
    const stored = await uploadFile(`jobs/${job.id}/captioned-${version}.mp4`, rendered, "video/mp4");
    const latest = await getJob(job.id);
    const previous = (latest.outputs_json || []).filter((output) => output.kind === "captioned");
    await updateJob(job.id, {
      outputs_json: [
        ...(latest.outputs_json || []).filter((output) => output.kind !== "captioned"),
        { kind: "captioned", style, label: "Video with subtitles on screen", path: stored },
      ],
      options_json: afterCaptionTask(latest.options_json),
      status: "done", current_step: "done", heartbeat_at: null,
      processing_note: "Your video with subtitles on screen is ready.",
    });
    if (previous.length) await deleteFiles(previous.map((output) => output.path)).catch(() => undefined);
    return getJob(job.id);
  } catch (error) {
    return failJob(job, error);
  }
}

/** Short clips: 3-5 vertical, captioned highlights cut from the finished dub. */
async function makeClips(job, workdir) {
  const step = (current_step) => updateJob(job.id, { status: "processing", current_step, error_message: null });
  try {
    const outputs = job.outputs_json || [];
    const source = outputs.find((output) => output.kind === "lipsync") || outputs.find((output) => output.kind === "video") || outputs.find((output) => output.kind === "captioned");
    if (!source) throw new Error("There's no finished video to cut clips from.");
    const segments = job.translated_segments_json || [];
    await step("choosing_clips");
    const highlights = await pickHighlights(segments, { language: job.target_language, durationSeconds: Number(job.duration_seconds) || 0 });
    if (!highlights.length) throw new Error("No part of this video was long enough to make a clip.");
    const videoPath = await downloadFile(source.path, join(workdir, "dub.mp4"));
    await step("rendering_clips");
    const prefix = `jobs/${job.id}/clips-out`;
    const version = Date.now().toString(36);
    const clips = [];
    for (const [index, highlight] of highlights.entries()) {
      const rendered = await renderClip(videoPath, segments, {
        start: highlight.start, end: highlight.end, workdir, index,
        style: job.options_json.captions || "bold", watermark: Boolean(job.options_json.watermark),
      });
      clips.push({
        kind: "clip", label: `Clip ${index + 1}: ${highlight.title}`, start: highlight.start, end: highlight.end,
        path: await uploadFile(`${prefix}/clip-${index + 1}-${version}.mp4`, rendered, "video/mp4"),
      });
    }
    const latest = await getJob(job.id);
    const oldClips = (latest.outputs_json || []).filter((output) => output.kind === "clip");
    const { task, ...options } = latest.options_json;
    await updateJob(job.id, {
      outputs_json: [...(latest.outputs_json || []).filter((output) => output.kind !== "clip"), ...clips],
      options_json: options,
      status: "done", current_step: "done", heartbeat_at: null,
      processing_note: `${clips.length} short clip${clips.length === 1 ? "" : "s"} ready.`,
    });
    if (oldClips.length) await deleteFiles(oldClips.map((clip) => clip.path)).catch(() => undefined);
    return getJob(job.id);
  } catch (error) {
    return failJob(job, error);
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
