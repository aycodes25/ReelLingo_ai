import { config } from "./config.js";
import { many, one, query, toBool } from "./db.js";

// Features a plan can switch on or off. Anything missing from a stored plan counts as allowed.
export const PERMISSIONS = {
  multi_speaker: "Multi-speaker dubbing",
  review: "Review translation before dubbing",
  keep_background: "Keep background music",
  captions: "Burned-in captions",
  formats: "Extra aspect-ratio exports",
  link_import: "Import from links",
  youtube: "Publish to YouTube",
  audio_only: "Audio-only (podcast) dubbing",
  public_share: "Public watch pages",
};

const ALL_ON = Object.fromEntries(Object.keys(PERMISSIONS).map((key) => [key, true]));

// Seed values from .docs/monetization.md. The plans table is the source of truth at runtime:
// the landing page, billing and quota checks all read it, so prices change in one place.
export const DEFAULT_PLANS = [
  {
    code: "free", name: "Free", blurb: "Try ReelLingo on a short clip.", price_usd: 0, price_ngn: 0,
    videos_per_month: 1, max_video_minutes: 3, voice_clone: false, watermark: true, priority: 0, max_targets: 1,
    lip_sync: false, api_access: false, team_seats: 1, saved_voices: 0, sort: 0,
    permissions: { ...ALL_ON, multi_speaker: false, formats: false, youtube: false },
    features: ["1 video per month", "Up to 3 minutes per video", "Standard AI voices", "ReelLingo watermark", "SRT & VTT subtitles"],
  },
  {
    code: "starter", name: "Starter", blurb: "For hobbyists and TikTokers.", price_usd: 10, price_ngn: 16000,
    videos_per_month: 5, max_video_minutes: 10, voice_clone: true, watermark: false, priority: 1, max_targets: 2,
    lip_sync: false, api_access: false, team_seats: 1, saved_voices: 0, sort: 1,
    permissions: { ...ALL_ON, multi_speaker: false, youtube: false },
    features: ["5 videos per month", "Up to 10 minutes per video", "Voice cloning", "No watermark", "2 languages per upload", "Burned-in captions"],
  },
  {
    code: "creator", name: "Creator", blurb: "The sweet spot for YouTubers.", price_usd: 25, price_ngn: 40000,
    videos_per_month: 10, max_video_minutes: 25, voice_clone: true, watermark: false, priority: 2, max_targets: 4,
    lip_sync: false, api_access: false, team_seats: 1, saved_voices: 1, sort: 2, featured: true, permissions: ALL_ON,
    features: ["10 videos per month", "Up to 25 minutes per video", "Premium voice cloning + saved voice", "Priority processing", "4 languages per upload", "Multi-speaker dubbing", "Publish to YouTube"],
  },
  {
    code: "studio", name: "Studio", blurb: "For media houses and Nollywood.", price_usd: 80, price_ngn: 130000,
    videos_per_month: 30, max_video_minutes: 60, voice_clone: true, watermark: false, priority: 3, max_targets: 10,
    lip_sync: true, api_access: true, team_seats: 5, saved_voices: 5, sort: 3, permissions: ALL_ON,
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

/** The default plans as SQL inserts, for backend/sql/schema.sql (existing plans are never overwritten). */
export function planSeedSql() {
  const literal = (value) => (typeof value === "string" ? `'${value.replace(/'/g, "''")}'` : typeof value === "boolean" ? (value ? "TRUE" : "FALSE") : String(value));
  return DEFAULT_PLANS.map((plan) => {
    const values = [plan.code, plan.name, plan.blurb, plan.price_usd, plan.price_ngn, plan.videos_per_month, plan.max_video_minutes, plan.voice_clone,
      plan.watermark, plan.priority, plan.max_targets, plan.lip_sync, plan.api_access, plan.team_seats, plan.saved_voices,
      JSON.stringify({ features: plan.features, featured: Boolean(plan.featured) }), plan.sort, true, JSON.stringify(plan.permissions), false];
    return `INSERT INTO public.plans (code, name, blurb, price_usd, price_ngn, videos_per_month, max_video_minutes, voice_clone, watermark, priority, max_targets, lip_sync, api_access, team_seats, saved_voices, features_json, sort, public, permissions_json, contact_sales)\n  VALUES (${values.map(literal).join(", ")})\n  ON CONFLICT (code) DO NOTHING;`;
  });
}

export async function seedPlans() {
  for (const plan of DEFAULT_PLANS) {
    await query(
      `INSERT INTO plans (code, name, blurb, price_usd, price_ngn, videos_per_month, max_video_minutes, voice_clone, watermark, priority,
        max_targets, lip_sync, api_access, team_seats, saved_voices, features_json, sort, public, permissions_json, contact_sales)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
       ON CONFLICT (code) DO NOTHING`,
      [plan.code, plan.name, plan.blurb, plan.price_usd, plan.price_ngn, plan.videos_per_month, plan.max_video_minutes, plan.voice_clone,
        plan.watermark, plan.priority, plan.max_targets, plan.lip_sync, plan.api_access, plan.team_seats, plan.saved_voices,
        JSON.stringify({ features: plan.features, featured: Boolean(plan.featured) }), plan.sort, true, JSON.stringify(plan.permissions), false],
    );
  }
}

export function normalizePlan(row) {
  if (!row) return null;
  let extra = {};
  let permissions = null;
  try {
    extra = JSON.parse(row.features_json || "{}");
    permissions = row.permissions_json ? JSON.parse(row.permissions_json) : null;
  } catch {
    extra = {};
  }
  // Plans created before permissions existed fall back to the seed for their code, or allow everything.
  permissions = { ...ALL_ON, ...(permissions || DEFAULT_PLANS.find((plan) => plan.code === row.code)?.permissions || {}) };
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
    permissions,
    contact_sales: toBool(row.contact_sales),
    public: toBool(row.public),
    sort: Number(row.sort),
  };
  if (plan.code === "free") {
    if (config.freeVideosPerMonth !== null) plan.videos_per_month = config.freeVideosPerMonth;
    if (config.freeMaxVideoMinutes !== null) plan.max_video_minutes = config.freeMaxVideoMinutes;
  }
  plan.max_video_minutes = Math.min(plan.max_video_minutes, config.maxVideoMinutes);
  // The quota lines are generated from the numbers so marketing copy can never disagree with the enforced limits.
  plan.features = [
    `${plan.videos_per_month} video${plan.videos_per_month === 1 ? "" : "s"} per month`,
    `Up to ${plan.max_video_minutes} minutes per video`,
    ...plan.features.filter((feature) => !/per month$|minutes per video$/i.test(feature)),
  ];
  return plan;
}

export async function listPlans() {
  return (await many("SELECT * FROM plans WHERE public = $1 ORDER BY sort", [true])).map(normalizePlan);
}

export async function listAllPlans() {
  return (await many("SELECT * FROM plans ORDER BY sort, id")).map(normalizePlan);
}

const NUMBER_FIELDS = ["price_usd", "price_ngn", "videos_per_month", "max_video_minutes", "priority", "max_targets", "team_seats", "saved_voices", "sort"];
const BOOL_FIELDS = ["voice_clone", "watermark", "lip_sync", "api_access", "public", "contact_sales"];

function planValues(input, current = null) {
  const merged = { ...(current || {}), ...input };
  const name = String(merged.name || "").trim().slice(0, 60);
  if (!name) throw new Error("Give the plan a name.");
  const values = { name, blurb: String(merged.blurb || "").slice(0, 200) };
  for (const field of NUMBER_FIELDS) {
    const value = Number(merged[field] ?? 0);
    if (!Number.isFinite(value) || value < 0) throw new Error(`${field.replace(/_/g, " ")} must be zero or more.`);
    values[field] = field.startsWith("price_") ? value : Math.round(value);
  }
  if (values.max_video_minutes < 1) throw new Error("A plan needs at least 1 minute per video.");
  if (values.max_targets < 1) values.max_targets = 1;
  if (values.team_seats < 1) values.team_seats = 1;
  for (const field of BOOL_FIELDS) values[field] = Boolean(merged[field]);
  const features = (Array.isArray(merged.features) ? merged.features : String(merged.features || "").split("\n"))
    .map((line) => String(line).trim()).filter(Boolean).slice(0, 20);
  values.features_json = JSON.stringify({ features, featured: Boolean(merged.featured) });
  const permissions = {};
  for (const key of Object.keys(PERMISSIONS)) permissions[key] = merged.permissions?.[key] !== false;
  values.permissions_json = JSON.stringify(permissions);
  return values;
}

// Raw stored values (without env overrides or generated quota lines) so saving an edit never bakes those in.
function rawPlan(row) {
  if (!row) return null;
  const plan = normalizePlan(row);
  let extra = {};
  try {
    extra = JSON.parse(row.features_json || "{}");
  } catch {
    extra = {};
  }
  return { ...plan, videos_per_month: Number(row.videos_per_month), max_video_minutes: Number(row.max_video_minutes), features: extra.features || [] };
}

export async function getRawPlan(code) {
  return rawPlan(await one("SELECT * FROM plans WHERE code = $1", [code]));
}

export async function listRawPlans() {
  return (await many("SELECT * FROM plans ORDER BY sort, id")).map(rawPlan);
}

export async function createPlan(input) {
  const code = String(input.code || "").trim().toLowerCase();
  if (!/^[a-z][a-z0-9_-]{1,30}$/.test(code)) throw new Error("Plan code must be 2-31 lowercase letters, numbers, - or _ (for example: enterprise).");
  if (await one("SELECT id FROM plans WHERE code = $1", [code])) throw new Error("A plan with that code already exists.");
  const values = planValues(input);
  const fields = Object.keys(values);
  await query(
    `INSERT INTO plans (code, ${fields.join(", ")}) VALUES ($1, ${fields.map((_, index) => `$${index + 2}`).join(", ")})`,
    [code, ...fields.map((field) => values[field])],
  );
  return getRawPlan(code);
}

export async function updatePlan(code, input) {
  const current = await getRawPlan(code);
  if (!current) throw new Error("Plan not found.");
  const values = planValues(input, current);
  if (code === "free") {
    values.price_usd = 0;
    values.price_ngn = 0;
    values.public = true;
    values.contact_sales = false;
  }
  const fields = Object.keys(values);
  await query(`UPDATE plans SET ${fields.map((field, index) => `${field} = $${index + 1}`).join(", ")} WHERE code = $${fields.length + 1}`, [...fields.map((field) => values[field]), code]);
  return getRawPlan(code);
}

/** Deletes a plan, first moving its subscribers to another plan (default: free). */
export async function deletePlan(code, moveTo = "free") {
  if (code === "free") throw new Error("The free plan cannot be deleted: it is what everyone falls back to.");
  if (!(await one("SELECT id FROM plans WHERE code = $1", [code]))) throw new Error("Plan not found.");
  const target = await one("SELECT code FROM plans WHERE code = $1", [moveTo]);
  if (!target || moveTo === code) throw new Error("Choose a different plan to move subscribers to.");
  const moved = await query("UPDATE subscriptions SET tier = $1, updated_at = CURRENT_TIMESTAMP WHERE tier = $2", [moveTo, code]);
  await query("DELETE FROM plans WHERE code = $1", [code]);
  return { moved: moved.rowCount };
}

export async function getPlan(code) {
  return normalizePlan(await one("SELECT * FROM plans WHERE code = $1", [code])) || normalizePlan(await one("SELECT * FROM plans WHERE code = 'free'"));
}

export function getCreditPack(code) {
  return CREDIT_PACKS.find((pack) => pack.code === code) || null;
}
