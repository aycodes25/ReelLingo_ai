import dotenv from "dotenv";
import { resolve } from "node:path";

// Tests never read backend/.env, so they can't touch your real database, storage or paid APIs.
if (!process.env.NODE_TEST_CONTEXT) dotenv.config();

const requestedMockMode = process.env.MOCK_MODE?.toLowerCase() !== "false";
const openaiApiKey = process.env.OPENAI_API_KEY || "";
const number = (name, fallback) => {
  const value = Number(process.env[name]);
  return process.env[name] !== undefined && process.env[name] !== "" && Number.isFinite(value) ? value : fallback;
};
// Plan codes and price IDs for every plan, read from names like PAYSTACK_PLAN_STARTER or PAYSTACK_PLAN_STARTER_YEARLY.
const prefixed = (prefix) => Object.fromEntries(Object.entries(process.env)
  .filter(([key, value]) => key.startsWith(prefix) && value)
  .map(([key, value]) => [key.slice(prefix.length).toLowerCase(), value.trim()]));
const list = (name, fallback = []) => (process.env[name] ? process.env[name].split(",").map((item) => item.trim()).filter(Boolean) : fallback);

export const config = {
  port: Number(process.env.PORT || 8000),
  publicApiUrl: process.env.PUBLIC_API_URL || `http://localhost:${Number(process.env.PORT || 8000)}`,
  databaseUrl: process.env.DATABASE_URL || "sqlite:///./local.db",
  supabaseUrl: process.env.SUPABASE_URL || "",
  supabaseKey: process.env.SUPABASE_KEY || "",
  storageBucket: process.env.STORAGE_BUCKET || "reellingo-videos",
  // Where video files live: "r2" (Cloudflare R2), "supabase" (Supabase Storage) or "local" (this computer).
  // Empty = automatic: R2 when its keys are set, else Supabase when configured, else local files.
  storageProvider: (process.env.STORAGE_PROVIDER || "").toLowerCase(),
  r2: {
    accountId: process.env.R2_ACCOUNT_ID || "",
    accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
    bucket: process.env.R2_BUCKET || "reellingo-videos",
    // Optional: a full S3 endpoint (e.g. for the EU jurisdiction: https://<account>.eu.r2.cloudflarestorage.com).
    endpoint: process.env.R2_ENDPOINT || "",
  },
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
  maxVideoMinutes: number("MAX_VIDEO_MINUTES", 120),
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
  // Manual "Retry" presses allowed per failed project (a failed run is refunded, so unlimited retries would be free provider spend).
  maxRetries: number("MAX_RETRIES", 3),
  // Refuse to start a video (with a clear message) when a service it needs has run out of credit.
  blockOnEmptyProvider: process.env.BLOCK_ON_EMPTY_PROVIDER !== "false",
  // How many requests may be open to Spitch at once. Spitch's Tier 1 allows 3; more are refused with "concurrency_limit_exceeded".
  spitchConcurrency: number("SPITCH_CONCURRENCY", 3),
  // Calm music people can listen to while their video processes (the admin controls it from Admin → App settings).
  waitingMusic: {
    enabled: process.env.WAITING_MUSIC !== "false",
    autoplay: process.env.WAITING_MUSIC_AUTOPLAY === "true",
    style: process.env.WAITING_MUSIC_STYLE || "calm",
    volume: number("WAITING_MUSIC_VOLUME", 0.35),
    url: process.env.WAITING_MUSIC_URL || "",
  },
  // How long the admin audit log keeps entries.
  auditRetentionDays: number("AUDIT_RETENTION_DAYS", 730),

  // Retention
  retentionDays: number("RETENTION_DAYS", 30),
  cleanupIntervalMs: number("CLEANUP_INTERVAL_MS", 3600000),

  // Security
  rateLimitPerWindow: number("RATE_LIMIT_PER_15_MIN", 600),
  authRateLimitPerWindow: number("AUTH_RATE_LIMIT_PER_15_MIN", 30),
  jobRateLimitPerHour: number("JOB_RATE_LIMIT_PER_HOUR", 30),
  uploadsPerHour: number("UPLOADS_PER_HOUR", 40),
  signupRateLimitPerHour: number("SIGNUP_RATE_LIMIT_PER_HOUR", 5),
  maxRetranslations: number("MAX_RETRANSLATIONS", 25),
  // Free dubbing needs a confirmed email address, so one person can't open many throwaway accounts.
  requireConfirmedEmail: process.env.REQUIRE_CONFIRMED_EMAIL !== "false",
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
  // { starter: "PLN_…", starter_yearly: "PLN_…", … } from PAYSTACK_PLAN_<PLAN> and PAYSTACK_PLAN_<PLAN>_YEARLY.
  paystackPlanCodes: prefixed("PAYSTACK_PLAN_"),
  stripeSecretKey: process.env.STRIPE_SECRET_KEY || "",
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || "",
  stripePriceIds: prefixed("STRIPE_PRICE_"),

  // Growth: when someone you invited makes their first payment, you get these minutes and they get a welcome bonus.
  // Paid only on a purchase that still makes money after paying both rewards (profit.js), so they can't cause a loss.
  referralBonusMinutes: number("REFERRAL_BONUS_MINUTES", 3),
  referralNewUserMinutes: number("REFERRAL_NEW_USER_MINUTES", 1),

  // Pricing (all editable in Admin → Settings → Pricing).
  // How many minutes each extra uses, per minute of video per language. Dubbing itself is 1.
  minuteWeights: {
    subtitles: number("MINUTES_WEIGHT_SUBTITLES", 0.1),
    lipSync: number("MINUTES_WEIGHT_LIP_SYNC", 12),
    humanReview: number("MINUTES_WEIGHT_HUMAN_REVIEW", 1),
    clips: number("MINUTES_PER_CLIP_SET", 1),
  },
  // Free users together may cost at most this much per month (US$); after that free dubbing pauses until the 1st.
  freeMonthlyBudgetUsd: number("FREE_MONTHLY_BUDGET_USD", 20),
  // What a human reviewer earns per minute of video they check (₦), and how long a review may wait for a reviewer.
  reviewerPayNgnPerMinute: number("REVIEWER_PAY_NGN_PER_MINUTE", 300),
  humanReviewTimeoutHours: number("HUMAN_REVIEW_TIMEOUT_HOURS", 48),
  // Worst-case assumptions used by the profit check (Admin → Plans).
  profitAssumptions: {
    charactersPerMinuteWorst: number("PROFIT_CHARS_PER_MIN_WORST", 1200),
    charactersPerMinuteTypical: number("PROFIT_CHARS_PER_MIN_TYPICAL", 900),
    typicalUsagePercent: number("PROFIT_TYPICAL_USAGE_PERCENT", 60),
    paystackPercent: number("PAYSTACK_FEE_PERCENT", 1.5),
    paystackFlatNgn: number("PAYSTACK_FEE_FLAT_NGN", 100),
    paystackCapNgn: number("PAYSTACK_FEE_CAP_NGN", 2000),
    stripePercent: number("STRIPE_FEE_PERCENT", 4.4),
    stripeFlatUsd: number("STRIPE_FEE_FLAT_USD", 0.3),
  },

  // Nigerian-language voices (Spitch: native Yoruba, Hausa, Igbo and Pidgin voices, plus Yoruba tone marks).
  spitchApiKey: process.env.SPITCH_API_KEY || "",
  spitchApiUrl: process.env.SPITCH_API_URL || "https://api.spitch.app/v1",
  // "auto" uses Spitch for Yoruba, Hausa, Igbo and Pidgin when SPITCH_API_KEY is set; "elevenlabs" never does.
  nigerianVoiceEngine: process.env.NIGERIAN_VOICE_ENGINE || "auto",
  // Translate into Yoruba, Hausa and Igbo with "openai" or "spitch" (Spitch is trained on Nigerian languages).
  nigerianTranslationEngine: process.env.NIGERIAN_TRANSLATION_ENGINE || "auto",
  // Restore Yoruba tone marks (àmì ohùn) before the voice reads the text and in the subtitles.
  yorubaToneMarks: process.env.YORUBA_TONE_MARKS !== "false",
  // Transcribe Nigerian-language videos with ElevenLabs Scribe (much better than Whisper for Yoruba, Hausa and Igbo).
  africanTranscriptionEngine: process.env.AFRICAN_TRANSCRIPTION_ENGINE || "elevenlabs",

  // Legal pages (Terms and Privacy Policy).
  legalCompanyName: process.env.LEGAL_COMPANY_NAME || "ReelLingo",
  legalAddress: process.env.LEGAL_ADDRESS || "Lagos, Nigeria",
  dpoEmail: process.env.DPO_EMAIL || "",
  termsVersion: "2026-10-04",

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
  // Hidden until a customer asks for them: switch on in Admin → Settings → Features.
  featureTeams: process.env.FEATURE_TEAMS === "true",
  featureApi: process.env.FEATURE_API === "true",
  featureSubtitlesOnly: true,
  featureHumanReview: true,
  featureClips: true,
  featureYoutubeLanguages: true,
  featureYearly: true,
  featureReferrals: true,
  featurePayg: true,
  ngnPerUsd: number("NGN_PER_USD", 1600),

  // Provider cost estimates (USD) used for per-job margin tracking.
  costs: {
    whisperPerMinute: number("COST_WHISPER_PER_MIN", 0.006),
    scribePerHour: number("COST_SCRIBE_PER_HOUR", 0.22),
    chatInputPerMillion: number("COST_CHAT_INPUT_PER_M", 0.15),
    chatOutputPerMillion: number("COST_CHAT_OUTPUT_PER_M", 0.6),
    // Creator plan overage is about $0.30 and Pro about $0.24 per 1,000 characters; set what your plan actually costs.
    elevenlabsPer1kChars: number("COST_ELEVENLABS_PER_1K_CHARS", 0.24),
    elevenlabsIsolationPerMinute: number("COST_ELEVENLABS_ISOLATION_PER_MIN", 0.12),
    openaiTtsPer1kChars: number("COST_OPENAI_TTS_PER_1K_CHARS", 0.015),
    lipsyncPerMinute: number("COST_LIPSYNC_PER_MIN", 3),
    spitchSpeechPerSecond: number("COST_SPITCH_SPEECH_PER_SEC", 0.0014),
    spitchTextPer10kWords: number("COST_SPITCH_TEXT_PER_10K_WORDS", 1),
    whatsappPerMessage: number("COST_WHATSAPP_PER_MESSAGE", 0),
    emailPerMessage: number("COST_EMAIL_PER_MESSAGE", 0),
  },
};

export function isAdminEmail(email) {
  return Boolean(email) && config.adminEmails.includes(String(email).toLowerCase());
}
