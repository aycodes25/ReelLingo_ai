import dotenv from "dotenv";
import { resolve } from "node:path";

dotenv.config();

const requestedMockMode = process.env.MOCK_MODE?.toLowerCase() !== "false";
const openaiApiKey = process.env.OPENAI_API_KEY || "";
const number = (name, fallback) => {
  const value = Number(process.env[name]);
  return process.env[name] !== undefined && process.env[name] !== "" && Number.isFinite(value) ? value : fallback;
};
const list = (name, fallback = []) => (process.env[name] ? process.env[name].split(",").map((item) => item.trim()).filter(Boolean) : fallback);

export const config = {
  port: Number(process.env.PORT || 8000),
  publicApiUrl: process.env.PUBLIC_API_URL || `http://localhost:${Number(process.env.PORT || 8000)}`,
  databaseUrl: process.env.DATABASE_URL || "sqlite:///./local.db",
  supabaseUrl: process.env.SUPABASE_URL || "",
  supabaseKey: process.env.SUPABASE_KEY || "",
  storageBucket: process.env.STORAGE_BUCKET || "reellingo-videos",
  openaiApiKey,
  // Optional OpenAI *Admin* key: lets the usage dashboard read what OpenAI actually billed.
  openaiAdminKey: process.env.OPENAI_ADMIN_KEY || "",
  openaiBaseUrl: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
  openaiTranscriptionModel: process.env.OPENAI_TRANSCRIPTION_MODEL || "whisper-1",
  openaiChatModel: process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini",
  elevenlabsApiKey: process.env.ELEVENLABS_API_KEY || "",
  // eleven_v4 is the ElevenLabs model that covers Yoruba, Hausa, Swahili and Somali.
  elevenlabsModel: process.env.ELEVENLABS_MODEL || "eleven_v4",
  // Stock voice used when the ElevenLabs plan cannot clone the speaker (free tier).
  elevenlabsFallbackVoiceId: process.env.ELEVENLABS_FALLBACK_VOICE_ID || "EXAVITQu4vr4xnSDxMaL",
  // Extra stock voices so different speakers still sound different when they cannot be cloned.
  elevenlabsStockVoices: list("ELEVENLABS_STOCK_VOICES", ["EXAVITQu4vr4xnSDxMaL", "TX3LPaxmHKxFdv7VOQHJ", "XB0fDUnXU5powFXDhCwa", "onwK4e9ZLuTAKqWW03F9"]),
  elevenlabsSttModel: process.env.ELEVENLABS_STT_MODEL || "scribe_v1",
  openaiTtsModel: process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts",
  // "openai" (Whisper) or "elevenlabs" (Scribe, which also separates speakers).
  transcriptionProvider: process.env.TRANSCRIPTION_PROVIDER || "openai",
  // Background separation: "auto" | "demucs" | "elevenlabs" | "ffmpeg" | "none".
  separationProvider: process.env.SEPARATION_PROVIDER || "auto",
  demucsCommand: process.env.DEMUCS_COMMAND || "demucs",
  backgroundVolume: number("BACKGROUND_VOLUME", 1),
  mockMode: requestedMockMode && !openaiApiKey,
  uploadLimitBytes: 2 * 1024 * 1024 * 1024,
  maxVideoMinutes: number("MAX_VIDEO_MINUTES", 60),
  // Optional overrides for the free plan (otherwise the plans table decides).
  freeVideosPerMonth: process.env.FREE_VIDEOS_PER_MONTH ? Number(process.env.FREE_VIDEOS_PER_MONTH) : null,
  freeMaxVideoMinutes: process.env.FREE_MAX_VIDEO_MINUTES ? Number(process.env.FREE_MAX_VIDEO_MINUTES) : null,
  localStorageDir: resolve(process.env.LOCAL_STORAGE_DIR || "./storage"),
  frontendUrl: process.env.FRONTEND_URL || "http://localhost:3000",
  // The separate admin website (ReelLingo_Admin repo).
  adminUrl: process.env.ADMIN_URL || "http://localhost:3001",
  appSecret: process.env.APP_SECRET || "reellingo-dev-secret-change-me",
  logLevel: process.env.LOG_LEVEL || "info",
  sentryDsn: process.env.SENTRY_DSN || "",

  // Worker and queue
  workerMode: process.env.WORKER_MODE || "inline", // "inline" runs jobs inside the API; "off" leaves them to `npm run worker`.
  workerConcurrency: number("WORKER_CONCURRENCY", 2),
  workerPollMs: number("WORKER_POLL_MS", 2000),
  jobHeartbeatMs: number("JOB_HEARTBEAT_MS", 15000),
  jobStaleMs: number("JOB_STALE_MS", 120000),
  maxJobAttempts: number("MAX_JOB_ATTEMPTS", 3),
  maxRedubs: number("MAX_REDUBS", 5),

  // Retention
  retentionDays: number("RETENTION_DAYS", 30),
  cleanupIntervalMs: number("CLEANUP_INTERVAL_MS", 3600000),

  // Security
  rateLimitPerWindow: number("RATE_LIMIT_PER_15_MIN", 600),
  authRateLimitPerWindow: number("AUTH_RATE_LIMIT_PER_15_MIN", 30),
  jobRateLimitPerHour: number("JOB_RATE_LIMIT_PER_HOUR", 30),
  clamavHost: process.env.CLAMAV_HOST || "",
  clamavPort: number("CLAMAV_PORT", 3310),
  clamavMaxBytes: number("CLAMAV_MAX_BYTES", 100 * 1024 * 1024),
  adminEmails: list("ADMIN_EMAILS").map((email) => email.toLowerCase()),

  // Import from link
  ytDlpPath: process.env.YTDLP_PATH || "yt-dlp",
  allowPrivateImportHosts: process.env.ALLOW_PRIVATE_IMPORT_HOSTS === "true",

  // Notifications
  resendApiKey: process.env.RESEND_API_KEY || "",
  emailFrom: process.env.EMAIL_FROM || "ReelLingo <notifications@reellingo.ai>",
  whatsappToken: process.env.WHATSAPP_TOKEN || "",
  whatsappPhoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || "",
  whatsappTemplate: process.env.WHATSAPP_TEMPLATE || "",
  whatsappTemplateLanguage: process.env.WHATSAPP_TEMPLATE_LANGUAGE || "en",

  // Payments
  paystackSecretKey: process.env.PAYSTACK_SECRET_KEY || "",
  paystackPlanCodes: {
    starter: process.env.PAYSTACK_PLAN_STARTER || "",
    creator: process.env.PAYSTACK_PLAN_CREATOR || "",
    studio: process.env.PAYSTACK_PLAN_STUDIO || "",
  },
  stripeSecretKey: process.env.STRIPE_SECRET_KEY || "",
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || "",
  stripePriceIds: {
    starter: process.env.STRIPE_PRICE_STARTER || "",
    creator: process.env.STRIPE_PRICE_CREATOR || "",
    studio: process.env.STRIPE_PRICE_STUDIO || "",
  },

  // Growth
  referralBonusVideos: number("REFERRAL_BONUS_VIDEOS", 1),
  referralBonusMinutes: number("REFERRAL_BONUS_MINUTES", 10),

  // Lip-sync (sync.so)
  syncApiKey: process.env.SYNC_API_KEY || "",
  syncApiUrl: process.env.SYNC_API_URL || "https://api.sync.so",
  syncModel: process.env.SYNC_MODEL || "lipsync-2",

  // YouTube publishing
  googleClientId: process.env.GOOGLE_CLIENT_ID || "",
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || "",

  // Watermark
  watermarkText: process.env.WATERMARK_TEXT || "Made with ReelLingo",
  watermarkFont: process.env.WATERMARK_FONT || "",

  // Admin-controlled switches (Admin → Settings saves overrides in the database; see settings.js).
  maintenanceMode: process.env.MAINTENANCE_MODE === "true",
  maintenanceMessage: process.env.MAINTENANCE_MESSAGE || "ReelLingo is getting an upgrade. New uploads are paused for a short while.",
  signupsEnabled: process.env.SIGNUPS_ENABLED !== "false",
  announcement: process.env.ANNOUNCEMENT || "",
  announcementTone: "info",
  supportEmail: process.env.SUPPORT_EMAIL || "support@reellingo.ai",
  supportWhatsapp: process.env.SUPPORT_WHATSAPP || "",
  featureLinkImport: true,
  featureMultiSpeaker: true,
  featureReview: true,
  featureBackground: true,
  featureCaptions: true,
  featureFormats: true,
  featureLipSync: true,
  featureYoutube: true,
  featureSavedVoices: true,
  featurePublicShare: true,
  featureTeams: true,
  featureApi: true,
  featureReferrals: true,
  featurePayg: true,
  ngnPerUsd: number("NGN_PER_USD", 1600),

  // Provider cost estimates (USD) used for per-job margin tracking.
  costs: {
    whisperPerMinute: number("COST_WHISPER_PER_MIN", 0.006),
    scribePerHour: number("COST_SCRIBE_PER_HOUR", 0.22),
    chatInputPerMillion: number("COST_CHAT_INPUT_PER_M", 0.15),
    chatOutputPerMillion: number("COST_CHAT_OUTPUT_PER_M", 0.6),
    elevenlabsPer1kChars: number("COST_ELEVENLABS_PER_1K_CHARS", 0.08),
    elevenlabsIsolationPerMinute: number("COST_ELEVENLABS_ISOLATION_PER_MIN", 0.12),
    openaiTtsPer1kChars: number("COST_OPENAI_TTS_PER_1K_CHARS", 0.015),
    lipsyncPerMinute: number("COST_LIPSYNC_PER_MIN", 3),
    whatsappPerMessage: number("COST_WHATSAPP_PER_MESSAGE", 0),
    emailPerMessage: number("COST_EMAIL_PER_MESSAGE", 0),
  },
};

export function isAdminEmail(email) {
  return Boolean(email) && config.adminEmails.includes(String(email).toLowerCase());
}
