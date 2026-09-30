import { config } from "./config.js";
import { many, one, query, toBool } from "./db.js";

// Seed values from .docs/monetization.md. The plans table is the source of truth at runtime:
// the landing page, billing and quota checks all read it, so prices change in one place.
export const DEFAULT_PLANS = [
  {
    code: "free", name: "Free", blurb: "Try ReelLingo on a short clip.", price_usd: 0, price_ngn: 0,
    videos_per_month: 1, max_video_minutes: 3, voice_clone: false, watermark: true, priority: 0, max_targets: 1,
    lip_sync: false, api_access: false, team_seats: 1, saved_voices: 0, sort: 0,
    features: ["1 video per month", "Up to 3 minutes per video", "Standard AI voices", "ReelLingo watermark", "SRT & VTT subtitles"],
  },
  {
    code: "starter", name: "Starter", blurb: "For hobbyists and TikTokers.", price_usd: 10, price_ngn: 16000,
    videos_per_month: 5, max_video_minutes: 10, voice_clone: true, watermark: false, priority: 1, max_targets: 2,
    lip_sync: false, api_access: false, team_seats: 1, saved_voices: 0, sort: 1,
    features: ["5 videos per month", "Up to 10 minutes per video", "Voice cloning", "No watermark", "2 languages per upload", "Burned-in captions"],
  },
  {
    code: "creator", name: "Creator", blurb: "The sweet spot for YouTubers.", price_usd: 25, price_ngn: 40000,
    videos_per_month: 10, max_video_minutes: 25, voice_clone: true, watermark: false, priority: 2, max_targets: 4,
    lip_sync: false, api_access: false, team_seats: 1, saved_voices: 1, sort: 2, featured: true,
    features: ["10 videos per month", "Up to 25 minutes per video", "Premium voice cloning + saved voice", "Priority processing", "4 languages per upload", "Multi-speaker dubbing", "Publish to YouTube"],
  },
  {
    code: "studio", name: "Studio", blurb: "For media houses and Nollywood.", price_usd: 80, price_ngn: 130000,
    videos_per_month: 30, max_video_minutes: 60, voice_clone: true, watermark: false, priority: 3, max_targets: 10,
    lip_sync: true, api_access: true, team_seats: 5, saved_voices: 5, sort: 3,
    features: ["30 videos per month", "Up to 60 minutes per video", "Lip-sync", "Highest priority queue", "10 languages per upload", "Team workspace (5 seats)", "API access", "Dedicated WhatsApp support"],
  },
];

// Pay-as-you-go packs: each buys one video up to the given length.
export const CREDIT_PACKS = [
  { code: "payg_5", minutes: 5, price_usd: 3, price_ngn: 4800 },
  { code: "payg_15", minutes: 15, price_usd: 5, price_ngn: 8000 },
  { code: "payg_30", minutes: 30, price_usd: 10, price_ngn: 16000 },
  { code: "payg_60", minutes: 60, price_usd: 20, price_ngn: 32000 },
];

export async function seedPlans() {
  for (const plan of DEFAULT_PLANS) {
    await query(
      `INSERT INTO plans (code, name, blurb, price_usd, price_ngn, videos_per_month, max_video_minutes, voice_clone, watermark, priority,
        max_targets, lip_sync, api_access, team_seats, saved_voices, features_json, sort, public)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
       ON CONFLICT (code) DO NOTHING`,
      [plan.code, plan.name, plan.blurb, plan.price_usd, plan.price_ngn, plan.videos_per_month, plan.max_video_minutes, plan.voice_clone,
        plan.watermark, plan.priority, plan.max_targets, plan.lip_sync, plan.api_access, plan.team_seats, plan.saved_voices,
        JSON.stringify({ features: plan.features, featured: Boolean(plan.featured) }), plan.sort, true],
    );
  }
}

export function normalizePlan(row) {
  if (!row) return null;
  let extra = {};
  try {
    extra = JSON.parse(row.features_json || "{}");
  } catch {
    extra = {};
  }
  const plan = {
    code: row.code,
    name: row.name,
    blurb: row.blurb || "",
    price_usd: Number(row.price_usd),
    price_ngn: Number(row.price_ngn),
    videos_per_month: Number(row.videos_per_month),
    max_video_minutes: Number(row.max_video_minutes),
    voice_clone: toBool(row.voice_clone),
    watermark: toBool(row.watermark),
    priority: Number(row.priority),
    max_targets: Number(row.max_targets),
    lip_sync: toBool(row.lip_sync),
    api_access: toBool(row.api_access),
    team_seats: Number(row.team_seats),
    saved_voices: Number(row.saved_voices),
    features: extra.features || [],
    featured: Boolean(extra.featured),
  };
  if (plan.code === "free") {
    if (config.freeVideosPerMonth !== null) plan.videos_per_month = config.freeVideosPerMonth;
    if (config.freeMaxVideoMinutes !== null) plan.max_video_minutes = config.freeMaxVideoMinutes;
  }
  plan.max_video_minutes = Math.min(plan.max_video_minutes, config.maxVideoMinutes);
  return plan;
}

export async function listPlans() {
  return (await many("SELECT * FROM plans WHERE public = $1 ORDER BY sort", [true])).map(normalizePlan);
}

export async function getPlan(code) {
  return normalizePlan(await one("SELECT * FROM plans WHERE code = $1", [code])) || normalizePlan(await one("SELECT * FROM plans WHERE code = 'free'"));
}

export function getCreditPack(code) {
  return CREDIT_PACKS.find((pack) => pack.code === code) || null;
}
