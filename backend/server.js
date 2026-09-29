import cors from "cors";
import express from "express";
import multer from "multer";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./src/config.js";
import { getCurrentUserId, login, logout, signup } from "./src/auth.js";
import { closeDatabase, createJob, failInterruptedJobs, getJob, getMonthlyUsage, getSubscription, initializeDatabase, listJobs } from "./src/database.js";
import { getLanguage, languages } from "./src/languages.js";
import { runPipeline } from "./src/pipeline.js";
import { getSignedUrl, uploadFile } from "./src/storage.js";

const allowedContentTypes = new Set(["video/mp4", "video/quicktime", "video/x-msvideo"]);
const uploadDirectory = join(tmpdir(), "reellingo-uploads");
await mkdir(uploadDirectory, { recursive: true });

const upload = multer({
  dest: uploadDirectory,
  limits: { fileSize: config.uploadLimitBytes },
  fileFilter: (_request, file, callback) => {
    if (!allowedContentTypes.has(file.mimetype)) {
      callback(new Error("Unsupported file type. Please upload MP4, MOV, or AVI."));
      return;
    }
    callback(null, true);
  },
});

function asyncRoute(handler) {
  return (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next);
}

async function durationSeconds(videoPath) {
  return new Promise((resolve, reject) => {
    const child = spawn("ffprobe", [
      "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", videoPath,
    ], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      const duration = Number.parseFloat(stdout);
      if (code === 0 && Number.isFinite(duration)) resolve(duration);
      else reject(new Error(stderr.trim() || "Could not read video duration. Ensure FFmpeg is installed."));
    });
  });
}

async function authenticate(request, response, next) {
  const userId = await getCurrentUserId(request.headers.authorization);
  if (!userId) {
    response.status(401).json({ detail: "Sign in to continue." });
    return;
  }
  request.userId = userId;
  next();
}

function requireLivePipeline(_request, response, next) {
  if (config.mockMode || !config.openaiApiKey) {
    response.status(503).json({ detail: "Live translation is unavailable. Add OPENAI_API_KEY to backend/.env and restart the backend." });
    return;
  }
  next();
}

// SQLite stores CURRENT_TIMESTAMP as "YYYY-MM-DD HH:MM:SS" in UTC without a zone marker.
function toIsoTimestamp(value) {
  if (value instanceof Date) return value.toISOString();
  const text = String(value);
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text) ? `${text.replace(" ", "T")}Z` : text;
}

const oauthProviders = new Set(["google", "github", "apple"]);

async function planFor(userId) {
  const [subscription, usage] = await Promise.all([getSubscription(userId), getMonthlyUsage(userId)]);
  return {
    tier: subscription?.tier || "free",
    videosThisMonth: usage.videos,
    minutesThisMonth: Math.round((usage.seconds / 60) * 10) / 10,
    maxVideosPerMonth: Number(subscription?.max_videos_per_month || config.freeVideosPerMonth),
    maxVideoMinutes: Math.min(Number(subscription?.max_video_minutes || config.freeMaxVideoMinutes), config.maxVideoMinutes),
  };
}

async function jobOutput(job) {
  return {
    id: Number(job.id),
    status: job.status,
    current_step: job.current_step,
    source_language: job.source_language,
    target_language: job.target_language,
    voice_clone: Boolean(job.voice_clone),
    output_video_url: job.output_video_path ? await getSignedUrl(job.output_video_path) : null,
    output_video_download_url: job.output_video_path ? await getSignedUrl(job.output_video_path, 3600, true) : null,
    output_srt_url: job.output_srt_path ? await getSignedUrl(job.output_srt_path) : null,
    output_srt_download_url: job.output_srt_path ? await getSignedUrl(job.output_srt_path, 3600, true) : null,
    transcript: job.transcript_json || null,
    translated_segments: job.translated_segments_json || null,
    detected_languages: (job.detected_languages_json || []).map((code) => ({
      code,
      name: getLanguage(code)?.name || code,
    })),
    duration_seconds: job.duration_seconds === null || job.duration_seconds === undefined ? null : Number(job.duration_seconds),
    error_message: job.error_message,
    original_filename: job.original_filename || null,
    processing_note: job.processing_note || null,
    created_at: job.created_at ? toIsoTimestamp(job.created_at) : null,
    demo_mode: config.mockMode,
  };
}

const app = express();
app.use(cors({ origin: config.frontendUrl, credentials: true, exposedHeaders: ["Content-Disposition"] }));
app.use(express.json({ limit: "1mb" }));
app.use("/files", (request, response, next) => {
  if (request.query.download) {
    const filename = basename(String(request.query.download)).replace(/["\\]/g, "");
    response.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  }
  next();
}, express.static(config.localStorageDir, { fallthrough: false }));

app.get("/health", (_request, response) => {
  response.json({
    status: "ok",
    mode: config.mockMode ? "demo" : "live",
    capabilities: {
      languages: languages.filter((language) => language.code !== "auto").length,
      voiceClone: Boolean(config.elevenlabsApiKey),
      authentication: Boolean(config.supabaseUrl && config.supabaseKey),
    },
  });
});

app.get("/languages", (_request, response) => response.json(languages));

app.post("/auth/signup", asyncRoute(async (request, response) => {
  const { email, password } = request.body || {};
  if (!email || !password || String(password).length < 8) {
    response.status(400).json({ detail: "Enter an email and a password of at least 8 characters." });
    return;
  }
  try {
    response.status(201).json(await signup(email, password));
  } catch (error) {
    response.status(400).json({ detail: error.message });
  }
}));

app.post("/auth/login", asyncRoute(async (request, response) => {
  const { email, password } = request.body || {};
  if (!email || !password) {
    response.status(400).json({ detail: "Email and password are required." });
    return;
  }
  try {
    response.json(await login(email, password));
  } catch (error) {
    response.status(401).json({ detail: error.message });
  }
}));

app.get("/auth/oauth/:provider", (request, response) => {
  const provider = String(request.params.provider);
  if (!oauthProviders.has(provider)) {
    response.status(404).json({ detail: "Unsupported sign-in provider." });
    return;
  }
  if (!config.supabaseUrl || !config.supabaseKey) {
    response.redirect(`${config.frontendUrl}/login?error=oauth_unavailable`);
    return;
  }
  const authorize = new URL(`${config.supabaseUrl}/auth/v1/authorize`);
  authorize.searchParams.set("provider", provider);
  authorize.searchParams.set("redirect_to", `${config.frontendUrl}/auth/callback`);
  response.redirect(authorize.toString());
});

app.post("/auth/logout", asyncRoute(async (request, response) => {
  await logout(request.headers.authorization);
  response.status(204).end();
}));

app.post("/jobs", asyncRoute(authenticate), requireLivePipeline, upload.single("file"), asyncRoute(async (request, response) => {
  const temporaryPath = request.file?.path;
  if (!request.file) {
    response.status(400).json({ detail: "Choose a video to upload." });
    return;
  }
  const sourceLanguage = String(request.body.source_language || "");
  const targetLanguage = String(request.body.target_language || "");
  if (!getLanguage(sourceLanguage) || !getLanguage(targetLanguage) || targetLanguage === "auto") {
    await rm(temporaryPath, { force: true });
    response.status(400).json({ detail: "Choose a source and target language from the supported list." });
    return;
  }
  if (sourceLanguage === targetLanguage) {
    await rm(temporaryPath, { force: true });
    response.status(400).json({ detail: "Choose a different target language." });
    return;
  }
  if (!config.elevenlabsApiKey) {
    await rm(temporaryPath, { force: true });
    response.status(503).json({ detail: "Speaker-matched dubbing requires ELEVENLABS_API_KEY in backend/.env. Add it and restart the backend." });
    return;
  }

  try {
    const duration = await durationSeconds(temporaryPath);
    const plan = await planFor(request.userId);
    if (plan.videosThisMonth >= plan.maxVideosPerMonth) {
      await rm(temporaryPath, { force: true });
      response.status(402).json({ detail: `You've used all ${plan.maxVideosPerMonth} videos in your plan this month. Upgrade to translate more.` });
      return;
    }
    if (duration > plan.maxVideoMinutes * 60) {
      await rm(temporaryPath, { force: true });
      response.status(402).json({ detail: `This video is ${Math.ceil(duration / 60)} minutes long. Your plan allows videos up to ${plan.maxVideoMinutes} minutes.` });
      return;
    }

    const inputPath = `uploads/${randomUUID()}${extname(request.file.originalname).toLowerCase() || ".mp4"}`;
    await uploadFile(inputPath, temporaryPath, request.file.mimetype);
    const job = await createJob({
      user_id: request.userId,
      source_language: sourceLanguage,
      target_language: targetLanguage,
      voice_clone: true,
      input_storage_path: inputPath,
      original_filename: basename(request.file.originalname),
    });
    response.status(201).json(await jobOutput(job));
    void runPipeline(job.id, temporaryPath, job);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}));

app.get("/jobs", asyncRoute(authenticate), asyncRoute(async (request, response) => {
  const requestedLimit = Number.parseInt(String(request.query.limit ?? ""), 10);
  const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 10;
  const jobs = await listJobs(request.userId, limit);
  response.json(await Promise.all(jobs.map(jobOutput)));
}));

app.get("/usage", asyncRoute(authenticate), asyncRoute(async (request, response) => {
  const plan = await planFor(request.userId);
  response.json({
    tier: plan.tier,
    videos_this_month: plan.videosThisMonth,
    minutes_this_month: plan.minutesThisMonth,
    max_videos_per_month: plan.maxVideosPerMonth,
    max_video_minutes: plan.maxVideoMinutes,
  });
}));

app.get("/jobs/:jobId", asyncRoute(authenticate), asyncRoute(async (request, response) => {
  const jobId = Number(request.params.jobId);
  const job = Number.isInteger(jobId) ? await getJob(jobId) : null;
  if (!job || (job.user_id && job.user_id !== request.userId)) {
    response.status(404).json({ detail: "Job not found." });
    return;
  }
  response.json(await jobOutput(job));
}));

app.use((error, _request, response, _next) => {
  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
    response.status(413).json({ detail: "Video exceeds the 2GB upload limit." });
    return;
  }
  const status = error.message?.startsWith("Unsupported file type") ? 400 : 500;
  response.status(status).json({ detail: error.message || "Internal server error." });
});

export async function startServer() {
  await initializeDatabase();
  const interrupted = await failInterruptedJobs();
  if (interrupted) console.log(`Marked ${interrupted} interrupted job(s) as failed.`);
  const server = app.listen(config.port, () => {
    console.log(`ReelLingo API listening on http://localhost:${config.port} (${config.mockMode ? "demo" : "live"} mode)`);
  });
  const shutdown = async () => {
    server.close();
    await closeDatabase();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  return server;
}

export { app };

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void startServer();
}