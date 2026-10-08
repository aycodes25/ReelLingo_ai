import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

// A stand-in for OpenAI that always answers "bad request" (the real SDK doesn't use the global fetch).
const openaiHits = [];
const fakeOpenAi = createServer((request, response) => {
  openaiHits.push(request.url);
  response.writeHead(400, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ error: { message: "bad request" } }));
});
await new Promise((resolve) => fakeOpenAi.listen(0, "127.0.0.1", resolve));

const dataDirectory = await mkdtemp(join(tmpdir(), "reellingo-hardening-"));
Object.assign(process.env, {
  OPENAI_BASE_URL: `http://127.0.0.1:${fakeOpenAi.address().port}/v1`,
  FEATURE_API: "true",
  FEATURE_TEAMS: "true",
  MOCK_MODE: "false",
  OPENAI_API_KEY: "test-openai",
  ELEVENLABS_API_KEY: "test-elevenlabs",
  PAYSTACK_SECRET_KEY: "paystack-test-secret",
  STRIPE_SECRET_KEY: "stripe-test-secret",
  SUPABASE_URL: "",
  SUPABASE_KEY: "",
  WORKER_MODE: "off",
  MAX_VIDEO_MINUTES: "120",
  ADMIN_EMAILS: "boss@example.com",
  RESEND_API_KEY: "",
  DATABASE_URL: `sqlite:///${join(dataDirectory, "jobs.db").replaceAll("\\", "/")}`,
  LOCAL_STORAGE_DIR: join(dataDirectory, "storage"),
});

// Nothing in these tests may reach a real provider: every outside call is answered here (or fails the test).
const realFetch = globalThis.fetch;
const handlers = [];
globalThis.fetch = async (url, options = {}) => {
  const text = String(url);
  if (text.startsWith("http://127.0.0.1")) return realFetch(url, options);
  const handler = handlers.find((item) => text.startsWith(item.prefix));
  if (!handler) throw new Error(`Unexpected outside call: ${text}`);
  handler.calls.push({ url: text, options });
  return handler.respond(text, options);
};
const mock = (prefix, respond) => {
  const handler = { prefix, respond, calls: [] };
  handlers.unshift(handler);
  return handler;
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const { app } = await import("../server.js");
const database = await import("../src/database.js");
const { one, many, query } = await import("../src/db.js");
const { config } = await import("../src/config.js");
const { createApiKey } = await import("../src/auth.js");
const billing = await import("../src/billing.js");
const { ensureProfile, isAdminUser, planFor } = await import("../src/accounts.js");
const minutes = await import("../src/minutes.js");
const { purgeJob } = await import("../src/jobfiles.js");
const { recordUsage } = await import("../src/costs.js");
const { uploadBlocker, resetUploadCounts, uploadsExceeded, purgeUploadCounters } = await import("../src/uploadgate.js");
const { listAudit, purgeOldAudit, auditTriggersSql, AUDITED_TABLES } = await import("../src/audit.js");
const { getRawPlan, listRawPlans } = await import("../src/plans.js");

await database.initializeDatabase();
const server = app.listen(0);
await new Promise((resolve) => server.once("listening", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => fakeOpenAi.close(resolve));
  await database.closeDatabase();
  await rm(dataDirectory, { recursive: true, force: true });
  globalThis.fetch = realFetch;
});

const resend = mock("https://api.resend.com", () => json({ id: "email" }));
config.resendApiKey = "re_test";

const addPayment = (reference, { user, provider = "paystack", kind = "subscription", plan = null, pack = null, amount, currency = "NGN", cycle = "monthly" }) => query(
  "INSERT INTO payments (user_id, billing_id, provider, reference, kind, plan_code, credit_pack, amount, currency, billing_cycle) VALUES ($1, $1, $2, $3, $4, $5, $6, $7, $8, $9)",
  [user, provider, reference, kind, plan, pack, amount, currency, cycle],
);
const paymentStatus = async (reference) => (await one("SELECT status FROM payments WHERE reference = $1", [reference]))?.status;
const subscriptionOf = (user) => one("SELECT * FROM subscriptions WHERE user_id = $1", [user]);
const addMonth = (date) => {
  const next = new Date(date);
  next.setUTCMonth(next.getUTCMonth() + 1);
  return next.toISOString();
};
const paystackEvent = (data) => ({ event: "charge.success", data });

// ---------- Money: what was paid must cover the price ----------

test("a payment that doesn't cover the price is held, the admins are told, and nothing is activated", async () => {
  await ensureProfile("buyer", "buyer@example.com");
  await addPayment("rl_short", { user: "buyer", plan: "starter", amount: 1500000 });
  const emailsBefore = resend.calls.length;
  const short = paystackEvent({ reference: "rl_short", amount: 1000000, currency: "NGN", customer: { customer_code: "CUS_B" } });
  await billing.handlePaystackEvent(short);
  assert.equal(await paymentStatus("rl_short"), "underpaid");
  assert.equal(await subscriptionOf("buyer"), null, "no plan was given for ₦10,000 of a ₦15,000 plan");
  assert.equal(resend.calls.length, emailsBefore + 1, "the admins were emailed");
  assert.match(JSON.parse(resend.calls.at(-1).options.body).subject, /rl_short/);
  await billing.handlePaystackEvent(short);
  assert.equal(resend.calls.length, emailsBefore + 1, "a repeat delivery doesn't send the same alert again");

  // The right amount in the wrong currency is also refused.
  await addPayment("rl_wrongcurrency", { user: "buyer", plan: "starter", amount: 1500000 });
  await billing.handlePaystackEvent(paystackEvent({ reference: "rl_wrongcurrency", amount: 1500000, currency: "USD", customer: { customer_code: "CUS_B" } }));
  assert.equal(await paymentStatus("rl_wrongcurrency"), "underpaid");

  // A provider that reports no amount at all can't be trusted either.
  await addPayment("rl_noamount", { user: "buyer", plan: "starter", amount: 1500000 });
  await billing.handlePaystackEvent(paystackEvent({ reference: "rl_noamount", customer: { customer_code: "CUS_B" } }));
  assert.equal(await paymentStatus("rl_noamount"), "underpaid");

  // When the full amount arrives (for example the customer finishes paying), the plan is activated.
  await billing.handlePaystackEvent(paystackEvent({ reference: "rl_short", amount: 1500000, currency: "NGN", customer: { customer_code: "CUS_B" } }));
  assert.equal(await paymentStatus("rl_short"), "success");
  assert.equal((await subscriptionOf("buyer")).tier, "starter");
});

test("paying more than the price is fine", async () => {
  await ensureProfile("generous", "generous@example.com");
  await addPayment("rl_over", { user: "generous", plan: "starter", amount: 1500000 });
  await billing.handlePaystackEvent(paystackEvent({ reference: "rl_over", amount: 1600000, currency: "NGN", customer: { customer_code: "CUS_G" } }));
  assert.equal(await paymentStatus("rl_over"), "success");
  assert.equal((await subscriptionOf("generous")).tier, "starter");
});

test("returning from Paystack or Stripe checks the amount too, and an admin can approve a held payment", async () => {
  await ensureProfile("verifier", "verifier@example.com");
  await addPayment("rl_verify", { user: "verifier", plan: "starter", amount: 1500000 });
  const paystack = mock("https://api.paystack.co/transaction/verify/", () => json({ status: true, data: { status: "success", id: 1, amount: 900000, currency: "NGN", customer: { customer_code: "CUS_V" } } }));
  assert.deepEqual(await billing.verifyPayment("paystack", { reference: "rl_verify" }), { status: "underpaid" });
  assert.equal(paystack.calls.length, 1);
  assert.equal(await subscriptionOf("verifier"), null);

  // Admin looks at it (say, a discount code) and accepts it.
  assert.deepEqual(await billing.approvePayment("rl_verify"), { reference: "rl_verify", status: "success" });
  assert.equal((await subscriptionOf("verifier")).tier, "starter");
  await assert.rejects(billing.approvePayment("rl_verify"), /Only payments held/);
  await assert.rejects(billing.approvePayment("nope"), /not found/);

  // Stripe: $10 plan, customer only paid $5, then the full $10.
  await addPayment("rl_stripe", { user: "verifier", provider: "stripe", plan: "creator", amount: 2500, currency: "USD" });
  let collected = 1000;
  mock("https://api.stripe.com/v1/checkout/sessions/", () => json({ payment_status: "paid", status: "complete", amount_total: collected, currency: "usd", metadata: { reference: "rl_stripe" }, subscription: null, customer: "cus_1", id: "cs_1" }));
  assert.deepEqual(await billing.verifyPayment("stripe", { reference: "rl_stripe", sessionId: "cs_1" }), { status: "underpaid" });
  assert.equal((await subscriptionOf("verifier")).tier, "starter", "still the old plan");
  collected = 2500;
  assert.deepEqual(await billing.verifyPayment("stripe", { reference: "rl_stripe", sessionId: "cs_1" }), { status: "success" });
  assert.equal((await subscriptionOf("verifier")).tier, "creator");
});

test("a minute pack that wasn't fully paid gives no minutes", async () => {
  await ensureProfile("packbuyer", "pack@example.com");
  await addPayment("rl_pack", { user: "packbuyer", kind: "payg", pack: "min_15", amount: 1450000 });
  await billing.handlePaystackEvent(paystackEvent({ reference: "rl_pack", amount: 100000, currency: "NGN" }));
  assert.equal((await minutes.minuteBalance("packbuyer")).topup_left, 0);
  await billing.handlePaystackEvent(paystackEvent({ reference: "rl_pack", amount: 1450000, currency: "NGN" }));
  assert.equal((await minutes.minuteBalance("packbuyer")).topup_left, 15);
});

// ---------- Money: a repeated webhook must not give free months ----------

test("a renewal webhook delivered several times extends the plan once", async () => {
  const end = new Date(Date.now() + 10 * 86400000);
  await ensureProfile("renewer", "renewer@example.com");
  await billing.activateSubscription("renewer", "starter", { provider: "paystack", customer: "CUS_R", periodEnd: end });
  const renewal = paystackEvent({ reference: "ren_1", amount: 1500000, currency: "NGN", customer: { customer_code: "CUS_R" }, plan: { plan_code: "PLN_S" } });
  await billing.handlePaystackEvent(renewal);
  await billing.handlePaystackEvent(renewal);
  await billing.handlePaystackEvent(renewal);
  assert.equal(new Date((await subscriptionOf("renewer")).current_period_end).toISOString(), addMonth(end), "one month added, not three");
  const rows = await many("SELECT status FROM payments WHERE reference = 'renewal_ren_1'");
  assert.deepEqual(rows.map((row) => row.status), ["success"], "recorded once");
});

test("a renewal that collected less than the plan costs doesn't extend it", async () => {
  const end = new Date(Date.now() + 5 * 86400000);
  await ensureProfile("cheapskate", "cheap@example.com");
  await billing.activateSubscription("cheapskate", "starter", { provider: "paystack", customer: "CUS_C", periodEnd: end });
  const emails = resend.calls.length;
  await billing.handlePaystackEvent(paystackEvent({ reference: "ren_short", amount: 300000, currency: "NGN", customer: { customer_code: "CUS_C" }, plan: { plan_code: "PLN_S" } }));
  assert.equal(new Date((await subscriptionOf("cheapskate")).current_period_end).toISOString(), end.toISOString());
  assert.equal(await paymentStatus("renewal_ren_short"), "underpaid");
  assert.equal(resend.calls.length, emails + 1);
});

test("Stripe renewals are checked and recorded once as well", async () => {
  const end = new Date(Date.now() + 8 * 86400000);
  await ensureProfile("stripey", "stripey@example.com");
  await billing.activateSubscription("stripey", "starter", { provider: "stripe", providerRef: "sub_1", customer: "cus_1", periodEnd: end });
  const next = Math.floor((end.getTime() + 30 * 86400000) / 1000);
  const invoice = (id, paid) => ({ type: "invoice.paid", data: { object: { id, subscription: "sub_1", billing_reason: "subscription_cycle", amount_paid: paid, currency: "usd", lines: { data: [{ period: { end: next } }] } } } });
  await billing.handleStripeEvent(invoice("in_short", 100));
  assert.equal(new Date((await subscriptionOf("stripey")).current_period_end).toISOString(), end.toISOString(), "an invoice for $1 doesn't renew a $10 plan");
  assert.equal(await paymentStatus("renewal_in_short"), "underpaid");
  await billing.handleStripeEvent(invoice("in_ok", 1000));
  await billing.handleStripeEvent(invoice("in_ok", 1000));
  assert.equal(new Date((await subscriptionOf("stripey")).current_period_end).toISOString(), new Date(next * 1000).toISOString());
  assert.equal((await many("SELECT id FROM payments WHERE reference = 'renewal_in_ok'")).length, 1);
});

// ---------- Paying early never wastes the days that are left ----------

test("paying for the same plan early adds a period on top of the days left; switching plans starts today", async () => {
  const end = new Date(Date.now() + 10 * 86400000);
  await ensureProfile("early", "early@example.com");
  await billing.activateSubscription("early", "starter", { provider: "paystack", customer: "CUS_E", periodEnd: end });
  await addPayment("rl_early", { user: "early", plan: "starter", amount: 1500000 });
  await billing.handlePaystackEvent(paystackEvent({ reference: "rl_early", amount: 1500000, currency: "NGN", customer: { customer_code: "CUS_E" } }));
  assert.equal(new Date((await subscriptionOf("early")).current_period_end).toISOString(), addMonth(end), "10 days left + a month");

  await addPayment("rl_upgrade", { user: "early", plan: "creator", amount: 3800000 });
  await billing.handlePaystackEvent(paystackEvent({ reference: "rl_upgrade", amount: 3800000, currency: "NGN", customer: { customer_code: "CUS_E" } }));
  const upgraded = await subscriptionOf("early");
  assert.equal(upgraded.tier, "creator");
  assert.ok(Math.abs(new Date(upgraded.current_period_end).getTime() - new Date(addMonth(new Date())).getTime()) < 10000, "a new plan starts a fresh month from today");

  // A lapsed plan restarts from today.
  await billing.activateSubscription("lapsed", "starter", { provider: "paystack", periodEnd: new Date(Date.now() - 5 * 86400000) });
  await billing.activateSubscription("lapsed", "starter", { provider: "paystack" });
  assert.ok(Math.abs(new Date((await subscriptionOf("lapsed")).current_period_end).getTime() - new Date(addMonth(new Date())).getTime()) < 10000);
});

// ---------- Money: deleting a project can't launder minutes ----------

test("deleting a project gives the minutes back only if no paid work was done", async () => {
  await ensureProfile("refunder", "refunder@example.com");
  await billing.activateSubscription("refunder", "starter");
  const allowance = 16;
  const make = async (minutesCharged) => {
    const job = await database.createJob({ user_id: "refunder", source_language: "yo", target_language: "en", options_json: { charge: minutes.newCharge(minutesCharged, "job") } });
    await minutes.ensureCharged(job, { billingId: "refunder", allowance, periodEnd: null });
    return job;
  };
  const available = async () => (await planFor({ userId: "refunder" })).minutes.available;

  const untouched = await make(3);
  assert.equal(await available(), 13);
  await purgeJob(await database.getJob(untouched.id));
  assert.equal(await available(), 16, "nothing had run, so everything came back");

  const translated = await make(3);
  await recordUsage({ provider: "openai", operation: "translate", units: 900, unit: "tokens", costUsd: 0.01, userId: "refunder", jobId: translated.id });
  await database.updateJob(translated.id, { status: "awaiting_review", review_state: "pending" });
  await purgeJob(await database.getJob(translated.id));
  assert.equal(await available(), 13, "the translation was already paid for, so the minutes stay spent");
});

// ---------- Uploads are checked before the file is accepted ----------

test("people who can't use minutes can't start uploads", async () => {
  await resetUploadCounts();
  config.uploadsPerHour = 40;
  await ensureProfile("nominutes", "nominutes@example.com");
  await billing.activateSubscription("nominutes", "studio");
  await query("INSERT INTO minute_ledger (billing_id, delta, bucket, kind) VALUES ('nominutes', -125, 'plan', 'test')");
  const key = (await createApiKey("nominutes", "t")).key;
  const tus = (headers = {}) => fetch(`${base}/uploads`, {
    method: "POST",
    headers: { "Tus-Resumable": "1.0.0", "Upload-Length": "100", "Upload-Metadata": "filename dGVzdC5tcDQ=,filetype dmlkZW8vbXA0", Authorization: `Bearer ${key}`, ...headers },
  });
  const refused = await tus();
  assert.equal(refused.status, 402, "out of minutes: no upload slot");
  assert.match(await refused.text(), /used all your minutes/);

  const plain = await fetch(`${base}/jobs`, { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: new FormData() });
  assert.equal(plain.status, 402);
  const body = await plain.json();
  assert.equal(body.code, "minutes");
  assert.equal(body.needed, 0.1);

  await minutes.grantMinutes("nominutes", 5, "pack", { reference: "np-pack" });
  assert.equal((await tus()).status, 201, "with minutes the upload starts");

  // A suspended account can't upload either, even if it still holds a valid key.
  await query("UPDATE profiles SET disabled = $1 WHERE user_id = 'nominutes'", [true]);
  assert.equal((await tus()).status, 403);
  await query("UPDATE profiles SET disabled = $1 WHERE user_id = 'nominutes'", [false]);
});

test("one person can't start unlimited uploads", async () => {
  await resetUploadCounts();
  await ensureProfile("uploader", "uploader@example.com");
  await billing.activateSubscription("uploader", "studio");
  const key = (await createApiKey("uploader", "t")).key;
  const saved = config.uploadsPerHour;
  config.uploadsPerHour = 2;
  try {
    const statuses = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      statuses.push((await fetch(`${base}/uploads`, {
        method: "POST", headers: { "Tus-Resumable": "1.0.0", "Upload-Length": "100", "Upload-Metadata": "filename dGVzdC5tcDQ=", Authorization: `Bearer ${key}` },
      })).status);
    }
    assert.deepEqual(statuses, [201, 201, 429, 429]);
  } finally {
    config.uploadsPerHour = saved;
    await resetUploadCounts();
  }
});

test("the upload gate: suspended, empty, unconfirmed free accounts and admins", async () => {
  await ensureProfile("gated", "gated@example.com");
  const free = { id: "gated", email: "gated@example.com", emailConfirmed: true };
  assert.equal(await uploadBlocker({ user: free }), null, "a free user with minutes may upload");
  const unconfirmed = await uploadBlocker({ user: { ...free, emailConfirmed: false } });
  assert.equal(unconfirmed.code, "confirm_email");
  config.requireConfirmedEmail = false;
  assert.equal(await uploadBlocker({ user: { ...free, emailConfirmed: false } }), null, "the admin can switch that rule off");
  config.requireConfirmedEmail = true;
  assert.equal(await uploadBlocker({ user: { id: "gated", email: "gated@example.com" } }), null, "API-key requests carry no confirmation flag and aren't blocked by it");

  await query("UPDATE profiles SET disabled = $1 WHERE user_id = 'gated'", [true]);
  assert.equal((await uploadBlocker({ user: free })).code, "suspended");
  await query("UPDATE profiles SET disabled = $1 WHERE user_id = 'gated'", [false]);

  config.maintenanceMode = true;
  assert.equal((await uploadBlocker({ user: free })).code, "maintenance");
  await ensureProfile("boss", "boss@example.com");
  assert.equal(await uploadBlocker({ user: { id: "boss", email: "boss@example.com" } }), null, "admins are never blocked");
  config.maintenanceMode = false;
});

// ---------- Admin: who counts as an admin ----------

test("an admin address only counts once its owner has confirmed it", async (context) => {
  assert.equal(isAdminUser({ id: "x", email: "boss@example.com", emailConfirmed: false }), false, "squatting on the address doesn't help");
  assert.equal(isAdminUser({ id: "x", email: "boss@example.com", emailConfirmed: true }), true);
  assert.equal(isAdminUser({ id: "x", email: "boss@example.com" }), true, "API keys can only be made by a signed-in person");
  assert.equal(isAdminUser({ id: "x", email: "other@example.com", emailConfirmed: true }, { is_admin: true }), true, "promoted in Admin → Users");
  assert.equal(isAdminUser({ id: "x", email: "other@example.com", emailConfirmed: true }), false);

  // End to end through the real sign-in check, with Supabase answered by a stand-in.
  config.supabaseUrl = "https://supabase.test";
  config.supabaseKey = "anon";
  context.after(() => {
    config.supabaseUrl = "";
    config.supabaseKey = "";
  });
  mock("https://supabase.test/auth/v1/user", (_url, options) => {
    const token = options.headers.Authorization.replace("Bearer ", "");
    return json({ id: `user-${token}`, email: "boss@example.com", email_confirmed_at: token === "confirmed" ? "2026-01-01T00:00:00Z" : null });
  });
  const open = (token) => fetch(`${base}/admin/settings`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal((await open("unconfirmed")).status, 403, "an unconfirmed sign-up with the admin's address gets nothing");
  assert.equal((await open("confirmed")).status, 200);
});

// ---------- Admin: audit trail ----------

test("every admin change is written to the audit log, with secrets hidden", async () => {
  await ensureProfile("boss", "boss@example.com");
  await billing.activateSubscription("boss", "studio");
  await ensureProfile("plain", "plain@example.com");
  await billing.activateSubscription("plain", "studio");
  const admin = { Authorization: `Bearer ${(await createApiKey("boss", "audit")).key}`, "Content-Type": "application/json" };
  const plain = { Authorization: `Bearer ${(await createApiKey("plain", "audit")).key}`, "Content-Type": "application/json" };
  const call = (path, headers, method = "GET", body) => fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const audit = async (search = "") => (await call(`/admin/audit?q=${encodeURIComponent(search)}`, admin)).json();

  assert.equal((await call("/admin/audit", plain)).status, 403, "only admins can read it");

  assert.equal((await call("/admin/settings", admin, "PUT", { announcement: "hello" })).status, 200);
  const setting = (await audit("settings"))[0];
  assert.equal(setting.action, "PUT /admin/settings");
  assert.equal(setting.admin_email, "boss@example.com");
  assert.equal(setting.details.body.announcement, "hello");
  assert.equal(setting.details.before.announcement, "", "what it was before is kept too");

  assert.equal((await call("/admin/users", admin, "POST", { email: "fresh@example.com", password: "supersecret123", plan: "free" })).status, 201);
  const created = (await audit("POST /admin/users"))[0];
  assert.equal(created.details.body.password, "[hidden]");
  assert.ok(!JSON.stringify(await audit()).includes("supersecret123"), "the password is nowhere in the log");

  const blurbBefore = (await getRawPlan("starter")).blurb;
  assert.equal((await call("/admin/plans/starter", admin, "PUT", { blurb: "Changed in the audit test" })).status, 200);
  const planChange = (await audit("PUT /admin/plans"))[0];
  assert.equal(planChange.details.before.blurb, blurbBefore, "the old plan is recorded next to the change");
  assert.equal(planChange.details.body.blurb, "Changed in the audit test");
  await call("/admin/plans/starter", admin, "PUT", { blurb: blurbBefore });

  const entries = (await audit()).length;
  assert.equal((await call("/admin/plans/does-not-exist", admin, "PUT", { name: "x" })).status, 404);
  assert.equal((await audit()).length, entries, "requests that failed changed nothing, so nothing is logged");

  // If the log can't be written, the admin's change still goes through (and the problem is logged loudly).
  await query("DROP TABLE admin_audit");
  assert.equal((await call("/admin/settings", admin, "PUT", { announcement: "still works" })).status, 200);
  await query("CREATE TABLE admin_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, admin_id TEXT, admin_email TEXT, action TEXT NOT NULL, target TEXT, details TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)");
});

// ---------- Admin: plan safety ----------

test("plans can't be saved in ways that lose money or sell nothing", async () => {
  await ensureProfile("boss", "boss@example.com");
  const admin = { Authorization: `Bearer ${(await createApiKey("boss", "plans")).key}`, "Content-Type": "application/json" };
  const call = (path, method, body) => fetch(`${base}${path}`, { method, headers: admin, body: body === undefined ? undefined : JSON.stringify(body) });
  const plan = { code: "gold", name: "Gold", price_usd: 100, price_ngn: 160000, minutes_per_month: 10, max_video_minutes: 20 };

  const noMinutes = await call("/admin/plans", "POST", { ...plan, minutes_per_month: 0 });
  assert.equal(noMinutes.status, 400);
  assert.match((await noMinutes.json()).detail, /at least 1 minute per month/);
  const oneCurrency = await call("/admin/plans", "POST", { ...plan, price_usd: 0 });
  assert.equal(oneCurrency.status, 400);
  assert.match((await oneCurrency.json()).detail, /both the dollar price and the naira price/);

  const cheap = await call("/admin/plans", "POST", { ...plan, price_usd: 1, price_ngn: 1500, minutes_per_month: 100 });
  assert.equal(cheap.status, 409);
  assert.equal((await cheap.json()).code, "unprofitable");
  assert.equal((await getRawPlan("gold")), null);

  const created = await call("/admin/plans", "POST", plan);
  assert.equal(created.status, 201);
  const body = await created.json();
  assert.equal(body.videos_per_month, undefined, "the unused videos-per-month limit is gone");
  assert.equal((await listRawPlans()).some((item) => "videos_per_month" in item), false);

  // Setting minutes to nothing on an existing paid plan is refused too.
  assert.equal((await call("/admin/plans/gold", "PUT", { minutes_per_month: 0 })).status, 400);
  assert.equal((await getRawPlan("gold")).minutes_per_month, 10);
});

test("deleting a plan, or taking a customer off a plan, stops their automatic billing first", async () => {
  await ensureProfile("boss", "boss@example.com");
  const admin = { Authorization: `Bearer ${(await createApiKey("boss", "plans2")).key}`, "Content-Type": "application/json" };
  const call = (path, method, body) => fetch(`${base}${path}`, { method, headers: admin, body: body === undefined ? undefined : JSON.stringify(body) });
  let working = false;
  const paystack = mock("https://api.paystack.co/subscription", (url) => {
    if (!working) return json({ status: false, message: "Paystack is down" }, 500);
    return url.endsWith("/disable") ? json({ status: true, data: {} }) : json({ status: true, data: { email_token: "tok" } });
  });
  const end = new Date(Date.now() + 20 * 86400000);

  // Deleting a plan with a paying customer.
  await call("/admin/plans", "POST", { code: "doomed", name: "Doomed", price_usd: 100, price_ngn: 160000, minutes_per_month: 10, max_video_minutes: 20 });
  await ensureProfile("payer", "payer@example.com");
  await billing.activateSubscription("payer", "doomed", { provider: "paystack", providerRef: "SUB_D", customer: "CUS_D", periodEnd: end });
  const refused = await call("/admin/plans/doomed", "DELETE");
  assert.equal(refused.status, 400);
  assert.match((await refused.json()).detail, /nothing was changed/);
  assert.equal((await subscriptionOf("payer")).tier, "doomed", "nobody was moved while billing couldn't be stopped");
  assert.ok(await getRawPlan("doomed"));
  working = true;
  const deleted = await call("/admin/plans/doomed", "DELETE");
  assert.equal(deleted.status, 200);
  assert.deepEqual(await deleted.json(), { moved: 1, billing_stopped: 1 });
  assert.equal((await subscriptionOf("payer")).tier, "free");
  assert.ok(paystack.calls.some((request) => request.url.endsWith("/disable")), "Paystack was told to stop charging");

  // Putting a paying customer on the free plan by hand.
  working = false;
  await ensureProfile("downgraded", "down@example.com");
  await billing.activateSubscription("downgraded", "starter", { provider: "paystack", providerRef: "SUB_X", customer: "CUS_X", periodEnd: end });
  const failed = await call("/admin/users/downgraded", "PATCH", { plan: "free" });
  assert.equal(failed.status, 400);
  assert.match((await failed.json()).detail, /Cancel it in your Paystack or Stripe dashboard first/);
  assert.equal((await subscriptionOf("downgraded")).tier, "starter", "unchanged while the customer is still being billed");
  working = true;
  assert.equal((await call("/admin/users/downgraded", "PATCH", { plan: "free" })).status, 200);
  const after = await subscriptionOf("downgraded");
  assert.equal(after.tier, "free");
  assert.equal(after.provider, "manual");

  // A customer without automatic billing (manual grant) needs no provider at all.
  await ensureProfile("granted", "granted@example.com");
  await billing.activateSubscription("granted", "starter", { provider: "manual", periodEnd: end });
  const callsBefore = paystack.calls.length;
  assert.equal((await call("/admin/users/granted", "PATCH", { plan: "free" })).status, 200);
  assert.equal(paystack.calls.length, callsBefore);
});

// ---------- Other gaps ----------

test("sign-ups are limited per internet address", async () => {
  const saved = config.signupRateLimitPerHour;
  config.signupRateLimitPerHour = 3;
  try {
    const statuses = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      statuses.push((await fetch(`${base}/auth/signup`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: `farm${attempt}@example.com`, password: "longenough1" }) })).status);
    }
    assert.deepEqual(statuses, [400, 400, 400, 429, 429], "the fourth sign-up from one address in an hour is refused");
  } finally {
    config.signupRateLimitPerHour = saved;
  }
});

test("single-line re-translations are capped per project", async () => {
  await ensureProfile("editor", "editor@example.com");
  await billing.activateSubscription("editor", "studio");
  const headers = { Authorization: `Bearer ${(await createApiKey("editor", "t")).key}`, "Content-Type": "application/json" };
  const job = await database.createJob({ user_id: "editor", source_language: "yo", target_language: "en", options_json: {} });
  await database.updateJob(job.id, {
    status: "done", transcript_json: [{ start: 0, end: 2, text: "bawo ni" }], translated_segments_json: [{ start: 0, end: 2, text: "hello" }],
  });
  const retranslate = () => fetch(`${base}/jobs/${job.id}/segments/0/retranslate`, { method: "POST", headers });

  const saved = config.maxRetranslations;
  config.maxRetranslations = 2;
  try {
    assert.notEqual((await retranslate()).status, 429);
    assert.equal((await database.getJob(job.id)).options_json.retranslations, 1, "the attempt is counted even if the translator fails");
    assert.notEqual((await retranslate()).status, 429);
    const capped = await retranslate();
    assert.equal(capped.status, 429);
    assert.equal((await capped.json()).code, "retranslations");
    assert.equal(openaiHits.length, 2, "no third call to the paid translator");
  } finally {
    config.maxRetranslations = saved;
  }
});

// ---------- Gaps found in the second review ----------

test("a failed project can only be retried a few times (admins aren't limited)", async () => {
  await ensureProfile("retrier", "retrier@example.com");
  await billing.activateSubscription("retrier", "studio");
  const headers = { Authorization: `Bearer ${(await createApiKey("retrier", "t")).key}`, "Content-Type": "application/json" };
  const job = await database.createJob({
    user_id: "retrier", source_language: "yo", target_language: "en", input_storage_path: "uploads/never-there.mp4", options_json: { charge: minutes.newCharge(1, "job") },
  });
  // What the pipeline does when a run fails: the job is marked failed and the minutes go back.
  const fail = async () => {
    const latest = await database.getJob(job.id);
    await minutes.refundRun(latest);
    await database.updateJob(job.id, { status: "failed", error_message: "provider error" });
  };
  const retry = () => fetch(`${base}/jobs/${job.id}/retry`, { method: "POST", headers, body: "{}" });
  const saved = config.maxRetries;
  config.maxRetries = 2;
  try {
    await fail();
    assert.equal((await retry()).status, 200);
    await fail();
    assert.equal((await retry()).status, 200);
    await fail();
    const refused = await retry();
    assert.equal(refused.status, 409);
    const body = await refused.json();
    assert.equal(body.code, "retries");
    assert.match(body.detail, /retried 2 times/);
    assert.equal((await database.getJob(job.id)).status, "failed", "a refused retry changes nothing");
    assert.equal((await database.getJob(job.id)).options_json.retries, 2);

    // An admin can always retry.
    await ensureProfile("boss", "boss@example.com");
    await billing.activateSubscription("boss", "studio");
    const admin = { Authorization: `Bearer ${(await createApiKey("boss", "retry")).key}`, "Content-Type": "application/json" };
    config.maxRetries = 0;
    const own = await database.createJob({
      user_id: "boss", source_language: "yo", target_language: "en", input_storage_path: "uploads/never-there.mp4", options_json: { charge: minutes.newCharge(1, "job") },
    });
    await database.updateJob(own.id, { status: "failed" });
    assert.equal((await fetch(`${base}/jobs/${own.id}/retry`, { method: "POST", headers: admin, body: "{}" })).status, 200);
  } finally {
    config.maxRetries = saved;
  }
});

test("the upload limit is counted in the database, shared by every server, and old counters are cleaned up", async () => {
  await resetUploadCounts();
  const saved = config.uploadsPerHour;
  config.uploadsPerHour = 2;
  const now = Date.now();
  try {
    assert.deepEqual([await uploadsExceeded("counted", now), await uploadsExceeded("counted", now), await uploadsExceeded("counted", now)], [false, false, true]);
    assert.equal((await one("SELECT value FROM app_settings WHERE key LIKE 'uploads:counted:%'")).value, "3", "the count is a database row, not memory");
    assert.equal(await uploadsExceeded("someone-else", now), false, "people are counted separately");
    assert.equal(await uploadsExceeded("counted", now + 3600 * 1000), false, "a new hour starts a new count");
    const settings = await import("../src/settings.js");
    await settings.loadSettings(); // reloads every saved setting; it must ignore the counter rows
    assert.equal(config.uploadsPerHour, 40, "back to the default, because no admin saved a different limit");
    config.uploadsPerHour = 2;
    assert.equal(await purgeUploadCounters(now + 3 * 3600 * 1000), 3, "counters older than a couple of hours are removed");
    assert.equal((await many("SELECT key FROM app_settings WHERE key LIKE 'uploads:%'")).length, 0);
  } finally {
    config.uploadsPerHour = saved;
    await resetUploadCounts();
  }
});

test("admins opening a customer's details or the payment list is logged, but ordinary lists are not", async () => {
  await ensureProfile("boss", "boss@example.com");
  await billing.activateSubscription("boss", "studio");
  await ensureProfile("watched", "watched@example.com");
  const admin = { Authorization: `Bearer ${(await createApiKey("boss", "views")).key}`, "Content-Type": "application/json" };
  const count = async (needle) => (await listAudit({ limit: 500, search: needle })).length;

  const before = await count("VIEW");
  assert.equal((await fetch(`${base}/admin/users/watched`, { headers: admin })).status, 200);
  assert.equal((await fetch(`${base}/admin/payments`, { headers: admin })).status, 200);
  assert.equal((await fetch(`${base}/admin/users`, { headers: admin })).status, 200);
  assert.equal((await fetch(`${base}/admin/plans`, { headers: admin })).status, 200);
  const views = await listAudit({ limit: 500, search: "VIEW" });
  assert.equal(views.length, before + 2, "only the customer's details and the payment list");
  const opened = views.find((entry) => entry.action === "VIEW GET /admin/users/:userId");
  assert.equal(opened.admin_email, "boss@example.com");
  assert.equal(JSON.parse(opened.target).userId, "watched");
  assert.ok(views.some((entry) => entry.action === "VIEW GET /admin/payments"));
  const settled = await count("VIEW");
  assert.equal((await fetch(`${base}/admin/users/nobody-here`, { headers: admin })).status >= 400, true);
  assert.equal(await count("VIEW"), settled, "a failed look-up isn't logged");
});

test("the audit log deletes old entries, and keeps text it can't read instead of losing it", async () => {
  await query("INSERT INTO admin_audit (admin_id, admin_email, action, target, details, created_at) VALUES ('x', 'old@example.com', 'PUT /old', '', '{}', '2019-01-01 00:00:00')");
  await query("INSERT INTO admin_audit (admin_id, admin_email, action, target, details) VALUES ('database', 'db', 'UPDATE plans', 'starter', '{\"before\": {\"price')");
  const saved = config.auditRetentionDays;
  config.auditRetentionDays = 365;
  try {
    assert.ok(await purgeOldAudit() >= 1);
    assert.equal((await listAudit({ search: "old@example.com" })).length, 0);
    const truncated = (await listAudit({ search: "UPDATE plans" }))[0];
    assert.match(truncated.details.raw, /before/, "a cut-off row is still shown, as plain text");
  } finally {
    config.auditRetentionDays = saved;
  }
});

test("changes made directly in the database are covered by the optional trigger file", () => {
  const sql = auditTriggersSql();
  for (const { table } of AUDITED_TABLES) assert.match(sql, new RegExp(`CREATE TRIGGER reellingo_audit AFTER .* ON public.${table} `));
  assert.match(sql, /application_name', true\) = 'reellingo-api'/, "the app's own (already logged) changes are skipped");
  assert.match(sql, /AFTER UPDATE OF is_admin, disabled ON public.profiles/, "profile edits are only logged when admin or suspension changes");
});

test("Stripe checkout never accepts discount codes, so every sale is at full price", async () => {
  const stripe = mock("https://api.stripe.com/v1/checkout/sessions", () => json({ id: "cs_test", url: "https://checkout.stripe.test/x" }));
  await ensureProfile("shopper", "shopper@example.com");
  await billing.createCheckout({ provider: "stripe", user: { id: "shopper", email: "shopper@example.com" }, billingId: "shopper", planCode: "starter" });
  const body = decodeURIComponent(stripe.calls.at(-1).options.body);
  assert.ok(!/allow_promotion_codes|discounts/.test(body), "no coupon field is sent");
  assert.match(body, /unit_amount\]=1000/);
});
