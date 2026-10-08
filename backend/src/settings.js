import { config } from "./config.js";
import { many, query } from "./db.js";
import { logger } from "./logger.js";

/**
 * App-wide settings an admin can change from the website without touching .env or restarting.
 * Each maps onto a `config` field: .env provides the default, a saved admin value overrides it.
 */
export const SETTINGS = [
  // General
  { key: "maintenance_mode", field: "maintenanceMode", type: "bool", group: "General", label: "Maintenance mode", help: "Blocks new uploads, imports and purchases for everyone except admins. Running jobs finish normally." },
  { key: "maintenance_message", field: "maintenanceMessage", type: "text", group: "General", label: "Maintenance message" },
  { key: "signups_enabled", field: "signupsEnabled", type: "bool", group: "General", label: "Allow new sign-ups" },
  { key: "announcement", field: "announcement", type: "text", group: "General", label: "Announcement banner", help: "Shown at the top of every studio page. Leave empty to hide." },
  { key: "announcement_tone", field: "announcementTone", type: "select", options: ["info", "success", "warn"], group: "General", label: "Announcement style" },
  { key: "support_email", field: "supportEmail", type: "text", group: "General", label: "Support email" },
  { key: "support_whatsapp", field: "supportWhatsapp", type: "text", group: "General", label: "Support WhatsApp number (digits, with country code)" },

  // Features
  { key: "feature_link_import", field: "featureLinkImport", type: "bool", group: "Features", label: "Import from links (Google Drive, Dropbox, direct links) and from the creator's own YouTube channel" },
  { key: "feature_subtitles_only", field: "featureSubtitlesOnly", type: "bool", group: "Features", label: "Subtitles-only projects (no voice)" },
  { key: "feature_human_review", field: "featureHumanReview", type: "bool", group: "Features", label: "Human review by native speakers (paid add-on)" },
  { key: "feature_clips", field: "featureClips", type: "bool", group: "Features", label: "Short clips for TikTok and Reels (paid add-on)" },
  { key: "feature_youtube_languages", field: "featureYoutubeLanguages", type: "bool", group: "Features", label: "Add subtitles and translated titles to the creator's existing YouTube videos" },
  { key: "feature_yearly", field: "featureYearly", type: "bool", group: "Features", label: "Yearly plans" },
  { key: "feature_multi_speaker", field: "featureMultiSpeaker", type: "bool", group: "Features", label: "Multi-speaker dubbing" },
  { key: "feature_review", field: "featureReview", type: "bool", group: "Features", label: "Review translation before dubbing" },
  { key: "feature_background", field: "featureBackground", type: "bool", group: "Features", label: "Keep background music" },
  { key: "feature_captions", field: "featureCaptions", type: "bool", group: "Features", label: "Burned-in captions" },
  { key: "feature_formats", field: "featureFormats", type: "bool", group: "Features", label: "Extra aspect-ratio exports" },
  { key: "feature_lip_sync", field: "featureLipSync", type: "bool", group: "Features", label: "Lip-sync" },
  { key: "feature_youtube", field: "featureYoutube", type: "bool", group: "Features", label: "Publish to YouTube" },
  { key: "feature_saved_voices", field: "featureSavedVoices", type: "bool", group: "Features", label: "Saved voices" },
  { key: "feature_public_share", field: "featurePublicShare", type: "bool", group: "Features", label: "Public watch pages" },
  { key: "feature_teams", field: "featureTeams", type: "bool", group: "Features", label: "Team workspaces", help: "Hidden from everyone while off. Turn on when a customer asks for it." },
  { key: "feature_api", field: "featureApi", type: "bool", group: "Features", label: "API keys", help: "Hidden from everyone while off. Turn on when a customer asks for it." },
  { key: "feature_referrals", field: "featureReferrals", type: "bool", group: "Features", label: "Referral rewards" },
  { key: "feature_payg", field: "featurePayg", type: "bool", group: "Features", label: "Minute packs (pay as you go)" },

  // Limits
  { key: "max_video_minutes", field: "maxVideoMinutes", type: "number", min: 1, max: 600, group: "Limits", label: "Longest video any plan can upload (minutes)", help: "The Church & Ministry plan allows 120-minute sermons, so keep this at 120 or more." },
  { key: "max_redubs", field: "maxRedubs", type: "number", min: 0, max: 100, group: "Limits", label: "Re-dubs allowed per project" },
  { key: "retention_days", field: "retentionDays", type: "number", min: 1, max: 3650, group: "Limits", label: "Delete project files after (days)" },
  { key: "uploads_per_hour", field: "uploadsPerHour", type: "number", min: 1, max: 10000, group: "Limits", label: "Max resumable uploads started per user per hour" },
  { key: "signup_rate_limit_per_hour", field: "signupRateLimitPerHour", type: "number", min: 1, max: 10000, group: "Limits", label: "Max sign-ups per internet address per hour", help: "Stops one person opening many free accounts. Offices and campuses share one address, so don't set this too low." },
  { key: "max_retranslations", field: "maxRetranslations", type: "number", min: 0, max: 1000, group: "Limits", label: "Single-line re-translations allowed per project" },
  { key: "require_confirmed_email", field: "requireConfirmedEmail", type: "bool", group: "Limits", label: "Free dubbing needs a confirmed email address", help: "Also turn on \"Confirm email\" in Supabase → Authentication, or this has nothing to check." },
  { key: "job_rate_limit_per_hour", field: "jobRateLimitPerHour", type: "number", min: 1, max: 10000, group: "Limits", label: "Max new jobs per user per hour" },

  // Pricing: how minutes are used, and the free-tier safety limit.
  { key: "free_monthly_budget_usd", field: "freeMonthlyBudgetUsd", type: "number", min: 0, max: 100000, step: 1, group: "Pricing", label: "Most free users may cost you per month (US$)", help: "When free users together have cost this much this month, free dubbing pauses until the 1st. Paid users are never affected. 0 turns free dubbing off." },
  { key: "minutes_weight_subtitles", field: "minuteWeights.subtitles", type: "number", min: 0.01, max: 1, step: 0.01, group: "Pricing", label: "Subtitles-only: minutes used per minute of video", help: "0.1 means 10 minutes of subtitles use 1 minute." },
  { key: "minutes_weight_lip_sync", field: "minuteWeights.lipSync", type: "number", min: 1, max: 100, step: 0.5, group: "Pricing", label: "Lip-sync add-on: extra minutes per minute of video", help: "Lip-sync costs you about $3-$4 per minute, so it uses many minutes." },
  { key: "minutes_weight_human_review", field: "minuteWeights.humanReview", type: "number", min: 0, max: 20, step: 0.1, group: "Pricing", label: "Human review add-on: extra minutes per minute of video" },
  { key: "minutes_per_clip_set", field: "minuteWeights.clips", type: "number", min: 0, max: 20, step: 0.5, group: "Pricing", label: "Short clips: minutes per set of clips" },
  { key: "reviewer_pay_ngn_per_minute", field: "reviewerPayNgnPerMinute", type: "number", min: 0, max: 100000, step: 10, group: "Pricing", label: "Human reviewers earn (₦ per minute of video)" },
  { key: "human_review_timeout_hours", field: "humanReviewTimeoutHours", type: "number", min: 1, max: 720, group: "Pricing", label: "If no reviewer picks a video up within (hours), continue without review and refund it" },
  { key: "referral_bonus_minutes", field: "referralBonusMinutes", type: "number", min: 0, max: 120, step: 0.5, group: "Pricing", label: "Referral reward for the inviter (minutes)", help: "Paid once, on the friend's first purchase that still makes you money after both rewards (a Starter plan or bigger at the recommended prices)." },
  { key: "referral_new_user_minutes", field: "referralNewUserMinutes", type: "number", min: 0, max: 120, step: 0.5, group: "Pricing", label: "Welcome bonus for the invited friend (minutes, after their first payment)" },
  { key: "profit_chars_per_min_worst", field: "profitAssumptions.charactersPerMinuteWorst", type: "number", min: 100, max: 5000, group: "Pricing", label: "Profit check: voice characters per minute (fast talker)" },
  { key: "profit_chars_per_min_typical", field: "profitAssumptions.charactersPerMinuteTypical", type: "number", min: 100, max: 5000, group: "Pricing", label: "Profit check: voice characters per minute (typical)" },
  { key: "profit_typical_usage_percent", field: "profitAssumptions.typicalUsagePercent", type: "number", min: 1, max: 100, group: "Pricing", label: "Profit check: how much of their minutes a typical customer uses (%)" },
  { key: "paystack_fee_percent", field: "profitAssumptions.paystackPercent", type: "number", min: 0, max: 20, step: 0.1, group: "Pricing", label: "Paystack fee (%)" },
  { key: "paystack_fee_flat_ngn", field: "profitAssumptions.paystackFlatNgn", type: "number", min: 0, max: 10000, group: "Pricing", label: "Paystack flat fee (₦, waived under ₦2,500)" },
  { key: "paystack_fee_cap_ngn", field: "profitAssumptions.paystackCapNgn", type: "number", min: 0, max: 100000, group: "Pricing", label: "Paystack fee cap (₦)" },
  { key: "stripe_fee_percent", field: "profitAssumptions.stripePercent", type: "number", min: 0, max: 20, step: 0.1, group: "Pricing", label: "Stripe fee (%), including international cards" },
  { key: "stripe_fee_flat_usd", field: "profitAssumptions.stripeFlatUsd", type: "number", min: 0, max: 5, step: 0.01, group: "Pricing", label: "Stripe flat fee (US$)" },

  // Processing
  { key: "worker_concurrency", field: "workerConcurrency", type: "number", min: 1, max: 16, group: "Processing", label: "Videos processed at the same time" },
  { key: "separation_provider", field: "separationProvider", type: "select", options: ["auto", "demucs", "elevenlabs", "ffmpeg", "none"], group: "Processing", label: "Background separation engine" },
  { key: "transcription_provider", field: "transcriptionProvider", type: "select", options: ["openai", "elevenlabs"], group: "Processing", label: "Transcription engine" },
  { key: "background_volume", field: "backgroundVolume", type: "number", min: 0, max: 2, step: 0.05, group: "Processing", label: "Background music volume (1 = original)" },
  { key: "openai_chat_model", field: "openaiChatModel", type: "text", group: "Processing", label: "OpenAI translation model" },
  { key: "elevenlabs_model", field: "elevenlabsModel", type: "text", group: "Processing", label: "ElevenLabs voice model" },
  { key: "watermark_text", field: "watermarkText", type: "text", group: "Processing", label: "Watermark text (plans with watermark)" },

  // Voices for Nigerian languages
  { key: "nigerian_voice_engine", field: "nigerianVoiceEngine", type: "select", options: ["auto", "spitch", "elevenlabs"], group: "Nigerian voices", label: "Voice for Yoruba, Hausa, Igbo and Pidgin", help: "auto = Spitch's native Nigerian voices when SPITCH_API_KEY is set (cloned and saved voices always use ElevenLabs)." },
  { key: "nigerian_translation_engine", field: "nigerianTranslationEngine", type: "select", options: ["auto", "spitch", "openai"], group: "Nigerian voices", label: "Translator for Yoruba, Hausa and Igbo", help: "auto = Spitch when SPITCH_API_KEY is set, otherwise OpenAI." },
  { key: "yoruba_tone_marks", field: "yorubaToneMarks", type: "bool", group: "Nigerian voices", label: "Add Yoruba tone marks before the voice reads the text (needs Spitch)" },
  { key: "african_transcription_engine", field: "africanTranscriptionEngine", type: "select", options: ["elevenlabs", "openai"], group: "Nigerian voices", label: "Transcribe Nigerian-language videos with", help: "ElevenLabs Scribe understands Yoruba, Hausa and Igbo far better than OpenAI Whisper." },

  // Legal pages
  { key: "legal_company_name", field: "legalCompanyName", type: "text", group: "Legal", label: "Business name shown in the Terms and Privacy Policy", help: "Use your registered CAC business name." },
  { key: "legal_address", field: "legalAddress", type: "text", group: "Legal", label: "Business address" },
  { key: "dpo_email", field: "dpoEmail", type: "text", group: "Legal", label: "Data protection contact email (NDPA)", help: "Where people send privacy requests. Empty = the support email." },

  // Money
  { key: "ngn_per_usd", field: "ngnPerUsd", type: "number", min: 1, max: 100000, group: "Money", label: "Naira per US dollar (profit estimates)" },

  // Provider prices: used to work out what each job and each user costs you (API usage dashboard).
  { key: "cost_elevenlabs_per_1k_chars", field: "costs.elevenlabsPer1kChars", type: "number", min: 0, max: 10, step: 0.001, group: "Provider prices", label: "ElevenLabs voice, $ per 1,000 characters" },
  { key: "cost_whisper_per_min", field: "costs.whisperPerMinute", type: "number", min: 0, max: 10, step: 0.0001, group: "Provider prices", label: "OpenAI Whisper transcription, $ per minute" },
  { key: "cost_chat_input_per_m", field: "costs.chatInputPerMillion", type: "number", min: 0, max: 100, step: 0.01, group: "Provider prices", label: "OpenAI translation input, $ per 1M tokens" },
  { key: "cost_chat_output_per_m", field: "costs.chatOutputPerMillion", type: "number", min: 0, max: 100, step: 0.01, group: "Provider prices", label: "OpenAI translation output, $ per 1M tokens" },
  { key: "cost_scribe_per_hour", field: "costs.scribePerHour", type: "number", min: 0, max: 100, step: 0.01, group: "Provider prices", label: "ElevenLabs Scribe (multi-speaker), $ per hour" },
  { key: "cost_isolation_per_min", field: "costs.elevenlabsIsolationPerMinute", type: "number", min: 0, max: 10, step: 0.001, group: "Provider prices", label: "ElevenLabs Voice Isolator, $ per minute" },
  { key: "cost_openai_tts_per_1k_chars", field: "costs.openaiTtsPer1kChars", type: "number", min: 0, max: 10, step: 0.001, group: "Provider prices", label: "OpenAI backup voice, $ per 1,000 characters" },
  { key: "cost_spitch_speech_per_sec", field: "costs.spitchSpeechPerSecond", type: "number", min: 0, max: 1, step: 0.0001, group: "Provider prices", label: "Spitch voice, $ per second of speech" },
  { key: "cost_spitch_text_per_10k_words", field: "costs.spitchTextPer10kWords", type: "number", min: 0, max: 100, step: 0.01, group: "Provider prices", label: "Spitch translation / tone marks, $ per 10,000 words" },
  { key: "cost_lipsync_per_min", field: "costs.lipsyncPerMinute", type: "number", min: 0, max: 100, step: 0.01, group: "Provider prices", label: "sync.so lip-sync, $ per minute" },
  { key: "cost_whatsapp_per_message", field: "costs.whatsappPerMessage", type: "number", min: 0, max: 5, step: 0.0001, group: "Provider prices", label: "WhatsApp, $ per message (from Meta's rate card)" },
  { key: "cost_email_per_message", field: "costs.emailPerMessage", type: "number", min: 0, max: 5, step: 0.0001, group: "Provider prices", label: "Email (Resend), $ per message (0 on the free tier)" },
];

// Fields can be nested ("costs.whisperPerMinute"), so reads and writes go through these helpers.
function getField(field) {
  return field.split(".").reduce((value, part) => value?.[part], config);
}

function setField(field, value) {
  const parts = field.split(".");
  const last = parts.pop();
  const target = parts.reduce((value, part) => value[part], config);
  target[last] = value;
}

const BY_KEY = new Map(SETTINGS.map((setting) => [setting.key, setting]));
const defaults = Object.fromEntries(SETTINGS.map((setting) => [setting.field, getField(setting.field)]));
let refreshTimer = null;

function coerce(setting, raw) {
  if (setting.type === "bool") return raw === true || raw === "true" || raw === 1 || raw === "1";
  if (setting.type === "number") {
    const value = Number(raw);
    if (!Number.isFinite(value)) throw new Error(`${setting.label} must be a number.`);
    if (setting.min !== undefined && value < setting.min) throw new Error(`${setting.label} must be at least ${setting.min}.`);
    if (setting.max !== undefined && value > setting.max) throw new Error(`${setting.label} must be at most ${setting.max}.`);
    return value;
  }
  if (setting.type === "select") {
    if (!setting.options.includes(String(raw))) throw new Error(`${setting.label} must be one of ${setting.options.join(", ")}.`);
    return String(raw);
  }
  return String(raw ?? "").slice(0, 2000);
}

/** Re-reads saved settings and applies them onto `config` (so every module sees the change). */
export async function loadSettings() {
  const rows = await many("SELECT key, value FROM app_settings");
  const saved = new Map(rows.map((row) => [row.key, row.value]));
  for (const setting of SETTINGS) {
    if (saved.has(setting.key)) {
      try {
        setField(setting.field, coerce(setting, JSON.parse(saved.get(setting.key))));
      } catch (error) {
        logger.warn({ err: error, key: setting.key }, "Ignoring invalid saved setting");
        setField(setting.field, defaults[setting.field]);
      }
    } else {
      setField(setting.field, defaults[setting.field]);
    }
  }
}

/** Keeps separate processes (e.g. a standalone worker) in sync with changes made in the admin page. */
export function startSettingsRefresh(intervalMs = 20000) {
  clearInterval(refreshTimer);
  refreshTimer = setInterval(() => loadSettings().catch((error) => logger.warn({ err: error }, "Settings refresh failed")), intervalMs);
  refreshTimer.unref?.();
}

export function stopSettingsRefresh() {
  clearInterval(refreshTimer);
}

export function listSettings() {
  return SETTINGS.map((setting) => ({
    key: setting.key, type: setting.type, group: setting.group, label: setting.label, help: setting.help || null,
    options: setting.options || null, min: setting.min ?? null, max: setting.max ?? null, step: setting.step ?? null,
    value: getField(setting.field), default: defaults[setting.field], overridden: getField(setting.field) !== defaults[setting.field],
  }));
}

/** Saves admin changes. A value of null resets the setting to its .env default. */
export async function updateSettings(changes, adminId) {
  const pending = [];
  for (const [key, raw] of Object.entries(changes || {})) {
    const setting = BY_KEY.get(key);
    if (!setting) throw new Error(`Unknown setting "${key}".`);
    pending.push([setting, raw === null ? null : coerce(setting, raw)]);
  }
  for (const [setting, value] of pending) {
    if (value === null) {
      await query("DELETE FROM app_settings WHERE key = $1", [setting.key]);
    } else {
      await query(
        `INSERT INTO app_settings (key, value, updated_at, updated_by) VALUES ($1, $2, CURRENT_TIMESTAMP, $3)
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = CURRENT_TIMESTAMP, updated_by = $3`,
        [setting.key, JSON.stringify(value), adminId],
      );
    }
  }
  await loadSettings();
  return listSettings();
}

/** Settings the website needs before sign-in (banner, maintenance, sign-ups, which features exist). */
export function publicSettings() {
  return {
    maintenance: { enabled: Boolean(config.maintenanceMode), message: config.maintenanceMessage },
    signups_enabled: Boolean(config.signupsEnabled),
    announcement: config.announcement ? { text: config.announcement, tone: config.announcementTone } : null,
    support: { email: config.supportEmail, whatsapp: config.supportWhatsapp },
    features: {
      link_import: config.featureLinkImport, multi_speaker: config.featureMultiSpeaker, review: config.featureReview,
      keep_background: config.featureBackground, captions: config.featureCaptions, formats: config.featureFormats,
      lip_sync: config.featureLipSync, youtube: config.featureYoutube, saved_voices: config.featureSavedVoices,
      public_share: config.featurePublicShare, teams: config.featureTeams, api: config.featureApi,
      referrals: config.featureReferrals, payg: config.featurePayg, subtitles_only: config.featureSubtitlesOnly,
      human_review: config.featureHumanReview, clips: config.featureClips, youtube_languages: config.featureYoutubeLanguages,
      yearly: config.featureYearly,
    },
    pricing: {
      weights: { ...config.minuteWeights },
      referral_bonus_minutes: config.referralBonusMinutes,
      referral_new_user_minutes: config.referralNewUserMinutes,
    },
    legal: {
      company: config.legalCompanyName, address: config.legalAddress,
      privacy_email: config.dpoEmail || config.supportEmail, terms_version: config.termsVersion,
    },
  };
}
