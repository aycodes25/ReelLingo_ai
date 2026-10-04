import { config } from "./config.js";
import { dbTime, isPostgres, many, one, query } from "./db.js";
import { logger } from "./logger.js";
import { sendEmail } from "./notify.js";
import { listFilesWithSizes, STORAGE_LABELS, storageProvider } from "./storage.js";

/**
 * Paid providers shown on the admin "API usage" dashboard.
 * `unit` is what a manual budget is counted in when the provider can't report its own balance.
 * `freeTier` is the monthly allowance shown until you enter a paid plan (Resend's free plan: 3,000 emails a month).
 */
export const PROVIDERS = [
  { id: "elevenlabs", label: "ElevenLabs", purpose: "Voice cloning, dubbing, multi-speaker transcription", unit: "characters", configured: () => Boolean(config.elevenlabsApiKey) },
  { id: "openai", label: "OpenAI", purpose: "Transcription, translation, titles & hashtags", unit: "usd", configured: () => Boolean(config.openaiApiKey) },
  { id: "sync", label: "sync.so", purpose: "Lip-sync", unit: "usd", configured: () => Boolean(config.syncApiKey) },
  { id: "resend", label: "Resend", purpose: "Email notifications", unit: "emails", configured: () => Boolean(config.resendApiKey), freeTier: { amount: 3000, unit: "emails" } },
  { id: "whatsapp", label: "WhatsApp", purpose: "WhatsApp notifications", unit: "messages", configured: () => Boolean(config.whatsappToken && config.whatsappPhoneNumberId) },
  { id: "storage", label: "Storage", purpose: "Uploaded and dubbed video files", unit: "gb", configured: () => true },
];
const PROVIDER_IDS = new Set(PROVIDERS.map((provider) => provider.id));
export const BUDGET_UNITS = ["usd", "characters", "emails", "messages", "gb", "minutes"];

const GB = 1024 ** 3;
const cache = new Map();

async function cached(key, ttlMs, load) {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  const value = await load();
  cache.set(key, { value, expires: Date.now() + ttlMs });
  return value;
}

export function clearUsageCache() {
  for (const key of [...cache.keys()]) if (!key.startsWith("alerted:")) cache.delete(key);
}

function iso(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const text = String(value);
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text) ? `${text.replace(" ", "T")}Z` : text;
}

function monthStart(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

/** Start of the current billing period: monthly budgets renew on the same day each month as they started. */
export function periodStart(budget, now = new Date()) {
  if (!budget?.started_at) return monthStart(now);
  const started = new Date(iso(budget.started_at));
  if (budget.period !== "monthly") return started;
  const candidate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), Math.min(started.getUTCDate(), 28), started.getUTCHours(), started.getUTCMinutes()));
  if (candidate > now) candidate.setUTCMonth(candidate.getUTCMonth() - 1);
  return candidate < started ? started : candidate;
}

// ---------- Live balances from providers that report them ----------

/** ElevenLabs reports characters used and the plan limit, so its balance is exact. */
async function elevenLabsBalance() {
  if (!config.elevenlabsApiKey) return null;
  return cached("elevenlabs", 60_000, async () => {
    try {
      const response = await fetch("https://api.elevenlabs.io/v1/user/subscription", { headers: { "xi-api-key": config.elevenlabsApiKey } });
      if (!response.ok) return { error: `ElevenLabs answered ${response.status}. Check ELEVENLABS_API_KEY.` };
      const data = await response.json();
      const used = Number(data.character_count || 0);
      const limit = Number(data.character_limit || 0);
      return {
        source: "provider",
        plan: data.tier || null,
        unit: "characters",
        purchased: limit,
        used,
        remaining: Math.max(0, limit - used),
        resets_at: data.next_character_count_reset_unix ? new Date(data.next_character_count_reset_unix * 1000).toISOString() : null,
        voices: data.voice_limit ? { used: Number(data.voice_count ?? 0), limit: Number(data.voice_limit) } : null,
      };
    } catch (error) {
      return { error: `Could not reach ElevenLabs: ${error.message}` };
    }
  });
}

/** OpenAI has no "remaining credit" API, but its Costs API (Admin key) reports what it actually billed. */
async function openAiBilled(since) {
  if (!config.openaiAdminKey) return null;
  const start = Math.floor(since.getTime() / 1000);
  return cached(`openai:${start}`, 10 * 60_000, async () => {
    try {
      let total = 0;
      let page = null;
      for (let guard = 0; guard < 20; guard += 1) {
        const url = new URL("https://api.openai.com/v1/organization/costs");
        url.searchParams.set("start_time", String(start));
        url.searchParams.set("bucket_width", "1d");
        url.searchParams.set("limit", "180");
        if (page) url.searchParams.set("page", page);
        const response = await fetch(url, { headers: { Authorization: `Bearer ${config.openaiAdminKey}` } });
        if (!response.ok) return { error: `OpenAI answered ${response.status}. OPENAI_ADMIN_KEY must be an Admin key (platform.openai.com → Settings → Admin keys).` };
        const data = await response.json();
        for (const bucket of data.data || []) for (const result of bucket.results || []) total += Number(result.amount?.value || 0);
        if (!data.has_more || !data.next_page) break;
        page = data.next_page;
      }
      return { billed_usd: Math.round(total * 10000) / 10000 };
    } catch (error) {
      return { error: `Could not reach OpenAI: ${error.message}` };
    }
  });
}

// ---------- Storage ----------

function ownerOfPath(path, jobsById, jobsByInput) {
  const jobMatch = path.match(/^jobs\/(\d+)\//);
  if (jobMatch) return jobsById.get(Number(jobMatch[1])) || null;
  return jobsByInput.get(path) || null;
}

/** Bytes stored in total and per user. Listing every file is slow, so the result is cached for 10 minutes. */
export async function storageUsage({ fresh = false } = {}) {
  if (fresh) cache.delete("storage");
  return cached("storage", 10 * 60_000, async () => {
    const files = await listFilesWithSizes("");
    const jobs = await many("SELECT id, user_id, input_storage_path FROM jobs");
    const jobsById = new Map(jobs.map((job) => [Number(job.id), job.user_id]));
    const jobsByInput = new Map(jobs.filter((job) => job.input_storage_path).map((job) => [job.input_storage_path, job.user_id]));
    const byUser = new Map();
    let total = 0;
    let unassigned = 0;
    for (const file of files) {
      total += file.size;
      const owner = ownerOfPath(file.path, jobsById, jobsByInput);
      if (owner) byUser.set(owner, (byUser.get(owner) || 0) + file.size);
      else unassigned += file.size;
    }
    return { total_bytes: total, files: files.length, unassigned_bytes: unassigned, by_user: Object.fromEntries(byUser), measured_at: new Date().toISOString() };
  });
}

// ---------- Budgets ----------

function normalizeBudget(row) {
  if (!row) return null;
  return {
    provider: row.provider,
    kind: row.kind,
    amount: Number(row.amount),
    unit: row.unit || (row.kind === "usd" ? "usd" : null),
    period: row.period,
    started_at: iso(row.started_at),
    alert_percent: Number(row.alert_percent),
    notes: row.notes || "",
    last_alert_at: iso(row.last_alert_at),
  };
}

export async function listProviderBudgets() {
  return new Map((await many("SELECT * FROM provider_budgets")).map((row) => [row.provider, normalizeBudget(row)]));
}

export async function setProviderBudget(provider, input) {
  if (!PROVIDER_IDS.has(provider)) throw new Error("Unknown provider.");
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount < 0) throw new Error("Enter how much you bought (a number, 0 or more).");
  const unit = BUDGET_UNITS.includes(input.unit) ? input.unit : PROVIDERS.find((item) => item.id === provider).unit;
  const period = input.period === "one_time" ? "one_time" : "monthly";
  const alert = Math.min(Math.max(Number(input.alert_percent ?? 80), 1), 100);
  // No date given: count from the start of today, so usage earlier today isn't left out.
  const started = new Date(input.started_at || new Date().toISOString().slice(0, 10));
  if (Number.isNaN(started.getTime())) throw new Error("Enter a valid start date.");
  await query(
    `INSERT INTO provider_budgets (provider, kind, amount, unit, period, started_at, alert_percent, notes, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
     ON CONFLICT (provider) DO UPDATE SET kind = $2, amount = $3, unit = $4, period = $5, started_at = $6, alert_percent = $7, notes = $8, last_alert_at = NULL, updated_at = CURRENT_TIMESTAMP`,
    [provider, unit === "usd" ? "usd" : "units", amount, unit, period, dbTime(started), alert, String(input.notes || "").slice(0, 500)],
  );
  return (await listProviderBudgets()).get(provider);
}

export async function deleteProviderBudget(provider) {
  await query("DELETE FROM provider_budgets WHERE provider = $1", [provider]);
}

// ---------- Recorded usage ----------

/** What the app recorded per provider and unit since a date (one row per provider+unit). */
async function recordedByProvider(since) {
  const rows = await many(
    "SELECT provider, unit, SUM(units) AS units, SUM(cost_usd) AS cost, COUNT(*) AS calls FROM cost_events WHERE created_at >= $1 GROUP BY provider, unit",
    [dbTime(since)],
  );
  const result = new Map();
  for (const row of rows) {
    const entry = result.get(row.provider) || { cost_usd: 0, calls: 0, units: {} };
    entry.cost_usd += Number(row.cost || 0);
    entry.calls += Number(row.calls || 0);
    entry.units[row.unit || "units"] = (entry.units[row.unit || "units"] || 0) + Number(row.units || 0);
    result.set(row.provider, entry);
  }
  return result;
}

/** Free storage each provider includes, used when you haven't entered a paid plan yourself. */
export const STORAGE_FREE_GB = { r2: 10, supabase: 1 };

const round = (value, places = 4) => Math.round(Number(value || 0) * 10 ** places) / 10 ** places;

/** One card per provider: bought, used, remaining, and where each number comes from. */
export async function providerSummaries() {
  const budgets = await listProviderBudgets();
  const now = new Date();
  const summaries = [];
  for (const provider of PROVIDERS) {
    const budget = budgets.get(provider.id) || null;
    const since = periodStart(budget, now);
    const recorded = (await recordedByProvider(since)).get(provider.id) || { cost_usd: 0, calls: 0, units: {} };
    const summary = {
      provider: provider.id,
      label: provider.id === "storage" ? STORAGE_LABELS[storageProvider()] : provider.label,
      purpose: provider.purpose,
      configured: provider.configured(),
      period_start: since.toISOString(),
      budget,
      recorded: { cost_usd: round(recorded.cost_usd), calls: recorded.calls, units: Object.fromEntries(Object.entries(recorded.units).map(([unit, value]) => [unit, round(value, 2)])) },
      balance: null,
      warnings: [],
    };

    if (provider.id === "elevenlabs") {
      const live = await elevenLabsBalance();
      if (live?.error) summary.warnings.push(live.error);
      else if (live) summary.balance = live;
    }
    if (provider.id === "openai") {
      const billed = await openAiBilled(since);
      if (billed?.error) summary.warnings.push(billed.error);
      else if (billed) summary.billed_usd = billed.billed_usd;
    }
    if (provider.id === "storage") {
      try {
        const storage = await storageUsage();
        summary.storage = { total_bytes: storage.total_bytes, total_gb: round(storage.total_bytes / GB, 3), files: storage.files, measured_at: storage.measured_at };
      } catch (error) {
        summary.warnings.push(`Could not measure storage: ${error.message}`);
      }
    }

    if (!summary.balance && budget) {
      // Manual budget: remaining = what you bought − what was used since the period started.
      const used = budget.unit === "usd"
        ? (provider.id === "openai" && summary.billed_usd !== undefined ? summary.billed_usd : recorded.cost_usd)
        : budget.unit === "gb"
          ? (summary.storage?.total_bytes ?? 0) / GB
          : recorded.units[budget.unit] || 0;
      summary.balance = {
        source: provider.id === "openai" && summary.billed_usd !== undefined ? "provider_billing" : "recorded",
        unit: budget.unit,
        purchased: budget.amount,
        used: round(used, budget.unit === "usd" ? 4 : budget.unit === "gb" ? 6 : 2),
        remaining: round(Math.max(0, budget.amount - used), budget.unit === "usd" ? 4 : budget.unit === "gb" ? 6 : 2),
        resets_at: budget.period === "monthly" ? new Date(Date.UTC(since.getUTCFullYear(), since.getUTCMonth() + 1, since.getUTCDate(), since.getUTCHours(), since.getUTCMinutes())).toISOString() : null,
      };
    }
    const freeGb = STORAGE_FREE_GB[storageProvider()];
    if (provider.id === "storage" && !summary.balance && freeGb && summary.storage) {
      // No paid plan entered: measure against the provider's free tier.
      summary.balance = {
        source: "free_tier",
        unit: "gb",
        purchased: freeGb,
        used: round(summary.storage.total_bytes / GB, 6),
        remaining: round(Math.max(0, freeGb - summary.storage.total_bytes / GB), 6),
        resets_at: null,
      };
    }
    if (!summary.balance && provider.freeTier && summary.configured) {
      const used = recorded.units[provider.freeTier.unit] || 0;
      summary.balance = {
        source: "free_tier",
        unit: provider.freeTier.unit,
        purchased: provider.freeTier.amount,
        used,
        remaining: Math.max(0, provider.freeTier.amount - used),
        resets_at: new Date(Date.UTC(since.getUTCFullYear(), since.getUTCMonth() + 1, 1)).toISOString(),
      };
    }
    if (summary.balance && summary.balance.purchased > 0) {
      summary.balance.percent_used = Math.min(100, round((summary.balance.used / summary.balance.purchased) * 100, 1));
      const alertAt = budget?.alert_percent ?? 80;
      summary.balance.status = summary.balance.percent_used >= 100 ? "empty" : summary.balance.percent_used >= alertAt ? "low" : "ok";
    }
    summaries.push(summary);
  }
  return summaries;
}

// ---------- Per user ----------

function dayExpression() {
  return isPostgres ? "to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')" : "substr(created_at, 1, 10)";
}

/** Daily cost per provider, for the trend chart. */
export async function dailyUsage(days = 30) {
  const since = new Date(Date.now() - days * 86400000);
  const rows = await many(
    `SELECT ${dayExpression()} AS day, provider, SUM(cost_usd) AS cost, SUM(units) AS units FROM cost_events WHERE created_at >= $1 GROUP BY 1, provider ORDER BY 1`,
    [dbTime(since)],
  );
  return rows.map((row) => ({ day: row.day, provider: row.provider, cost_usd: round(row.cost), units: round(row.units, 2) }));
}

export async function listUserBudgets() {
  return new Map((await many("SELECT * FROM user_budgets")).map((row) => [row.user_id, {
    monthly_usd_cap: row.monthly_usd_cap === null ? null : Number(row.monthly_usd_cap),
    monthly_characters_cap: row.monthly_characters_cap === null ? null : Number(row.monthly_characters_cap),
    notes: row.notes || "",
  }]));
}

/** Usage per user since a date: cost, voice characters, minutes, tokens, messages, plus storage and budget. */
export async function usageByUser({ days = 30 } = {}) {
  const since = new Date(Date.now() - days * 86400000);
  const rows = await many(
    `SELECT cost_events.user_id, profiles.email, profiles.name, provider, unit, SUM(units) AS units, SUM(cost_usd) AS cost, COUNT(DISTINCT job_id) AS jobs
     FROM cost_events LEFT JOIN profiles ON profiles.user_id = cost_events.user_id
     WHERE cost_events.created_at >= $1 AND cost_events.user_id IS NOT NULL
     GROUP BY cost_events.user_id, profiles.email, profiles.name, provider, unit`,
    [dbTime(since)],
  );
  const budgets = await listUserBudgets();
  const month = await monthUsageByUser();
  let storage = { by_user: {} };
  try {
    storage = await storageUsage();
  } catch {
    // storage unavailable: show the rest
  }
  const users = new Map();
  for (const row of rows) {
    const user = users.get(row.user_id) || { user_id: row.user_id, email: row.email || "", name: row.name || "", cost_usd: 0, providers: {}, jobs: 0 };
    user.cost_usd += Number(row.cost || 0);
    user.jobs = Math.max(user.jobs, Number(row.jobs || 0));
    const provider = user.providers[row.provider] || { cost_usd: 0, units: {} };
    provider.cost_usd = round(provider.cost_usd + Number(row.cost || 0));
    provider.units[row.unit || "units"] = round((provider.units[row.unit || "units"] || 0) + Number(row.units || 0), 2);
    user.providers[row.provider] = provider;
    users.set(row.user_id, user);
  }
  for (const [userId, budget] of budgets) {
    if (!users.has(userId)) {
      const profile = await one("SELECT email, name FROM profiles WHERE user_id = $1", [userId]);
      users.set(userId, { user_id: userId, email: profile?.email || "", name: profile?.name || "", cost_usd: 0, providers: {}, jobs: 0 });
    }
    users.get(userId).budget = budget;
  }
  return [...users.values()].map((user) => ({
    ...user,
    cost_usd: round(user.cost_usd),
    storage_bytes: storage.by_user[user.user_id] || 0,
    storage_gb: round((storage.by_user[user.user_id] || 0) / GB, 3),
    budget: user.budget ? budgetStatus(user.budget, month.get(user.user_id)) : null,
  })).sort((first, second) => second.cost_usd - first.cost_usd);
}

async function monthUsageByUser() {
  const rows = await many(
    `SELECT user_id, SUM(cost_usd) AS cost, SUM(CASE WHEN provider = 'elevenlabs' AND unit = 'characters' THEN units ELSE 0 END) AS characters
     FROM cost_events WHERE created_at >= $1 AND user_id IS NOT NULL GROUP BY user_id`,
    [dbTime(monthStart())],
  );
  return new Map(rows.map((row) => [row.user_id, { cost_usd: Number(row.cost || 0), characters: Number(row.characters || 0) }]));
}

function budgetStatus(budget, used = { cost_usd: 0, characters: 0 }) {
  const usd = budget.monthly_usd_cap === null ? null : { cap: budget.monthly_usd_cap, used: round(used.cost_usd), remaining: round(Math.max(0, budget.monthly_usd_cap - used.cost_usd)) };
  const characters = budget.monthly_characters_cap === null ? null : { cap: budget.monthly_characters_cap, used: Math.round(used.characters), remaining: Math.max(0, budget.monthly_characters_cap - Math.round(used.characters)) };
  return { ...budget, usd, characters, exceeded: Boolean((usd && usd.remaining <= 0) || (characters && characters.remaining <= 0)) };
}

/** A single user's budget and this month's use. Used to stop new jobs once a cap is reached. */
export async function userBudgetStatus(userId) {
  const budget = (await listUserBudgets()).get(userId);
  if (!budget) return null;
  return budgetStatus(budget, (await monthUsageByUser()).get(userId));
}

export async function setUserBudget(userId, input) {
  const parse = (value, label) => {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) throw new Error(`${label} must be a number, 0 or more.`);
    return number;
  };
  const usd = parse(input.monthly_usd_cap, "Monthly $ limit");
  const characters = parse(input.monthly_characters_cap, "Monthly voice-character limit");
  if (usd === null && characters === null) {
    await query("DELETE FROM user_budgets WHERE user_id = $1", [userId]);
    return null;
  }
  await query(
    `INSERT INTO user_budgets (user_id, monthly_usd_cap, monthly_characters_cap, notes, updated_at) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
     ON CONFLICT (user_id) DO UPDATE SET monthly_usd_cap = $2, monthly_characters_cap = $3, notes = $4, updated_at = CURRENT_TIMESTAMP`,
    [userId, usd, characters === null ? null : Math.round(characters), String(input.notes || "").slice(0, 500)],
  );
  return userBudgetStatus(userId);
}

/** One user's usage broken down by project and by operation. */
export async function userUsageDetail(userId, { days = 30 } = {}) {
  const since = new Date(Date.now() - days * 86400000);
  const byJob = await many(
    `SELECT cost_events.job_id, jobs.original_filename, jobs.target_language, provider, unit, SUM(units) AS units, SUM(cost_usd) AS cost, MIN(cost_events.created_at) AS first_at
     FROM cost_events LEFT JOIN jobs ON jobs.id = cost_events.job_id
     WHERE cost_events.user_id = $1 AND cost_events.created_at >= $2
     GROUP BY cost_events.job_id, jobs.original_filename, jobs.target_language, provider, unit`,
    [userId, dbTime(since)],
  );
  const byOperation = await many(
    "SELECT provider, operation, unit, SUM(units) AS units, SUM(cost_usd) AS cost, COUNT(*) AS calls FROM cost_events WHERE user_id = $1 AND created_at >= $2 GROUP BY provider, operation, unit ORDER BY 5 DESC",
    [userId, dbTime(since)],
  );
  const jobs = new Map();
  for (const row of byJob) {
    const key = row.job_id === null ? "none" : String(row.job_id);
    const job = jobs.get(key) || { job_id: row.job_id === null ? null : Number(row.job_id), file: row.original_filename || (row.job_id === null ? "Messages (not tied to a project)" : `Project #${row.job_id}`), target_language: row.target_language || null, cost_usd: 0, units: {}, first_at: iso(row.first_at) };
    job.cost_usd = round(job.cost_usd + Number(row.cost || 0));
    const unitKey = `${row.provider}:${row.unit || "units"}`;
    job.units[unitKey] = round((job.units[unitKey] || 0) + Number(row.units || 0), 2);
    jobs.set(key, job);
  }
  let storageBytes = 0;
  try {
    storageBytes = (await storageUsage()).by_user[userId] || 0;
  } catch {
    // ignore
  }
  return {
    user_id: userId,
    days,
    jobs: [...jobs.values()].sort((first, second) => second.cost_usd - first.cost_usd),
    operations: byOperation.map((row) => ({ provider: row.provider, operation: row.operation, unit: row.unit, units: round(row.units, 2), cost_usd: round(row.cost), calls: Number(row.calls) })),
    total_cost_usd: round([...jobs.values()].reduce((sum, job) => sum + job.cost_usd, 0)),
    storage_bytes: storageBytes,
    storage_gb: round(storageBytes / GB, 3),
    budget: await userBudgetStatus(userId),
  };
}

// ---------- Alerts ----------

/** Emails the admins once per billing period when a provider balance passes its alert level. */
export async function checkLowBalances() {
  if (!config.resendApiKey || !config.adminEmails.length) return 0;
  let sent = 0;
  for (const summary of await providerSummaries()) {
    const balance = summary.balance;
    if (!balance || !["low", "empty"].includes(balance.status)) continue;
    const budget = summary.budget;
    const alreadyAlerted = budget?.last_alert_at && new Date(budget.last_alert_at) >= new Date(summary.period_start);
    const autoAlert = cache.get(`alerted:${summary.provider}`);
    const recentlyAlertedAuto = !budget && autoAlert && autoAlert.expires > Date.now();
    if (alreadyAlerted || recentlyAlertedAuto) continue;
    const unit = balance.unit === "usd" ? "$" : ` ${balance.unit}`;
    const text = `${summary.label} is ${balance.status === "empty" ? "used up" : "running low"}: ${balance.percent_used}% used, ${balance.unit === "usd" ? `$${balance.remaining}` : `${balance.remaining}${unit}`} left. Top up or check Admin → API usage.`;
    for (const to of config.adminEmails) {
      await sendEmail({ to, subject: `ReelLingo: ${summary.label} balance ${balance.status === "empty" ? "used up" : "low"}`, text, html: `<p>${text}</p>`, operation: "admin_alert" }).catch((error) => logger.warn({ err: error }, "Low-balance alert failed"));
    }
    if (budget) await query("UPDATE provider_budgets SET last_alert_at = CURRENT_TIMESTAMP WHERE provider = $1", [summary.provider]);
    else cache.set(`alerted:${summary.provider}`, { value: true, expires: Date.now() + 24 * 3600 * 1000 });
    sent += 1;
  }
  return sent;
}
