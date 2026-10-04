import { config } from "./config.js";
import { many, one, query, toBool } from "./db.js";

// Features a plan can switch on or off. Anything missing from a stored plan counts as allowed.
export const PERMISSIONS = {
  multi_speaker: "Multi-speaker dubbing",
  review: "Review translation before dubbing",
  keep_background: "Keep background music",
  captions: "Burned-in captions",
  formats: "Extra aspect-ratio exports",
  link_import: "Import from links and YouTube",
  youtube: "Publish to YouTube",
  audio_only: "Audio-only (podcast) dubbing",
  public_share: "Public watch pages",
  subtitles_only: "Subtitles-only projects",
  human_review: "Human review add-on",
  clips: "Short clips add-on",
  youtube_languages: "Add languages to existing YouTube videos",
};

const ALL_ON = Object.fromEntries(Object.keys(PERMISSIONS).map((key) => [key, true]));

/**
 * Prices worked out so every plan stays profitable even if a customer uses every minute (see profit.js):
 * the worst case is about $0.45 of provider costs per minute, at ₦1,600 per dollar (today's rate is lower,
 * which leaves room for the naira to weaken). Typical customers use far less, so typical margins are 70%+.
 * The plans table is the source of truth at runtime; these values seed new databases and power
 * "Apply recommended pricing" in Admin → Plans.
 */
export const DEFAULT_PLANS = [
  {
    code: "free", name: "Free", blurb: "Try ReelLingo on a short clip.", price_usd: 0, price_ngn: 0, price_usd_yearly: 0, price_ngn_yearly: 0,
    minutes_per_month: 2, videos_per_month: 1, max_video_minutes: 3, voice_clone: false, watermark: true, priority: 0, max_targets: 1,
    lip_sync: false, api_access: false, team_seats: 1, saved_voices: 0, sort: 0,
    permissions: { ...ALL_ON, multi_speaker: false, formats: false, youtube: false, human_review: false, clips: false, youtube_languages: false },
    features: ["Standard AI voices", "ReelLingo watermark", "SRT & VTT subtitles"],
  },
  {
    code: "subtitles", name: "Subtitles", blurb: "Accurate subtitles in 50+ languages.", price_usd: 3, price_ngn: 4500, price_usd_yearly: 30, price_ngn_yearly: 45000,
    minutes_per_month: 5, videos_per_month: 10, max_video_minutes: 60, voice_clone: false, watermark: false, priority: 1, max_targets: 3,
    lip_sync: false, api_access: false, team_seats: 1, saved_voices: 0, sort: 1,
    permissions: { ...ALL_ON, multi_speaker: false, human_review: false, clips: false },
    features: ["No watermark", "Burned-in caption styles", "SRT, VTT & styled subtitles", "3 languages per upload"],
  },
  {
    code: "starter", name: "Starter", blurb: "For hobbyists and TikTokers.", price_usd: 10, price_ngn: 15000, price_usd_yearly: 100, price_ngn_yearly: 150000,
    minutes_per_month: 16, videos_per_month: 10, max_video_minutes: 10, voice_clone: true, watermark: false, priority: 1, max_targets: 2,
    lip_sync: false, api_access: false, team_seats: 1, saved_voices: 0, sort: 2,
    permissions: { ...ALL_ON, multi_speaker: false, youtube: false, human_review: false },
    features: ["Voice cloning", "No watermark", "2 languages per upload", "Burned-in captions", "Short clips add-on"],
  },
  {
    code: "creator", name: "Creator", blurb: "The sweet spot for YouTubers.", price_usd: 25, price_ngn: 38000, price_usd_yearly: 250, price_ngn_yearly: 380000,
    minutes_per_month: 40, videos_per_month: 20, max_video_minutes: 30, voice_clone: true, watermark: false, priority: 2, max_targets: 4,
    lip_sync: true, api_access: false, team_seats: 1, saved_voices: 1, sort: 3, featured: true, permissions: ALL_ON,
    features: ["Premium voice cloning + saved voice", "Priority processing", "4 languages per upload", "Multi-speaker dubbing", "Publish to YouTube", "Human review & lip-sync add-ons"],
  },
  {
    code: "studio", name: "Studio", blurb: "For media houses and serious channels.", price_usd: 75, price_ngn: 115000, price_usd_yearly: 750, price_ngn_yearly: 1150000,
    minutes_per_month: 125, videos_per_month: 60, max_video_minutes: 60, voice_clone: true, watermark: false, priority: 3, max_targets: 10,
    lip_sync: true, api_access: true, team_seats: 5, saved_voices: 5, sort: 4, permissions: ALL_ON,
    features: ["Lip-sync add-on", "Highest priority queue", "10 languages per upload", "Team workspace (5 seats)", "API access", "Dedicated WhatsApp support"],
  },
  {
    code: "ministry", name: "Church & Ministry", blurb: "Every sermon, in every language your congregation speaks.",
    price_usd: 150, price_ngn: 225000, price_usd_yearly: 1500, price_ngn_yearly: 2250000,
    minutes_per_month: 250, videos_per_month: 60, max_video_minutes: 120, voice_clone: true, watermark: false, priority: 3, max_targets: 5,
    lip_sync: true, api_access: false, team_seats: 5, saved_voices: 3, sort: 5, permissions: ALL_ON,
    features: ["Sermons up to 2 hours", "English, French, Yoruba, Hausa & Igbo", "Pastor's saved voice", "Team workspace (5 seats)", "Human review by native speakers", "Short clips for social media"],
  },
  {
    code: "agency", name: "Agency & Nollywood", blurb: "Distributors, studios and agencies with large catalogues.", price_usd: 0, price_ngn: 0,
    price_usd_yearly: 0, price_ngn_yearly: 0, minutes_per_month: 0, videos_per_month: 0, max_video_minutes: 120, voice_clone: true, watermark: false,
    priority: 3, max_targets: 10, lip_sync: true, api_access: true, team_seats: 20, saved_voices: 20, sort: 6, permissions: ALL_ON, contact_sales: true,
    features: ["Custom minutes and pricing", "Feature films and series", "Lip-sync", "Human review and quality checks", "Dedicated account manager"],
  },
];

// Minute packs: never expire, used after the plan's monthly minutes. Admin → Plans can change them.
export const DEFAULT_PACKS = [
  { code: "min_5", minutes: 5, price_usd: 3.5, price_ngn: 5000 },
  { code: "min_15", minutes: 15, price_usd: 9.5, price_ngn: 14500 },
  { code: "min_30", minutes: 30, price_usd: 18.5, price_ngn: 28500 },
  { code: "min_60", minutes: 60, price_usd: 36, price_ngn: 57000 },
];

// Packs sold before minutes existed (one video each), so their old payments can still be fulfilled.
const LEGACY_PACKS = [
  { code: "payg_5", minutes: 5, price_usd: 3, price_ngn: 4800 },
  { code: "payg_15", minutes: 15, price_usd: 5, price_ngn: 8000 },
  { code: "payg_30", minutes: 30, price_usd: 10, price_ngn: 16000 },
  { code: "payg_60", minutes: 60, price_usd: 20, price_ngn: 32000 },
];

const PLAN_COLUMNS = [
  "code", "name", "blurb", "price_usd", "price_ngn", "videos_per_month", "max_video_minutes", "voice_clone", "watermark", "priority",
  "max_targets", "lip_sync", "api_access", "team_seats", "saved_voices", "features_json", "sort", "public", "permissions_json", "contact_sales",
  "minutes_per_month", "price_usd_yearly", "price_ngn_yearly",
];

function seedValues(plan) {
  return [plan.code, plan.name, plan.blurb, plan.price_usd, plan.price_ngn, plan.videos_per_month, plan.max_video_minutes, plan.voice_clone,
    plan.watermark, plan.priority, plan.max_targets, plan.lip_sync, plan.api_access, plan.team_seats, plan.saved_voices,
    JSON.stringify({ features: plan.features, featured: Boolean(plan.featured) }), plan.sort, true, JSON.stringify(plan.permissions), Boolean(plan.contact_sales),
    plan.minutes_per_month, plan.price_usd_yearly, plan.price_ngn_yearly];
}

// Plans created before minutes existed have 0 minutes; they get the profit-checked prices and minutes once.
// Plans an admin has already given minutes to are never touched.
const BACKFILL_FIELDS = [
  "price_usd", "price_ngn", "price_usd_yearly", "price_ngn_yearly", "minutes_per_month", "max_video_minutes", "max_targets", "lip_sync", "sort", "permissions_json",
];
const backfillValue = (plan, field) => (field === "permissions_json" ? JSON.stringify(plan.permissions) : plan[field]);

/** The default plans as SQL, for backend/sql/schema.sql: adds missing plans and fills in minutes for old ones. */
export function planSeedSql() {
  const literal = (value) => (typeof value === "string" ? `'${value.replace(/'/g, "''")}'` : typeof value === "boolean" ? (value ? "TRUE" : "FALSE") : String(value));
  const inserts = DEFAULT_PLANS.map((plan) => `INSERT INTO public.plans (${PLAN_COLUMNS.join(", ")})\n  VALUES (${seedValues(plan).map(literal).join(", ")})\n  ON CONFLICT (code) DO NOTHING;`);
  const backfills = DEFAULT_PLANS.filter((plan) => plan.minutes_per_month > 0).map((plan) => (
    `UPDATE public.plans SET ${BACKFILL_FIELDS.map((field) => `${field} = ${literal(backfillValue(plan, field))}`).join(", ")}\n  WHERE code = ${literal(plan.code)} AND minutes_per_month = 0;`
  ));
  return [...inserts, "-- Plans from before minutes existed get the recommended prices and minutes (only once).", ...backfills];
}

export async function seedPlans() {
  for (const plan of DEFAULT_PLANS) {
    await query(
      `INSERT INTO plans (${PLAN_COLUMNS.join(", ")}) VALUES (${PLAN_COLUMNS.map((_, index) => `$${index + 1}`).join(", ")}) ON CONFLICT (code) DO NOTHING`,
      seedValues(plan),
    );
    if (plan.minutes_per_month > 0) {
      await query(
        `UPDATE plans SET ${BACKFILL_FIELDS.map((field, index) => `${field} = $${index + 1}`).join(", ")} WHERE code = $${BACKFILL_FIELDS.length + 1} AND minutes_per_month = 0`,
        [...BACKFILL_FIELDS.map((field) => backfillValue(plan, field)), plan.code],
      );
    }
  }
}

/**
 * Admin → Plans → "Apply recommended pricing": writes the profit-checked prices and minutes onto the live plans
 * (adding any that are missing). Names, descriptions and features the admin wrote are kept unless `includeText` is set.
 */
export async function applyRecommendedPricing({ includeText = false } = {}) {
  const changed = [];
  for (const plan of DEFAULT_PLANS) {
    const existing = await one("SELECT code FROM plans WHERE code = $1", [plan.code]);
    if (!existing) {
      await query(`INSERT INTO plans (${PLAN_COLUMNS.join(", ")}) VALUES (${PLAN_COLUMNS.map((_, index) => `$${index + 1}`).join(", ")})`, seedValues(plan));
      changed.push({ code: plan.code, action: "added" });
      continue;
    }
    const fields = {
      price_usd: plan.price_usd, price_ngn: plan.price_ngn, price_usd_yearly: plan.price_usd_yearly, price_ngn_yearly: plan.price_ngn_yearly,
      minutes_per_month: plan.minutes_per_month, max_video_minutes: plan.max_video_minutes, max_targets: plan.max_targets,
      voice_clone: plan.voice_clone, watermark: plan.watermark, lip_sync: plan.lip_sync, contact_sales: Boolean(plan.contact_sales), sort: plan.sort,
      permissions_json: JSON.stringify(plan.permissions),
      ...(includeText ? { name: plan.name, blurb: plan.blurb, features_json: JSON.stringify({ features: plan.features, featured: Boolean(plan.featured) }) } : {}),
    };
    const keys = Object.keys(fields);
    await query(`UPDATE plans SET ${keys.map((key, index) => `${key} = $${index + 1}`).join(", ")} WHERE code = $${keys.length + 1}`, [...keys.map((key) => fields[key]), plan.code]);
    changed.push({ code: plan.code, action: "updated" });
  }
  await savePacks(DEFAULT_PACKS);
  return changed;
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
    price_usd_yearly: Number(row.price_usd_yearly || 0),
    price_ngn_yearly: Number(row.price_ngn_yearly || 0),
    minutes_per_month: Number(row.minutes_per_month || 0),
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
  if (plan.code === "free" && config.freeMaxVideoMinutes !== null) plan.max_video_minutes = config.freeMaxVideoMinutes;
  plan.max_video_minutes = Math.min(plan.max_video_minutes, config.maxVideoMinutes);
  plan.features = [...planHeadlines(plan), ...plan.features.filter((feature) => !/per month$|a month$|minutes per video$|per video$/i.test(feature))];
  return plan;
}

/** The allowance lines are generated from the numbers so marketing copy can never disagree with the enforced limits. */
function planHeadlines(plan) {
  if (plan.contact_sales) return [`Videos up to ${plan.max_video_minutes} minutes`];
  const subtitleMinutes = Math.round(plan.minutes_per_month / (config.minuteWeights.subtitles || 0.1));
  return [
    `${plan.minutes_per_month} minutes of dubbing a month (or ${subtitleMinutes} of subtitles)`,
    `Videos up to ${plan.max_video_minutes} minutes`,
  ];
}

export async function listPlans() {
  return (await many("SELECT * FROM plans WHERE public = $1 ORDER BY sort", [true])).map(normalizePlan);
}

export async function listAllPlans() {
  return (await many("SELECT * FROM plans ORDER BY sort, id")).map(normalizePlan);
}

const NUMBER_FIELDS = [
  "price_usd", "price_ngn", "price_usd_yearly", "price_ngn_yearly", "minutes_per_month", "videos_per_month", "max_video_minutes",
  "priority", "max_targets", "team_seats", "saved_voices", "sort",
];
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

// Raw stored values (without env overrides or generated allowance lines) so saving an edit never bakes those in.
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
    values.price_usd_yearly = 0;
    values.price_ngn_yearly = 0;
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

// ---------- Minute packs ----------

function normalizePack(pack) {
  const code = String(pack.code || "").trim().toLowerCase();
  if (!/^[a-z][a-z0-9_-]{1,30}$/.test(code)) throw new Error("Each pack needs a code like min_10.");
  const minutes = Number(pack.minutes);
  const priceUsd = Number(pack.price_usd);
  const priceNgn = Math.round(Number(pack.price_ngn));
  if (!(minutes > 0) || !(priceUsd > 0) || !(priceNgn > 0)) throw new Error(`Pack ${code}: minutes and both prices must be more than 0.`);
  return { code, minutes: Math.round(minutes * 10) / 10, price_usd: Math.round(priceUsd * 100) / 100, price_ngn: priceNgn };
}

export async function listPacks() {
  const row = await one("SELECT value FROM app_settings WHERE key = 'minute_packs'");
  if (!row) return DEFAULT_PACKS;
  try {
    const packs = JSON.parse(row.value);
    return Array.isArray(packs) && packs.length ? packs.map(normalizePack) : DEFAULT_PACKS;
  } catch {
    return DEFAULT_PACKS;
  }
}

export async function savePacks(packs, adminId = null) {
  if (!Array.isArray(packs) || !packs.length || packs.length > 12) throw new Error("Keep between 1 and 12 minute packs.");
  const normalized = packs.map(normalizePack);
  if (new Set(normalized.map((pack) => pack.code)).size !== normalized.length) throw new Error("Each pack needs its own code.");
  await query(
    `INSERT INTO app_settings (key, value, updated_at, updated_by) VALUES ('minute_packs', $1, CURRENT_TIMESTAMP, $2)
     ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = CURRENT_TIMESTAMP, updated_by = $2`,
    [JSON.stringify(normalized), adminId],
  );
  return normalized;
}

/** A pack by code, including packs sold before the current list (so old payments can still be fulfilled). */
export async function getPack(code) {
  return (await listPacks()).find((pack) => pack.code === code) || DEFAULT_PACKS.find((pack) => pack.code === code) || LEGACY_PACKS.find((pack) => pack.code === code) || null;
}
