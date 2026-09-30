import express from "express";
import multer from "multer";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { consumeCredit, listGlossary, planFor } from "../accounts.js";
import { config } from "../config.js";
import { jobCosts } from "../costs.js";
import { countInputUsers, createJob, getJob, listJobs, updateJob } from "../database.js";
import { one } from "../db.js";
import { asyncRoute, authenticate, blockDuringMaintenance, HttpError, jobLimiter, jobOutput, requireLivePipeline, workspace } from "../http.js";
import { purgeJob } from "../jobfiles.js";
import { classifyImportUrl } from "../importer.js";
import { getLanguage } from "../languages.js";
import { lipSyncUnavailableReason } from "../lipsync.js";
import { logger } from "../logger.js";
import { getMediaInfo } from "../media.js";
import { ASPECTS, CAPTION_STYLES } from "../render.js";
import { scanFile } from "../scan.js";
import { uploadFile } from "../storage.js";
import { getMembership } from "../teams.js";
import { TONES, translateLine } from "../translation.js";
import { claimUpload } from "../uploads.js";
import { publishToYoutube } from "../youtube.js";

export const ALLOWED_MEDIA_TYPES = new Set([
  "video/mp4", "video/quicktime", "video/x-msvideo", "video/webm", "video/x-matroska",
  "audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/wave", "audio/mp4", "audio/x-m4a", "audio/aac", "audio/ogg", "audio/webm", "audio/flac",
]);
const uploadDirectory = join(tmpdir(), "reellingo-uploads");
await mkdir(uploadDirectory, { recursive: true });

const upload = multer({
  dest: uploadDirectory,
  limits: { fileSize: config.uploadLimitBytes },
  fileFilter: (_request, file, callback) => {
    if (!ALLOWED_MEDIA_TYPES.has(file.mimetype)) {
      callback(new Error("Unsupported file type. Please upload a video (MP4, MOV, AVI, WebM, MKV) or audio file (MP3, WAV, M4A, AAC, OGG, FLAC)."));
      return;
    }
    callback(null, true);
  },
});

const router = express.Router();

function bool(value) {
  return value === true || value === "true" || value === "1" || value === "on";
}

function list(value) {
  if (Array.isArray(value)) return value.flatMap(list);
  if (value === undefined || value === null || value === "") return [];
  const text = String(value).trim();
  if (text.startsWith("[")) {
    try {
      return JSON.parse(text).map(String);
    } catch {
      return [];
    }
  }
  return text.split(",").map((item) => item.trim()).filter(Boolean);
}

/** Loads a job the user may access: their own personal job, or any job in a team they belong to. */
export async function loadAccessibleJob(request, { allowDeleted = false } = {}) {
  const jobId = Number(request.params.jobId);
  const job = Number.isInteger(jobId) ? await getJob(jobId) : null;
  if (!job || (job.deleted_at && !allowDeleted)) throw new HttpError(404, "Job not found.");
  if (request.user?.isAdmin && request.query.admin === "1") return job;
  if (job.team_id) {
    if (!(await getMembership(job.team_id, request.userId))) throw new HttpError(404, "Job not found.");
  } else if (job.user_id && job.user_id !== request.userId) {
    throw new HttpError(404, "Job not found.");
  }
  return job;
}

async function probe(path) {
  const info = await getMediaInfo(path).catch(() => null);
  const duration = Number(info?.format?.duration);
  if (!info || !Number.isFinite(duration) || duration <= 0) {
    throw new HttpError(400, "That file couldn't be read as video or audio. Please upload a different file.");
  }
  if (!info.streams.some((stream) => stream.codec_type === "audio")) {
    throw new HttpError(400, "This file has no audio track, so there is no speech to translate.");
  }
  const hasVideo = info.streams.some((stream) => stream.codec_type === "video" && stream.disposition?.attached_pic !== 1);
  return { duration, hasVideo };
}

/**
 * Decides how each target language is paid for: the monthly allowance first, then pay-as-you-go credits.
 * Throws a 402 with a machine-readable code so the app can offer trimming, a credit, or an upgrade.
 */
export function allocate(plan, targets, duration, { trimToFit }) {
  const minutes = duration === null ? 0 : duration / 60;
  let quotaLeft = Math.max(0, plan.maxVideosPerMonth - plan.videosThisMonth);
  const credits = [...plan.credits];
  const allocations = [];
  let trimSeconds = null;
  for (const target of targets) {
    const fitsPlan = minutes <= plan.maxVideoMinutes;
    if (quotaLeft > 0 && fitsPlan) {
      quotaLeft -= 1;
      allocations.push({ target, creditId: null });
      continue;
    }
    const creditIndex = credits.findIndex((credit) => credit.max_minutes >= Math.ceil(minutes));
    if (creditIndex !== -1) {
      allocations.push({ target, creditId: credits[creditIndex].id });
      credits.splice(creditIndex, 1);
      continue;
    }
    if (quotaLeft > 0 && !fitsPlan && trimToFit) {
      quotaLeft -= 1;
      trimSeconds = plan.maxVideoMinutes * 60;
      allocations.push({ target, creditId: null });
      continue;
    }
    if (!fitsPlan) {
      throw new HttpError(402, `This video is ${Math.ceil(minutes)} minutes long. Your plan allows videos up to ${plan.maxVideoMinutes} minutes.`, {
        code: "too_long", duration_seconds: duration, max_video_minutes: plan.maxVideoMinutes, can_trim: quotaLeft > 0,
      });
    }
    throw new HttpError(402, `You've used all ${plan.maxVideosPerMonth} videos in your plan this month${targets.length > 1 ? " for this many languages" : ""}. Buy a pay-as-you-go credit or upgrade to translate more.`, {
      code: "quota", videos_this_month: plan.videosThisMonth, max_videos_per_month: plan.maxVideosPerMonth,
    });
  }
  return { allocations, trimSeconds };
}

async function resolveSource(request) {
  if (request.file) {
    const release = () => rm(request.file.path, { force: true });
    return { path: request.file.path, originalname: request.file.originalname, mimetype: request.file.mimetype, release, releaseOnError: release };
  }
  if (request.body.upload_id) {
    try {
      const claimed = await claimUpload(request.body.upload_id, request.userId);
      if (!ALLOWED_MEDIA_TYPES.has(claimed.mimetype) && !/^(video|audio)\//.test(claimed.mimetype)) {
        await claimed.release();
        throw new HttpError(400, "Unsupported file type. Please upload a video or audio file.");
      }
      return claimed;
    } catch (error) {
      throw error instanceof HttpError ? error : new HttpError(400, error.message);
    }
  }
  return null;
}

router.post("/jobs", authenticate, blockDuringMaintenance, workspace, jobLimiter, requireLivePipeline, upload.single("file"), asyncRoute(async (request, response) => {
  const source = await resolveSource(request);
  const sourceUrl = String(request.body.source_url || "").trim();
  let succeeded = false;
  try {
    if (!source && !sourceUrl) throw new HttpError(400, "Choose a video to upload or paste a link.");
    if (sourceUrl) {
      try {
        classifyImportUrl(sourceUrl);
      } catch (error) {
        throw new HttpError(400, error.message);
      }
    }

    const sourceLanguage = String(request.body.source_language || "");
    const targets = [...new Set(list(request.body.target_languages).concat(list(request.body.target_language)))];
    if (!getLanguage(sourceLanguage) || !targets.length || targets.some((code) => !getLanguage(code) || code === "auto")) {
      throw new HttpError(400, "Choose a source and target language from the supported list.");
    }
    if (targets.includes(sourceLanguage)) throw new HttpError(400, "Choose a different target language.");
    if (!config.elevenlabsApiKey) {
      throw new HttpError(503, "Speaker-matched dubbing requires ELEVENLABS_API_KEY in backend/.env. Add it and restart the backend.");
    }

    const teamId = request.workspace.teamId;
    const plan = await planFor({ userId: request.userId, teamId });
    if (targets.length > plan.plan.max_targets) {
      throw new HttpError(402, `Your ${plan.plan.name} plan dubs into up to ${plan.plan.max_targets} language${plan.plan.max_targets === 1 ? "" : "s"} per upload.`, { code: "targets", max_targets: plan.plan.max_targets });
    }

    const options = {
      review: bool(request.body.review),
      keep_background: request.body.keep_background === undefined ? true : bool(request.body.keep_background),
      multi_speaker: bool(request.body.multi_speaker),
      tone: TONES[request.body.tone] ? request.body.tone : "natural",
      captions: CAPTION_STYLES[request.body.captions] ? request.body.captions : null,
      formats: list(request.body.formats).filter((aspect) => ASPECTS[aspect]).slice(0, 4),
      lip_sync: bool(request.body.lip_sync),
      trim_to_fit: bool(request.body.trim_to_fit),
      watermark: plan.plan.watermark,
    };
    const permissions = plan.plan.permissions || {};
    // Each option must be switched on globally (Admin → Settings) and included in the user's plan (Admin → Plans).
    const check = (requested, globalFlag, permission, label) => {
      if (!requested) return;
      if (!config[globalFlag]) throw new HttpError(403, `${label} is currently turned off.`, { code: "feature_disabled", feature: permission });
      if (permission && permissions[permission] === false) throw new HttpError(402, `${label} isn't included in your ${plan.plan.name} plan. Upgrade to use it.`, { code: "feature", feature: permission });
    };
    check(Boolean(sourceUrl), "featureLinkImport", "link_import", "Importing from a link");
    check(options.review, "featureReview", "review", "Reviewing before dubbing");
    check(options.multi_speaker, "featureMultiSpeaker", "multi_speaker", "Multi-speaker dubbing");
    check(Boolean(options.captions), "featureCaptions", "captions", "Burned-in captions");
    check(options.formats.length > 0, "featureFormats", "formats", "Extra formats");
    if (options.keep_background && (!config.featureBackground || permissions.keep_background === false)) options.keep_background = false;
    if (options.lip_sync) {
      check(true, "featureLipSync", null, "Lip-sync");
      if (!plan.plan.lip_sync) throw new HttpError(402, `Lip-sync isn't included in your ${plan.plan.name} plan.`, { code: "feature", feature: "lip_sync" });
      const reason = lipSyncUnavailableReason();
      if (reason) throw new HttpError(503, reason);
    }

    const voiceMode = request.body.voice_mode || (request.body.voice_clone === "false" ? "standard" : "clone");
    let voiceClone = voiceMode !== "standard" && plan.plan.voice_clone;
    if (voiceMode === "saved") {
      const voice = await one("SELECT id FROM voices WHERE id = $1 AND user_id = $2", [Number(request.body.voice_id), request.userId]);
      if (!voice) throw new HttpError(400, "Choose one of your saved voices.");
      check(true, "featureSavedVoices", null, "Saved voices");
      if (!plan.plan.saved_voices) throw new HttpError(402, `Saved voices aren't included in your ${plan.plan.name} plan.`, { code: "feature", feature: "saved_voices" });
      options.voice_id = Number(voice.id);
      voiceClone = true;
    }

    let duration = null;
    let mediaType = "video";
    if (source) {
      const scan = await scanFile(source.path);
      if (!scan.clean) throw new HttpError(400, "This file was flagged by our virus scanner and can't be processed.");
      const probed = await probe(source.path);
      duration = probed.duration;
      mediaType = probed.hasVideo ? "video" : "audio";
      if (mediaType === "audio" && permissions.audio_only === false) {
        throw new HttpError(402, `Audio-only dubbing isn't included in your ${plan.plan.name} plan.`, { code: "feature", feature: "audio_only" });
      }
    }

    const { allocations, trimSeconds } = allocate(plan, targets, duration, { trimToFit: options.trim_to_fit });
    if (trimSeconds) options.trim_seconds = trimSeconds;

    let inputPath = "";
    if (source) {
      inputPath = `uploads/${randomUUID()}${extname(source.originalname).toLowerCase() || (mediaType === "audio" ? ".mp3" : ".mp4")}`;
      await uploadFile(inputPath, source.path, source.mimetype);
    }

    const batchId = targets.length > 1 ? randomUUID() : null;
    const created = [];
    let leaderId = null;
    for (const { target, creditId } of allocations) {
      const job = await createJob({
        user_id: request.userId,
        team_id: teamId,
        batch_id: batchId,
        depends_on: leaderId,
        source_language: sourceLanguage,
        target_language: target,
        voice_clone: voiceClone,
        input_storage_path: inputPath,
        source_url: sourceUrl || null,
        media_type: mediaType,
        options_json: options,
        original_filename: source ? source.originalname.split(/[\\/]/).pop() : null,
        priority: plan.plan.priority,
        current_step: sourceUrl ? "importing" : "queued",
      });
      if (creditId && !(await consumeCredit(creditId, job.id))) {
        await updateJob(job.id, { status: "failed", error_message: "The pay-as-you-go credit was already used. Please try again." });
      } else if (creditId) {
        await updateJob(job.id, { credit_id: creditId });
      }
      // For imports every target downloads independently; for uploads the first job transcribes for the rest.
      if (!leaderId && !sourceUrl) leaderId = job.id;
      created.push(await getJob(job.id));
    }
    const outputs = await Promise.all(created.map((job) => jobOutput(job)));
    succeeded = true;
    response.status(201).json({ ...outputs[0], jobs: outputs });
  } finally {
    // A resumable upload survives a rejected request (e.g. "too long"), so the creator can trim or buy a credit
    // without uploading again; unclaimed uploads expire after 24 hours.
    if (succeeded) await source?.release?.();
    else await source?.releaseOnError?.();
  }
}));

router.get("/jobs", authenticate, workspace, asyncRoute(async (request, response) => {
  const requestedLimit = Number.parseInt(String(request.query.limit ?? ""), 10);
  const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 10;
  const offset = Math.max(0, Number.parseInt(String(request.query.offset ?? "0"), 10) || 0);
  const jobs = await listJobs(request.userId, limit, { teamId: request.workspace.teamId, offset });
  const detail = request.query.detail === "1";
  response.json(await Promise.all(jobs.map((job) => jobOutput(job, { detail }))));
}));

router.get("/jobs/:jobId", authenticate, asyncRoute(async (request, response) => {
  const job = await loadAccessibleJob(request);
  const output = await jobOutput(job);
  if (job.batch_id) {
    const { listBatchJobs } = await import("../database.js");
    output.batch = (await listBatchJobs(job.batch_id)).map((item) => ({ id: item.id, target_language: item.target_language, status: item.status }));
  }
  response.json(output);
}));

/** Server-sent events: pushes the job every time it changes, so the progress page updates instantly. */
router.get("/jobs/:jobId/events", authenticate, asyncRoute(async (request, response) => {
  let job = await loadAccessibleJob(request);
  response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  let last = "";
  let closed = false;
  const send = async () => {
    const payload = JSON.stringify(await jobOutput(job, { detail: ["done", "awaiting_review", "failed"].includes(job.status) }));
    const fingerprint = `${job.status}|${job.current_step}|${job.updated_at}`;
    if (fingerprint !== last) {
      last = fingerprint;
      response.write(`event: job\ndata: ${payload}\n\n`);
    }
  };
  await send();
  const timer = setInterval(async () => {
    if (closed) return;
    try {
      job = await getJob(job.id);
      if (!job) {
        response.end();
        return;
      }
      await send();
      response.write(": keep-alive\n\n");
      if (["done", "failed"].includes(job.status)) {
        clearInterval(timer);
        response.end();
      }
    } catch (error) {
      logger.warn({ err: error }, "SSE update failed");
    }
  }, 1500);
  request.on("close", () => {
    closed = true;
    clearInterval(timer);
  });
}));

function editable(job) {
  if (!job.translated_segments_json?.length) throw new HttpError(409, "This project has no translation to edit yet.");
  if (job.status === "processing" || job.status === "queued") throw new HttpError(409, "Wait for processing to finish before editing.");
  if (job.files_expired_at) throw new HttpError(409, "This project's files have expired, so it can't be re-dubbed.");
}

/** Saves edits to transcript and/or translation lines: body { segments: [{ index, text?, source_text? }] }. */
router.patch("/jobs/:jobId/segments", authenticate, asyncRoute(async (request, response) => {
  const job = await loadAccessibleJob(request);
  editable(job);
  const edits = Array.isArray(request.body?.segments) ? request.body.segments : [];
  const translated = [...job.translated_segments_json];
  const transcript = [...job.transcript_json];
  for (const edit of edits) {
    const index = Number(edit.index);
    if (!Number.isInteger(index) || index < 0 || index >= translated.length) throw new HttpError(400, `Line ${edit.index} doesn't exist.`);
    if (typeof edit.text === "string") {
      if (!edit.text.trim()) throw new HttpError(400, `Line ${index + 1} can't be empty.`);
      translated[index] = { ...translated[index], text: edit.text.trim().slice(0, 2000) };
    }
    if (typeof edit.source_text === "string" && edit.source_text.trim()) {
      transcript[index] = { ...transcript[index], text: edit.source_text.trim().slice(0, 2000) };
    }
  }
  response.json(await jobOutput(await updateJob(job.id, { translated_segments_json: translated, transcript_json: transcript })));
}));

router.post("/jobs/:jobId/segments/:index/retranslate", authenticate, asyncRoute(async (request, response) => {
  const job = await loadAccessibleJob(request);
  editable(job);
  const index = Number(request.params.index);
  if (!Number.isInteger(index) || index < 0 || index >= job.transcript_json.length) throw new HttpError(400, "That line doesn't exist.");
  const text = await translateLine(job.transcript_json, index, job.target_language, { glossary: await listGlossary(job.user_id), tone: job.options_json.tone });
  if (!text) throw new HttpError(502, "The translator returned nothing. Try again.");
  const translated = [...job.translated_segments_json];
  translated[index] = { ...translated[index], text };
  await updateJob(job.id, { translated_segments_json: translated });
  response.json({ index, text });
}));

/** Continues a job paused for review: the dub is generated with the edited translation. */
router.post("/jobs/:jobId/approve", authenticate, asyncRoute(async (request, response) => {
  const job = await loadAccessibleJob(request);
  if (job.status !== "awaiting_review") throw new HttpError(409, "This project isn't waiting for review.");
  response.json(await jobOutput(await updateJob(job.id, { review_state: "approved", status: "queued", current_step: "queued", attempts: 0 })));
}));

/** Regenerates the voice after edits. Unchanged lines reuse their existing audio, so only edited lines cost anything. */
router.post("/jobs/:jobId/redub", authenticate, asyncRoute(async (request, response) => {
  const job = await loadAccessibleJob(request);
  editable(job);
  if (job.status !== "done") throw new HttpError(409, "Only finished projects can be re-dubbed.");
  if (job.redub_count >= config.maxRedubs) throw new HttpError(409, `This project has reached the limit of ${config.maxRedubs} re-dubs.`);
  const options = { ...job.options_json };
  if (request.body?.captions !== undefined) options.captions = CAPTION_STYLES[request.body.captions] ? request.body.captions : null;
  if (request.body?.formats !== undefined) options.formats = list(request.body.formats).filter((aspect) => ASPECTS[aspect]).slice(0, 4);
  if (request.body?.keep_background !== undefined) options.keep_background = bool(request.body.keep_background);
  response.json(await jobOutput(await updateJob(job.id, {
    status: "queued", current_step: "queued", review_state: "approved", redub_count: job.redub_count + 1, attempts: 0, error_message: null, options_json: options,
  })));
}));

/** Resumes a failed job from its last completed step (the transcript and translation are kept). */
router.post("/jobs/:jobId/retry", authenticate, asyncRoute(async (request, response) => {
  const job = await loadAccessibleJob(request);
  if (job.status !== "failed") throw new HttpError(409, "Only failed projects can be retried.");
  if (job.files_expired_at) throw new HttpError(409, "The original upload has expired. Please upload the video again.");
  if (!job.input_storage_path && !job.source_url) throw new HttpError(409, "The original upload is missing. Please upload the video again.");
  const options = request.body?.trim_to_fit ? { ...job.options_json, trim_to_fit: true } : job.options_json;
  response.json(await jobOutput(await updateJob(job.id, { status: "queued", current_step: "queued", attempts: 0, error_message: null, options_json: options })));
}));

router.delete("/jobs/:jobId", authenticate, asyncRoute(async (request, response) => {
  const job = await loadAccessibleJob(request);
  if (job.status === "processing") throw new HttpError(409, "This project is being processed right now. Delete it once it finishes.");
  await purgeJob(job);
  response.status(204).end();
}));

async function requirePlanPermission(request, job, globalFlag, permission, label) {
  if (!config[globalFlag]) throw new HttpError(403, `${label} is currently turned off.`, { code: "feature_disabled" });
  const plan = await planFor({ userId: request.userId, teamId: job.team_id });
  if (plan.plan.permissions?.[permission] === false) throw new HttpError(402, `${label} isn't included in your ${plan.plan.name} plan.`, { code: "feature", feature: permission });
}

/** Turns the public watch page on or off. Watch pages sign fresh video links on every visit, so they never expire. */
router.post("/jobs/:jobId/share", authenticate, asyncRoute(async (request, response) => {
  const job = await loadAccessibleJob(request);
  if (job.status !== "done") throw new HttpError(409, "Only finished projects can be shared.");
  if (request.body?.enabled !== false) await requirePlanPermission(request, job, "featurePublicShare", "public_share", "Public watch pages");
  const enabled = request.body?.enabled !== false;
  const slug = enabled ? job.share_slug || randomBytes(8).toString("base64url") : null;
  response.json(await jobOutput(await updateJob(job.id, { share_slug: slug, share_original: Boolean(request.body?.include_original ?? true) })));
}));

router.post("/jobs/:jobId/publish/youtube", authenticate, asyncRoute(async (request, response) => {
  const job = await loadAccessibleJob(request);
  if (job.status !== "done") throw new HttpError(409, "Only finished projects can be published.");
  if (job.media_type === "audio") throw new HttpError(400, "Audio-only projects can't be published to YouTube.");
  await requirePlanPermission(request, job, "featureYoutube", "youtube", "Publishing to YouTube");
  const outputs = job.outputs_json || [];
  const wanted = String(request.body?.output || "video");
  const output = outputs.find((item) => (wanted.startsWith("format:") ? item.kind === "format" && item.aspect === wanted.slice(7) : item.kind === wanted)) || outputs.find((item) => item.kind === "video");
  if (!output) throw new HttpError(409, "No video is available to publish.");
  const metadata = job.metadata_json || {};
  const details = {
    title: request.body?.title || metadata.title || job.original_filename || "ReelLingo dub",
    description: request.body?.description ?? `${metadata.description || ""}\n\n${(metadata.hashtags || []).join(" ")}`.trim(),
    tags: Array.isArray(request.body?.tags) ? request.body.tags : metadata.hashtags || [],
    privacy: request.body?.privacy || "private",
    language: job.target_language,
  };
  await updateJob(job.id, { options_json: { ...job.options_json, youtube: { status: "uploading", started_at: new Date().toISOString() } } });
  const userId = request.userId;
  void (async () => {
    let youtube;
    try {
      const result = await publishToYoutube(userId, output.path, details);
      youtube = { status: "published", video_id: result.videoId, url: result.url, privacy: details.privacy };
    } catch (error) {
      youtube = { status: "failed", error: error.message };
    }
    const latest = await getJob(job.id);
    await updateJob(job.id, { options_json: { ...latest.options_json, youtube } });
  })();
  response.status(202).json(await jobOutput(await getJob(job.id)));
}));

router.get("/jobs/:jobId/costs", authenticate, asyncRoute(async (request, response) => {
  if (!request.user.isAdmin) throw new HttpError(403, "Admin access required.");
  const job = await getJob(Number(request.params.jobId));
  if (!job) throw new HttpError(404, "Job not found.");
  response.json(await jobCosts(job.id));
}));

export default router;
