import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const dataDirectory = await mkdtemp(join(tmpdir(), "reellingo-admin-"));
Object.assign(process.env, {
  // API keys and teams are hidden by default; these tests use them.
  FEATURE_API: "true",
  FEATURE_TEAMS: "true",
  MOCK_MODE: "false",
  OPENAI_API_KEY: "test-openai",
  ELEVENLABS_API_KEY: "test-elevenlabs",
  SUPABASE_URL: "",
  SUPABASE_KEY: "",
  WORKER_MODE: "off",
  FREE_VIDEOS_PER_MONTH: "",
  FREE_MAX_VIDEO_MINUTES: "",
  MAX_VIDEO_MINUTES: "60",
  ADMIN_EMAILS: "boss@example.com",
  RESEND_API_KEY: "",
  DATABASE_URL: `sqlite:///${join(dataDirectory, "jobs.db").replaceAll("\\", "/")}`,
  LOCAL_STORAGE_DIR: join(dataDirectory, "storage"),
});

const { app } = await import("../server.js");
const database = await import("../src/database.js");
const { createApiKey } = await import("../src/auth.js");
const { activateSubscription } = await import("../src/billing.js");
const { ensureProfile, planFor } = await import("../src/accounts.js");
const { config } = await import("../src/config.js");

test("admins control settings, plans and user accounts", async (context) => {
  await database.initializeDatabase();
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  context.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await database.closeDatabase();
    await rm(dataDirectory, { recursive: true, force: true });
  });

  // An admin (from ADMIN_EMAILS) and a regular creator, both using API keys (Studio plan) to talk to the API.
  await ensureProfile("boss", "boss@example.com");
  await ensureProfile("creator", "creator@example.com");
  await activateSubscription("boss", "studio");
  await activateSubscription("creator", "studio");
  const admin = { Authorization: `Bearer ${(await createApiKey("boss", "admin")).key}`, "Content-Type": "application/json" };
  const creator = { Authorization: `Bearer ${(await createApiKey("creator", "creator")).key}`, "Content-Type": "application/json" };
  const call = (path, headers, method = "GET", body) => fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });

  assert.equal((await call("/admin/settings", creator)).status, 403, "regular users can't open admin endpoints");

  // Settings: switching a feature off blocks it for everyone, instantly.
  const settings = await call("/admin/settings", admin).then((response) => response.json());
  assert.ok(settings.some((setting) => setting.key === "feature_link_import" && setting.value === true));
  await call("/admin/settings", admin, "PUT", { feature_link_import: false, announcement: "New voices this week!" });
  const blocked = await call("/jobs", creator, "POST", { source_url: "https://example.com/video.mp4", source_language: "yo", target_languages: "en", rights_confirmed: true, voice_consent: true });
  assert.equal(blocked.status, 403);
  assert.equal((await blocked.json()).code, "feature_disabled");
  const health = await fetch(`${base}/health`).then((response) => response.json());
  assert.equal(health.settings.announcement.text, "New voices this week!");
  assert.equal(health.settings.features.link_import, false);
  assert.equal((await call("/admin/settings", admin, "PUT", { max_video_minutes: 0 })).status, 400, "invalid values are rejected");
  await call("/admin/settings", admin, "PUT", { feature_link_import: null });
  assert.equal(config.featureLinkImport, true, "null resets a setting to its .env default");

  // Maintenance mode blocks creators but not admins.
  await call("/admin/settings", admin, "PUT", { maintenance_mode: true });
  const paused = await call("/jobs", creator, "POST", { source_url: "https://example.com/video.mp4", source_language: "yo", target_languages: "en", rights_confirmed: true, voice_consent: true });
  assert.equal(paused.status, 503);
  assert.equal((await paused.json()).code, "maintenance");
  const adminDuringMaintenance = await call("/jobs", admin, "POST", { source_url: "https://example.com/video.mp4", source_language: "yo", target_languages: "en", rights_confirmed: true, voice_consent: true });
  assert.equal(adminDuringMaintenance.status, 201, await adminDuringMaintenance.clone().text());
  await call("/admin/settings", admin, "PUT", { maintenance_mode: false });

  // Sign-ups can be closed.
  await call("/admin/settings", admin, "PUT", { signups_enabled: false });
  const signup = await fetch(`${base}/auth/signup`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "new@example.com", password: "password123" }) });
  assert.equal(signup.status, 403);
  await call("/admin/settings", admin, "PUT", { signups_enabled: true });

  // Plans: edit what a plan includes; the change is enforced on the next upload.
  const plans = await call("/admin/plans", admin).then((response) => response.json());
  assert.deepEqual(plans.plans.map((plan) => plan.code), ["free", "subtitles", "starter", "creator", "studio", "ministry", "agency"]);
  assert.equal(plans.plans.find((plan) => plan.code === "studio").subscribers, 2);
  const studio = plans.plans.find((plan) => plan.code === "studio");
  const edited = await call("/admin/plans/studio", admin, "PUT", { ...studio, price_ngn: 150000, permissions: { ...studio.permissions, link_import: false } }).then((response) => response.json());
  assert.equal(edited.price_ngn, 150000);
  assert.equal(edited.permissions.link_import, false);
  const notInPlan = await call("/jobs", creator, "POST", { source_url: "https://example.com/video.mp4", source_language: "yo", target_languages: "en", rights_confirmed: true, voice_consent: true });
  assert.equal(notInPlan.status, 402);
  assert.equal((await notInPlan.json()).feature, "link_import");
  await call("/admin/plans/studio", admin, "PUT", { ...studio });

  // A custom "contact sales" plan can be created, is shown publicly, but can't be bought online.
  const enterprise = await call("/admin/plans", admin, "POST", {
    code: "enterprise", name: "Enterprise", blurb: "Custom terms", price_usd: 500, price_ngn: 800000, videos_per_month: 200, max_video_minutes: 60,
    voice_clone: true, max_targets: 10, team_seats: 20, saved_voices: 10, lip_sync: true, api_access: true, contact_sales: true, public: true, sort: 4,
    features: "Dedicated account manager\nCustom voices",
  });
  assert.equal(enterprise.status, 201, await enterprise.clone().text());
  const publicPlans = await fetch(`${base}/plans`).then((response) => response.json());
  assert.ok(publicPlans.plans.some((plan) => plan.code === "enterprise" && plan.contact_sales));
  assert.equal((await call("/admin/plans/free", admin, "DELETE")).status, 400, "the free plan can't be deleted");

  // Users: create an account on a plan, give custom limits and credits, suspend, then delete.
  const created = await call("/admin/users", admin, "POST", { email: "Agency@Example.com", name: "Lagos Agency", plan: "enterprise", months: 12 }).then((response) => response.json());
  const agencyId = created.user.user_id;
  assert.equal(created.user.plan.code, "enterprise");
  assert.equal(created.user.email, "agency@example.com");
  const list = await call("/admin/users?q=agency", admin).then((response) => response.json());
  assert.equal(list.total, 1);
  assert.equal(list.users[0].plan, "enterprise");

  const customised = await call(`/admin/users/${agencyId}`, admin, "PATCH", { overrides: { minutes_per_month: 500, permissions: { youtube: false } }, admin_notes: "Signed annual contract" }).then((response) => response.json());
  assert.equal(customised.plan.minutes_per_month, 500);
  assert.equal(customised.plan.permissions.youtube, false);
  assert.equal(customised.admin_notes, "Signed annual contract");
  assert.equal((await planFor({ userId: agencyId })).minutes.plan_allowance, 500, "custom limits apply to uploads");

  // Minutes: an admin can add never-expiring minutes (or take some back), and every change is in the history.
  const withMinutes = await call(`/admin/users/${agencyId}/minutes`, admin, "POST", { minutes: 30, note: "Welcome gift" }).then((response) => response.json());
  assert.equal(withMinutes.minutes.topup_left, 30);
  assert.equal(withMinutes.ledger[0].note, "Welcome gift");
  const fewer = await call(`/admin/users/${agencyId}/minutes`, admin, "POST", { minutes: -10 }).then((response) => response.json());
  assert.equal(fewer.minutes.topup_left, 20);
  assert.equal((await call(`/admin/users/${agencyId}/minutes`, admin, "POST", { minutes: "lots" })).status, 400);

  // Reviewers: any account can be made a native-speaker reviewer for chosen languages.
  const reviewer = await call(`/admin/users/${agencyId}/reviewer`, admin, "PUT", { is_reviewer: true, languages: ["yo", "ha"] }).then((response) => response.json());
  assert.equal(reviewer.is_reviewer, true);
  assert.deepEqual(reviewer.reviewer_languages, ["yo", "ha"]);
  assert.equal((await call(`/admin/users/${agencyId}/reviewer`, admin, "PUT", { is_reviewer: true, languages: [] })).status, 400);

  // Profit check: with the recommended prices, no plan or pack can lose money even if every minute is used.
  const profit = await call("/admin/profit", admin).then((response) => response.json());
  assert.deepEqual(profit.warnings, []);
  const starter = profit.rows.find((row) => row.code === "starter" && row.cycle === "monthly");
  assert.ok(starter.ngn.worst_profit > 0 && starter.usd.worst_profit > 0);
  assert.ok(starter.ngn.typical_margin > 60, "typical customers leave a healthy margin");
  assert.ok(profit.rows.filter((row) => row.ngn?.revenue).every((row) => row.ngn.worst_profit > 0 && row.usd.worst_profit > 0));
  assert.ok(profit.addons.every((addon) => addon.worst_profit_ngn >= 0));
  // A plan priced too low is flagged straight away.
  const cheapStarter = await call("/admin/plans/starter", admin, "PUT", { ...plans.plans.find((plan) => plan.code === "starter"), price_ngn: 5000 }).then((response) => response.json());
  assert.equal(cheapStarter.price_ngn, 5000);
  assert.ok((await call("/admin/profit", admin).then((response) => response.json())).warnings.some((warning) => /Starter \(monthly, ₦\)/.test(warning)));
  const applied = await call("/admin/plans/apply-recommended", admin, "POST", {}).then((response) => response.json());
  assert.ok(applied.changed.some((change) => change.code === "starter" && change.action === "updated"));
  assert.deepEqual(applied.report.warnings, []);

  // Minute packs can be edited, and bad packs are refused.
  const packs = await call("/admin/packs", admin).then((response) => response.json());
  assert.equal(packs.packs.length, 4);
  const savedPacks = await call("/admin/packs", admin, "PUT", { packs: [...packs.packs, { code: "min_120", minutes: 120, price_usd: 70, price_ngn: 110000 }] }).then((response) => response.json());
  assert.equal(savedPacks.packs.length, 5);
  assert.equal((await call("/admin/packs", admin, "PUT", { packs: [{ code: "x", minutes: 0, price_usd: 1, price_ngn: 1 }] })).status, 400);

  // Deleting the enterprise plan moves its subscribers to another plan.
  const removed = await call("/admin/plans/enterprise?move_to=creator", admin, "DELETE").then((response) => response.json());
  assert.equal(removed.moved, 1);
  assert.equal((await call(`/admin/users/${agencyId}`, admin).then((response) => response.json())).plan.code, "creator");

  // Suspending a user locks them out immediately; admins can't suspend themselves.
  await call("/admin/users/creator", admin, "PATCH", { disabled: true });
  const suspended = await call("/jobs", creator);
  assert.equal(suspended.status, 403);
  assert.equal((await suspended.json()).code, "suspended");
  assert.equal((await call("/admin/users/boss", admin, "PATCH", { disabled: true })).status, 400);
  await call("/admin/users/creator", admin, "PATCH", { disabled: false });
  assert.equal((await call("/jobs", creator)).status, 200);

  // Promoting a user to admin from the database works without editing .env.
  await call("/admin/users/creator", admin, "PATCH", { is_admin: true });
  assert.equal((await call("/admin/settings", creator)).status, 200);

  // Email follow-up explains what's missing when email isn't configured.
  const email = await call(`/admin/users/${agencyId}/email`, admin, "POST", { subject: "Hi", message: "Welcome aboard" });
  assert.equal(email.status, 400);
  assert.match((await email.json()).detail, /RESEND_API_KEY/);

  const deleted = await call(`/admin/users/${agencyId}`, admin, "DELETE").then((response) => response.json());
  assert.equal(deleted.deleted, true);
  assert.equal((await call(`/admin/users/${agencyId}`, admin)).status, 404);
  assert.equal((await call("/admin/users/boss", admin, "DELETE")).status, 400, "admins can't delete themselves");
});
