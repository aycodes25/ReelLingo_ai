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
  { key: "feature_link_import", field: "featureLinkImport", type: "bool", group: "Features", label: "Import from links (YouTube, TikTok, Drive…)" },
  { key: "feature_multi_speaker", field: "featureMultiSpeaker", type: "bool", group: "Features", label: "Multi-speaker dubbing" },
  { key: "feature_review", field: "featureReview", type: "bool", group: "Features", label: "Review translation before dubbing" },
  { key: "feature_background", field: "featureBackground", type: "bool", group: "Features", label: "Keep background music" },
  { key: "feature_captions", field: "featureCaptions", type: "bool", group: "Features", label: "Burned-in captions" },
  { key: "feature_formats", field: "featureFormats", type: "bool", group: "Features", label: "Extra aspect-ratio exports" },
  { key: "feature_lip_sync", field: "featureLipSync", type: "bool", group: "Features", label: "Lip-sync" },
  { key: "feature_youtube", field: "featureYoutube", type: "bool", group: "Features", label: "Publish to YouTube" },
  { key: "feature_saved_voices", field: "featureSavedVoices", type: "bool", group: "Features", label: "Saved voices" },
  { key: "feature_public_share", field: "featurePublicShare", type: "bool", group: "Features", label: "Public watch pages" },
  { key: "feature_teams", field: "featureTeams", type: "bool", group: "Features", label: "Team workspaces" },
  { key: "feature_api", field: "featureApi", type: "bool", group: "Features", label: "API keys" },
  { key: "feature_referrals", field: "featureReferrals", type: "bool", group: "Features", label: "Referral rewards" },
  { key: "feature_payg", field: "featurePayg", type: "bool", group: "Features", label: "Pay-as-you-go credit packs" },

  // Limits
  { key: "max_video_minutes", field: "maxVideoMinutes", type: "number", min: 1, max: 600, group: "Limits", label: "Longest video any plan can upload (minutes)" },
  { key: "max_redubs", field: "maxRedubs", type: "number", min: 0, max: 100, group: "Limits", label: "Re-dubs allowed per project" },
  { key: "retention_days", field: "retentionDays", type: "number", min: 1, max: 3650, group: "Limits", label: "Delete project files after (days)" },
  { key: "job_rate_limit_per_hour", field: "jobRateLimitPerHour", type: "number", min: 1, max: 10000, group: "Limits", label: "Max new jobs per user per hour" },
  { key: "referral_bonus_videos", field: "referralBonusVideos", type: "number", min: 0, max: 20, group: "Limits", label: "Referral bonus: free videos each" },
  { key: "referral_bonus_minutes", field: "referralBonusMinutes", type: "number", min: 1, max: 120, group: "Limits", label: "Referral bonus: minutes per free video" },

  // Processing
  { key: "worker_concurrency", field: "workerConcurrency", type: "number", min: 1, max: 16, group: "Processing", label: "Videos processed at the same time" },
  { key: "separation_provider", field: "separationProvider", type: "select", options: ["auto", "demucs", "elevenlabs", "ffmpeg", "none"], group: "Processing", label: "Background separation engine" },
  { key: "transcription_provider", field: "transcriptionProvider", type: "select", options: ["openai", "elevenlabs"], group: "Processing", label: "Transcription engine" },
  { key: "background_volume", field: "backgroundVolume", type: "number", min: 0, max: 2, step: 0.05, group: "Processing", label: "Background music volume (1 = original)" },
  { key: "openai_chat_model", field: "openaiChatModel", type: "text", group: "Processing", label: "OpenAI translation model" },
  { key: "elevenlabs_model", field: "elevenlabsModel", type: "text", group: "Processing", label: "ElevenLabs voice model" },
  { key: "watermark_text", field: "watermarkText", type: "text", group: "Processing", label: "Watermark text (plans with watermark)" },

  // Money
  { key: "ngn_per_usd", field: "ngnPerUsd", type: "number", min: 1, max: 100000, group: "Money", label: "Naira per US dollar (profit estimates)" },
];

const BY_KEY = new Map(SETTINGS.map((setting) => [setting.key, setting]));
const defaults = Object.fromEntries(SETTINGS.map((setting) => [setting.field, config[setting.field]]));
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
        config[setting.field] = coerce(setting, JSON.parse(saved.get(setting.key)));
      } catch (error) {
        logger.warn({ err: error, key: setting.key }, "Ignoring invalid saved setting");
        config[setting.field] = defaults[setting.field];
      }
    } else {
      config[setting.field] = defaults[setting.field];
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
    value: config[setting.field], default: defaults[setting.field], overridden: config[setting.field] !== defaults[setting.field],
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
      referrals: config.featureReferrals, payg: config.featurePayg,
    },
  };
}
