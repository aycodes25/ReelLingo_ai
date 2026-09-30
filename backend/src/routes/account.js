import express from "express";
import multer from "multer";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyReferral, getProfile, listGlossary, planFor, referralStats, updateProfile } from "../accounts.js";
import { createApiKey, listApiKeys, revokeApiKey } from "../auth.js";
import { config } from "../config.js";
import { many, one, query } from "../db.js";
import { cloneFromSample, createSpeakerSample, deleteVoice } from "../dubbing.js";
import { asyncRoute, authenticate, HttpError, toIsoTimestamp, workspace } from "../http.js";
import { getLanguage } from "../languages.js";
import { run } from "../media.js";
import { emailConfigured, whatsappConfigured } from "../notify.js";
import { downloadFile } from "../storage.js";
import { listTeamsFor } from "../teams.js";
import { completeYoutubeConnect, disconnectYoutube, youtubeConnectUrl, youtubeStatus } from "../youtube.js";
import { loadAccessibleJob } from "./jobs.js";

const router = express.Router();
const sampleUpload = multer({ dest: join(tmpdir(), "reellingo-uploads"), limits: { fileSize: 50 * 1024 * 1024 } });

function usagePayload(plan) {
  return {
    tier: plan.tier,
    plan: plan.plan,
    subscription: plan.subscription,
    videos_this_month: plan.videosThisMonth,
    minutes_this_month: plan.minutesThisMonth,
    max_videos_per_month: plan.maxVideosPerMonth,
    max_video_minutes: plan.maxVideoMinutes,
    credits: plan.credits,
  };
}

router.get("/me", authenticate, asyncRoute(async (request, response) => {
  const [profile, plan, teams, referrals] = await Promise.all([
    getProfile(request.userId),
    planFor({ userId: request.userId }),
    listTeamsFor(request.user),
    referralStats(request.userId),
  ]);
  response.json({
    ...profile,
    email: request.user.email || profile.email,
    is_admin: request.user.isAdmin,
    plan: usagePayload(plan),
    teams,
    referral: { code: profile.referral_code, link: `${config.frontendUrl}/signup?ref=${profile.referral_code}`, ...referrals, bonus_minutes: config.referralBonusMinutes, bonus_videos: config.referralBonusVideos },
    channels: { email: emailConfigured(), whatsapp: whatsappConfigured() },
  });
}));

router.put("/me", authenticate, asyncRoute(async (request, response) => {
  const body = request.body || {};
  const phone = body.phone === undefined ? undefined : String(body.phone).replace(/[^\d+]/g, "").slice(0, 20);
  if (phone && !/^\+?\d{8,15}$/.test(phone)) throw new HttpError(400, "Enter your WhatsApp number in international format, e.g. +2348012345678.");
  const profile = await updateProfile(request.userId, {
    name: body.name === undefined ? undefined : String(body.name).trim().slice(0, 80),
    creator_type: body.creator_type === undefined ? undefined : String(body.creator_type).slice(0, 60),
    phone,
    notify_email: body.notify_email === undefined ? undefined : Boolean(body.notify_email),
    notify_whatsapp: body.notify_whatsapp === undefined ? undefined : Boolean(body.notify_whatsapp),
  });
  if (profile.notify_whatsapp && !profile.phone) throw new HttpError(400, "Add a WhatsApp number to get WhatsApp notifications.");
  response.json(profile);
}));

router.post("/me/referral", authenticate, asyncRoute(async (request, response) => {
  const result = await applyReferral(request.userId, request.body?.code);
  response.status(result.applied ? 200 : 400).json(result.applied ? result : { detail: result.reason });
}));

router.get("/usage", authenticate, workspace, asyncRoute(async (request, response) => {
  response.json(usagePayload(await planFor({ userId: request.userId, teamId: request.workspace.teamId })));
}));

// ---------- Glossary ----------
router.get("/glossary", authenticate, asyncRoute(async (request, response) => {
  response.json(await listGlossary(request.userId));
}));

router.post("/glossary", authenticate, asyncRoute(async (request, response) => {
  const term = String(request.body?.term || "").trim().slice(0, 120);
  if (!term) throw new HttpError(400, "Enter the word or name to protect.");
  const target = String(request.body?.target_language || "");
  if (target && !getLanguage(target)) throw new HttpError(400, "Unknown target language.");
  const count = await one("SELECT COUNT(*) AS count FROM glossary_terms WHERE user_id = $1", [request.userId]);
  if (Number(count?.count || 0) >= 500) throw new HttpError(400, "Glossaries are limited to 500 terms.");
  await query(
    "INSERT INTO glossary_terms (user_id, term, translation, target_language, note) VALUES ($1, $2, $3, $4, $5)",
    [request.userId, term, String(request.body?.translation || "").trim().slice(0, 200) || null, target || null, String(request.body?.note || "").slice(0, 200) || null],
  );
  response.status(201).json(await listGlossary(request.userId));
}));

router.put("/glossary/:id", authenticate, asyncRoute(async (request, response) => {
  const term = String(request.body?.term || "").trim().slice(0, 120);
  if (!term) throw new HttpError(400, "Enter the word or name to protect.");
  await query(
    "UPDATE glossary_terms SET term = $1, translation = $2, target_language = $3, note = $4 WHERE id = $5 AND user_id = $6",
    [term, String(request.body?.translation || "").trim() || null, String(request.body?.target_language || "") || null, String(request.body?.note || "") || null, Number(request.params.id), request.userId],
  );
  response.json(await listGlossary(request.userId));
}));

router.delete("/glossary/:id", authenticate, asyncRoute(async (request, response) => {
  await query("DELETE FROM glossary_terms WHERE id = $1 AND user_id = $2", [Number(request.params.id), request.userId]);
  response.json(await listGlossary(request.userId));
}));

// ---------- Saved voices ----------
async function listVoices(userId) {
  return (await many("SELECT id, name, created_at, last_used_at FROM voices WHERE user_id = $1 ORDER BY id DESC", [userId]))
    .map((row) => ({ ...row, id: Number(row.id), created_at: toIsoTimestamp(row.created_at), last_used_at: toIsoTimestamp(row.last_used_at) }));
}

router.get("/voices", authenticate, asyncRoute(async (request, response) => {
  const plan = await planFor({ userId: request.userId });
  response.json({ voices: await listVoices(request.userId), limit: plan.plan.saved_voices, available: Boolean(config.elevenlabsApiKey) });
}));

/**
 * Saves a creator's voice for reuse, so it's cloned once instead of on every video.
 * Source: a speaker from a finished project (`job_id`, `speaker`) or an uploaded sample file. Explicit consent is required.
 */
router.post("/voices", authenticate, sampleUpload.single("sample"), asyncRoute(async (request, response) => {
  const workdir = await mkdtemp(join(tmpdir(), "reellingo-voice-"));
  try {
    if (!config.elevenlabsApiKey) throw new HttpError(503, "Saved voices need ELEVENLABS_API_KEY in backend/.env.");
    if (!(request.body?.consent === true || request.body?.consent === "true")) {
      throw new HttpError(400, "Confirm that this is your voice, or that you have the speaker's permission, before saving it.");
    }
    const plan = await planFor({ userId: request.userId });
    const existing = await listVoices(request.userId);
    if (existing.length >= plan.plan.saved_voices) {
      throw new HttpError(402, plan.plan.saved_voices ? `Your plan can keep ${plan.plan.saved_voices} saved voice${plan.plan.saved_voices === 1 ? "" : "s"}. Delete one first.` : "Saved voices are included in the Creator and Studio plans.", { code: "feature", feature: "saved_voices" });
    }
    const name = String(request.body?.name || "My voice").trim().slice(0, 60);
    const samplePath = join(workdir, "sample.mp3");
    if (request.file) {
      await run("ffmpeg", ["-y", "-i", request.file.path, "-t", "180", "-ac", "1", "-ar", "44100", "-c:a", "libmp3lame", "-b:a", "128k", samplePath]);
    } else {
      request.params.jobId = request.body?.job_id;
      const job = await loadAccessibleJob(request);
      if (!job.transcript_json?.length || !job.input_storage_path || job.files_expired_at) throw new HttpError(409, "That project has no usable audio anymore.");
      const input = await downloadFile(job.input_storage_path, join(workdir, "input"));
      const audio = join(workdir, "speaker.wav");
      await run("ffmpeg", ["-y", "-i", input, "-vn", "-ac", "1", "-ar", "44100", audio]);
      const speaker = request.body?.speaker;
      const segments = speaker ? job.transcript_json.filter((segment) => (segment.speaker || "speaker_0") === speaker) : job.transcript_json;
      if (!segments.length) throw new HttpError(400, "That speaker doesn't appear in the project.");
      await createSpeakerSample(audio, segments, samplePath);
    }
    const providerVoiceId = await cloneFromSample(samplePath, `ReelLingo saved voice: ${name}`, `Saved by ReelLingo user ${request.userId} with consent.`);
    await query("INSERT INTO voices (user_id, name, provider, provider_voice_id) VALUES ($1, $2, 'elevenlabs', $3)", [request.userId, name, providerVoiceId]);
    response.status(201).json({ voices: await listVoices(request.userId), limit: plan.plan.saved_voices });
  } finally {
    if (request.file) await rm(request.file.path, { force: true });
    await rm(workdir, { recursive: true, force: true });
  }
}));

router.delete("/voices/:id", authenticate, asyncRoute(async (request, response) => {
  const voice = await one("SELECT * FROM voices WHERE id = $1 AND user_id = $2", [Number(request.params.id), request.userId]);
  if (!voice) throw new HttpError(404, "Voice not found.");
  await deleteVoice(voice.provider_voice_id);
  await query("DELETE FROM voices WHERE id = $1", [voice.id]);
  response.json({ voices: await listVoices(request.userId) });
}));

// ---------- API keys ----------
router.get("/api-keys", authenticate, asyncRoute(async (request, response) => {
  const plan = await planFor({ userId: request.userId });
  response.json({ keys: await listApiKeys(request.userId), available: plan.plan.api_access });
}));

router.post("/api-keys", authenticate, asyncRoute(async (request, response) => {
  if (request.user.viaApiKey) throw new HttpError(403, "API keys can't create other API keys.");
  const plan = await planFor({ userId: request.userId });
  if (!plan.plan.api_access) throw new HttpError(402, "API access is included in the Studio plan.", { code: "feature", feature: "api_access" });
  if ((await listApiKeys(request.userId)).length >= 10) throw new HttpError(400, "You can have up to 10 active API keys.");
  response.status(201).json(await createApiKey(request.userId, request.body?.name));
}));

router.delete("/api-keys/:id", authenticate, asyncRoute(async (request, response) => {
  if (!(await revokeApiKey(request.userId, Number(request.params.id)))) throw new HttpError(404, "API key not found.");
  response.status(204).end();
}));

// ---------- Integrations ----------
router.get("/integrations", authenticate, asyncRoute(async (request, response) => {
  response.json({ youtube: await youtubeStatus(request.userId) });
}));

router.post("/integrations/youtube/connect", authenticate, asyncRoute(async (request, response) => {
  try {
    response.json({ url: youtubeConnectUrl(request.userId) });
  } catch (error) {
    throw new HttpError(503, error.message);
  }
}));

router.get("/integrations/youtube/callback", asyncRoute(async (request, response) => {
  if (request.query.error) {
    response.redirect(`${config.frontendUrl}/settings?youtube=error&message=${encodeURIComponent(String(request.query.error))}#integrations`);
    return;
  }
  try {
    await completeYoutubeConnect(String(request.query.code || ""), String(request.query.state || ""));
    response.redirect(`${config.frontendUrl}/settings?youtube=connected#integrations`);
  } catch (error) {
    response.redirect(`${config.frontendUrl}/settings?youtube=error&message=${encodeURIComponent(error.message)}#integrations`);
  }
}));

router.delete("/integrations/youtube", authenticate, asyncRoute(async (request, response) => {
  await disconnectYoutube(request.userId);
  response.status(204).end();
}));

export default router;
