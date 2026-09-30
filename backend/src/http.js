import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import { ensureProfile, planFor } from "./accounts.js";
import { getCurrentUser } from "./auth.js";
import { config, isAdminEmail } from "./config.js";
import { getLanguage } from "./languages.js";
import { getSignedUrl } from "./storage.js";
import { getMembership } from "./teams.js";

export function asyncRoute(handler) {
  return (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next);
}

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

/** Accepts a Supabase session token, or an API key as `Bearer rlk_…` / `X-API-Key: rlk_…`. */
export const authenticate = asyncRoute(async (request, response, next) => {
  const user = await getCurrentUser(request.headers.authorization, request.headers["x-api-key"]);
  if (!user) {
    response.status(401).json({ detail: "Sign in to continue." });
    return;
  }
  request.user = { ...user, isAdmin: isAdminEmail(user.email) };
  request.userId = user.id;
  const profile = await ensureProfile(user.id, user.email);
  if (!user.email && profile?.email) request.user.email = profile.email;
  if (user.viaApiKey) {
    const plan = await planFor({ userId: user.id });
    if (!plan.plan.api_access) {
      response.status(403).json({ detail: `API access is included in the Studio plan. Your plan is ${plan.plan.name}.` });
      return;
    }
  }
  next();
});

/** Resolves which workspace a request acts in: personal (default) or a team named by the X-Workspace header. */
export const workspace = asyncRoute(async (request, response, next) => {
  const raw = request.headers["x-workspace"] || request.query.workspace;
  if (!raw || raw === "personal") {
    request.workspace = { teamId: null, role: "owner" };
    next();
    return;
  }
  const teamId = Number(raw);
  const membership = Number.isInteger(teamId) ? await getMembership(teamId, request.userId) : null;
  if (!membership) {
    response.status(403).json({ detail: "You're not a member of that team workspace." });
    return;
  }
  request.workspace = { teamId, role: membership.role };
  next();
});

export function requireAdmin(request, response, next) {
  if (!request.user?.isAdmin) {
    response.status(403).json({ detail: "Admin access required." });
    return;
  }
  next();
}

export function requireLivePipeline(_request, response, next) {
  if (config.mockMode || !config.openaiApiKey) {
    response.status(503).json({ detail: "Live translation is unavailable. Add OPENAI_API_KEY to backend/.env and restart the backend." });
    return;
  }
  next();
}

const limiterDefaults = {
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (_request, response, _next, options) => response.status(options.statusCode).json({ detail: "Too many requests. Please slow down and try again shortly." }),
};

export const generalLimiter = rateLimit({ ...limiterDefaults, windowMs: 15 * 60 * 1000, limit: config.rateLimitPerWindow, skip: (request) => request.path === "/health" || request.path.startsWith("/files/") || request.path.startsWith("/uploads/") });
export const authLimiter = rateLimit({ ...limiterDefaults, windowMs: 15 * 60 * 1000, limit: config.authRateLimitPerWindow });
export const jobLimiter = rateLimit({
  ...limiterDefaults,
  windowMs: 60 * 60 * 1000,
  limit: config.jobRateLimitPerHour,
  keyGenerator: (request) => request.userId || ipKeyGenerator(request.ip),
});

// SQLite stores CURRENT_TIMESTAMP as "YYYY-MM-DD HH:MM:SS" in UTC without a zone marker.
export function toIsoTimestamp(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const text = String(value);
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text) ? `${text.replace(" ", "T")}Z` : text;
}

function downloadName(job, output) {
  const base = (job.original_filename || `project-${job.id}`).replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "_").slice(0, 60);
  const extension = output.path.split(".").pop();
  const suffix = output.kind === "format" ? `.${output.aspect.replace(":", "x")}` : output.kind === "captioned" ? ".captions" : output.kind === "lipsync" ? ".lipsync" : "";
  return `${base}.${job.target_language}${suffix}.${extension}`;
}

/** The API representation of a job. `detail` adds signed URLs for every output (skipped in list views). */
export async function jobOutput(job, { detail = true } = {}) {
  const outputs = Array.isArray(job.outputs_json) ? job.outputs_json : [];
  const main = outputs.find((output) => output.kind === "video" || output.kind === "audio") || (job.output_video_path ? { kind: "video", path: job.output_video_path } : null);
  const srt = outputs.find((output) => output.format === "srt") || (job.output_srt_path ? { kind: "subtitles", format: "srt", path: job.output_srt_path } : null);
  const sign = (output, download) => (output ? getSignedUrl(output.path, 3600, download ? downloadName(job, output) : false) : null);
  const options = job.options_json || {};
  return {
    id: Number(job.id),
    status: job.status,
    current_step: job.current_step,
    source_language: job.source_language,
    target_language: job.target_language,
    voice_clone: Boolean(job.voice_clone),
    media_type: job.media_type || "video",
    output_video_url: await sign(main, false),
    output_video_download_url: await sign(main, true),
    output_srt_url: await sign(srt, false),
    output_srt_download_url: await sign(srt, true),
    outputs: detail ? await Promise.all(outputs.map(async (output) => ({
      kind: output.kind, format: output.format || null, aspect: output.aspect || null, label: output.label,
      url: await sign(output, false), download_url: await sign(output, true),
    }))) : [],
    input_video_url: detail && job.input_storage_path && !job.files_expired_at && ["done", "awaiting_review", "failed"].includes(job.status) ? await getSignedUrl(job.input_storage_path) : null,
    transcript: detail ? job.transcript_json || null : null,
    translated_segments: detail ? job.translated_segments_json || null : null,
    has_transcript: Boolean(job.transcript_json?.length),
    detected_languages: (job.detected_languages_json || []).map((code) => ({ code, name: getLanguage(code)?.name || code })),
    speakers: job.speakers_json || null,
    metadata: job.metadata_json || null,
    options: {
      review: Boolean(options.review), keep_background: options.keep_background !== false, multi_speaker: Boolean(options.multi_speaker),
      tone: options.tone || "natural", captions: options.captions || null, formats: options.formats || [], lip_sync: Boolean(options.lip_sync),
      watermark: Boolean(options.watermark), voice_id: options.voice_id || null, trim_seconds: options.trim_seconds || null,
    },
    review_state: job.review_state || null,
    redub_count: Number(job.redub_count || 0),
    max_redubs: config.maxRedubs,
    batch_id: job.batch_id || null,
    team_id: job.team_id || null,
    share_slug: job.share_slug || null,
    share_url: job.share_slug ? `${config.frontendUrl}/watch/${job.share_slug}` : null,
    youtube: options.youtube || null,
    duration_seconds: job.duration_seconds === null || job.duration_seconds === undefined ? null : Number(job.duration_seconds),
    error_message: job.error_message,
    original_filename: job.original_filename || null,
    source_url: job.source_url || null,
    processing_note: job.processing_note || null,
    files_expired: Boolean(job.files_expired_at),
    attempts: Number(job.attempts || 0),
    created_at: toIsoTimestamp(job.created_at),
    completed_at: toIsoTimestamp(job.completed_at),
    demo_mode: config.mockMode,
  };
}
