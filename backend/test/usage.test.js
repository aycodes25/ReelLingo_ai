import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const dataDirectory = await mkdtemp(join(tmpdir(), "reellingo-usage-"));
Object.assign(process.env, {
  MOCK_MODE: "false",
  OPENAI_API_KEY: "test-openai",
  OPENAI_ADMIN_KEY: "",
  ELEVENLABS_API_KEY: "test-elevenlabs",
  SUPABASE_URL: "",
  SUPABASE_KEY: "",
  WORKER_MODE: "off",
  ADMIN_EMAILS: "boss@example.com",
  RESEND_API_KEY: "test-resend",
  FREE_VIDEOS_PER_MONTH: "",
  FREE_MAX_VIDEO_MINUTES: "",
  DATABASE_URL: `sqlite:///${join(dataDirectory, "jobs.db").replaceAll("\\", "/")}`,
  LOCAL_STORAGE_DIR: join(dataDirectory, "storage"),
});

// Providers are mocked: ElevenLabs reports its own balance, Resend accepts emails.
const realFetch = globalThis.fetch;
const sentEmails = [];
globalThis.fetch = async (url, options = {}) => {
  const href = String(url);
  if (href === "https://api.elevenlabs.io/v1/user/subscription") {
    return Response.json({ tier: "creator", character_count: 250000, character_limit: 275000, next_character_count_reset_unix: 1893456000, voice_count: 3, voice_limit: 30 });
  }
  if (href === "https://api.resend.com/emails") {
    sentEmails.push(JSON.parse(options.body));
    return Response.json({ id: "email-1" });
  }
  return realFetch(url, options);
};

const { app } = await import("../server.js");
const database = await import("../src/database.js");
const { createApiKey } = await import("../src/auth.js");
const { activateSubscription } = await import("../src/billing.js");
const { ensureProfile } = await import("../src/accounts.js");
const { recordUsage } = await import("../src/costs.js");
const { uploadBuffer } = await import("../src/storage.js");
const { checkLowBalances, clearUsageCache, periodStart } = await import("../src/usage.js");

test("the API usage dashboard shows balances, usage per user, budgets and alerts", async (context) => {
  await database.initializeDatabase();
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  context.after(async () => {
    globalThis.fetch = realFetch;
    await new Promise((resolve) => server.close(resolve));
    await database.closeDatabase();
    await rm(dataDirectory, { recursive: true, force: true });
  });

  await ensureProfile("boss", "boss@example.com");
  await ensureProfile("ade", "ade@example.com");
  await ensureProfile("kemi", "kemi@example.com");
  await activateSubscription("boss", "studio");
  await activateSubscription("ade", "studio");
  const admin = { Authorization: `Bearer ${(await createApiKey("boss", "admin")).key}`, "Content-Type": "application/json" };
  const ade = { Authorization: `Bearer ${(await createApiKey("ade", "ade")).key}`, "Content-Type": "application/json" };
  const call = (path, headers, method = "GET", body) => fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });

  // Usage recorded while dubbing: Ade made two projects, Kemi one.
  const adeJob = await database.createJob({ user_id: "ade", source_language: "yo", target_language: "en", input_storage_path: "uploads/ade.mp4", original_filename: "Lagos.mp4", options_json: {} });
  const adeJob2 = await database.createJob({ user_id: "ade", source_language: "yo", target_language: "fr", input_storage_path: "uploads/ade.mp4", original_filename: "Lagos.mp4", options_json: {} });
  const kemiJob = await database.createJob({ user_id: "kemi", source_language: "ha", target_language: "en", input_storage_path: "uploads/kemi.mp4", original_filename: "Kano.mp4", options_json: {} });
  await recordUsage({ provider: "elevenlabs", operation: "speech", units: 40000, unit: "characters", costUsd: 3.2, userId: "ade", jobId: adeJob.id });
  await recordUsage({ provider: "elevenlabs", operation: "speech", units: 10000, unit: "characters", costUsd: 0.8, userId: "ade", jobId: adeJob2.id });
  await recordUsage({ provider: "openai", operation: "transcription", units: 60, unit: "minutes", costUsd: 0.36, userId: "ade", jobId: adeJob.id });
  await recordUsage({ provider: "openai", operation: "transcription", units: 10, unit: "minutes", costUsd: 0.06, userId: "kemi", jobId: kemiJob.id });
  await recordUsage({ provider: "elevenlabs", operation: "speech", units: 5000, unit: "characters", costUsd: 0.4, userId: "kemi", jobId: kemiJob.id });

  // Storage: Ade's upload (shared by both jobs) and an output file.
  await uploadBuffer("uploads/ade.mp4", Buffer.alloc(3000));
  await uploadBuffer(`jobs/${adeJob.id}/output.mp4`, Buffer.alloc(2000));
  await uploadBuffer("uploads/kemi.mp4", Buffer.alloc(1000));

  // OpenAI can't report its balance, so the owner enters what they bought.
  const budget = await call("/admin/usage/budgets/openai", admin, "PUT", { amount: 10, unit: "usd", period: "monthly", alert_percent: 3 }).then((response) => response.json());
  assert.equal(budget.amount, 10);
  assert.equal((await call("/admin/usage/budgets/nope", admin, "PUT", { amount: 1 })).status, 400);

  const usage = await call("/admin/usage", admin).then((response) => response.json());
  const eleven = usage.providers.find((provider) => provider.provider === "elevenlabs");
  assert.equal(eleven.balance.source, "provider", "ElevenLabs reports its own balance");
  assert.equal(eleven.balance.remaining, 25000);
  assert.equal(eleven.balance.percent_used, 90.9);
  assert.equal(eleven.balance.status, "low");
  assert.equal(eleven.recorded.units.characters, 55000, "the app's own record of characters used");

  const openai = usage.providers.find((provider) => provider.provider === "openai");
  assert.equal(openai.balance.source, "recorded");
  assert.equal(openai.balance.used, 0.42);
  assert.equal(openai.balance.remaining, 9.58);
  assert.equal(openai.balance.status, "low", "4.2% used is past the 3% alert level");

  const storage = usage.providers.find((provider) => provider.provider === "storage");
  assert.equal(storage.storage.files, 3);
  assert.equal(storage.storage.total_bytes, 6000);

  assert.deepEqual(usage.users.map((user) => user.email), ["ade@example.com", "kemi@example.com"], "heaviest user first");
  const adeRow = usage.users[0];
  assert.equal(adeRow.cost_usd, 4.36);
  assert.equal(adeRow.providers.elevenlabs.units.characters, 50000);
  assert.equal(adeRow.providers.openai.units.minutes, 60);
  assert.equal(adeRow.storage_bytes, 5000, "Ade's upload and output file");
  assert.equal(usage.totals.users, 2);
  assert.ok(usage.daily.some((day) => day.provider === "elevenlabs" && day.cost_usd > 0));

  const detail = await call("/admin/usage/users/ade", admin).then((response) => response.json());
  assert.equal(detail.jobs.length, 2);
  assert.equal(detail.total_cost_usd, 4.36);
  assert.equal(detail.jobs[0].units["elevenlabs:characters"], 40000);
  assert.ok(detail.operations.some((operation) => operation.operation === "transcription" && operation.units === 60));

  // A monthly cap for Ade: they've used $4.36, so a $4 cap stops new jobs.
  const capped = await call("/admin/usage/user-budgets/ade", admin, "PUT", { monthly_usd_cap: 4 }).then((response) => response.json());
  assert.equal(capped.budget.exceeded, true);
  assert.equal(capped.budget.usd.remaining, 0);
  const blocked = await call("/jobs", ade, "POST", { source_url: "https://www.youtube.com/watch?v=x", source_language: "yo", target_languages: "en" });
  assert.equal(blocked.status, 402);
  assert.equal((await blocked.json()).code, "budget");
  await call("/admin/usage/user-budgets/ade", admin, "PUT", { monthly_usd_cap: 50, monthly_characters_cap: 100000 });
  const allowed = await call("/jobs", ade, "POST", { source_url: "https://www.youtube.com/watch?v=x", source_language: "yo", target_languages: "en" });
  assert.equal(allowed.status, 201);
  const withBudget = await call("/admin/usage", admin).then((response) => response.json());
  assert.equal(withBudget.users.find((user) => user.user_id === "ade").budget.characters.remaining, 50000);
  const cleared = await call("/admin/usage/user-budgets/ade", admin, "PUT", { monthly_usd_cap: "", monthly_characters_cap: "" }).then((response) => response.json());
  assert.equal(cleared.budget, null);

  // Low-balance alerts: one email per admin per period, and the emails themselves are counted.
  clearUsageCache();
  assert.equal(await checkLowBalances(), 2, "ElevenLabs and OpenAI are both past their alert levels");
  assert.equal(sentEmails.length, 2);
  assert.match(sentEmails[0].subject, /balance low/);
  assert.equal(await checkLowBalances(), 0, "no repeat alert in the same period");
  clearUsageCache();
  const afterAlerts = await call("/admin/usage", admin).then((response) => response.json());
  assert.equal(afterAlerts.providers.find((provider) => provider.provider === "resend").recorded.units.emails, 2);

  assert.equal((await call("/admin/usage", ade)).status, 403, "only admins see usage");
});

test("monthly budgets renew on the day they started", () => {
  const budget = { started_at: "2026-08-15T00:00:00.000Z", period: "monthly" };
  assert.equal(periodStart(budget, new Date("2026-10-03T12:00:00Z")).toISOString(), "2026-09-15T00:00:00.000Z");
  assert.equal(periodStart(budget, new Date("2026-10-20T12:00:00Z")).toISOString(), "2026-10-15T00:00:00.000Z");
  assert.equal(periodStart({ started_at: "2026-09-01T00:00:00.000Z", period: "one_time" }, new Date("2026-12-01T00:00:00Z")).toISOString(), "2026-09-01T00:00:00.000Z");
});
