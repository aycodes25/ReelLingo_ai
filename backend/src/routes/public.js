import express from "express";
import { config } from "../config.js";
import { getJobBySlug } from "../database.js";
import { asyncRoute, HttpError, toIsoTimestamp } from "../http.js";
import { getLanguage, languages } from "../languages.js";
import { getSignedUrl } from "../storage.js";

const router = express.Router();

router.get("/languages", (_request, response) => response.json(languages));

/** Public watch page data. Links are signed on every request, so a shared page keeps working indefinitely. */
router.get("/public/watch/:slug", asyncRoute(async (request, response) => {
  const job = config.featurePublicShare ? await getJobBySlug(String(request.params.slug)) : null;
  if (!job || job.status !== "done" || job.files_expired_at) throw new HttpError(404, "This video isn't available.");
  const outputs = job.outputs_json || [];
  const main = outputs.find((output) => output.kind === "lipsync") || outputs.find((output) => output.kind === "video" || output.kind === "audio");
  const vtt = outputs.find((output) => output.format === "vtt");
  const expiry = 6 * 3600;
  const title = job.metadata_json?.title || (job.original_filename || `Project ${job.id}`).replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");
  response.set("Cache-Control", "private, max-age=300");
  response.json({
    slug: job.share_slug,
    title,
    description: job.metadata_json?.description || "",
    hashtags: job.metadata_json?.hashtags || [],
    media_type: job.media_type || "video",
    source_language: job.detected_languages_json?.map((code) => getLanguage(code)?.name || code).join(" + ") || getLanguage(job.source_language)?.name || job.source_language,
    target_language: getLanguage(job.target_language)?.name || job.target_language,
    video_url: main ? await getSignedUrl(main.path, expiry) : null,
    original_url: job.share_original && job.input_storage_path ? await getSignedUrl(job.input_storage_path, expiry) : null,
    captions_url: vtt ? await getSignedUrl(vtt.path, expiry) : null,
    duration_seconds: job.duration_seconds,
    created_at: toIsoTimestamp(job.created_at),
    watermark: Boolean(job.options_json?.watermark),
    signup_url: `${config.frontendUrl}/signup`,
  });
}));

export default router;
