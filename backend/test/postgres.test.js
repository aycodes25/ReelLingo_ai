// Runs the money-critical code against a REAL Postgres (a throw-away one started on this computer by the
// embedded-postgres package), because SQLite can't prove Postgres behaviour: advisory locks across servers, trigger
// SQL, BIGINT/timestamp types, ON CONFLICT … RETURNING. It never touches Supabase or any other database.
// If the Postgres binaries aren't installed, these tests are skipped (and say so).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import pg from "pg";

// Nothing here may hang the whole suite: starting Postgres, every test and every child process has a time limit.
const withTimeout = (promise, ms, label) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} took longer than ${ms / 1000}s`)), ms).unref()),
]);

const freePort = () => new Promise((resolve) => {
  const probe = createServer();
  probe.listen(0, "127.0.0.1", () => {
    const { port } = probe.address();
    probe.close(() => resolve(port));
  });
});

let server = null;
let skipReason = "";
const dataDirectory = await mkdtemp(join(tmpdir(), "reellingo-pg-"));
const port = await freePort();
try {
  const { default: EmbeddedPostgres } = await import("embedded-postgres");
  server = new EmbeddedPostgres({ databaseDir: join(dataDirectory, "data"), user: "postgres", password: "test", port, persistent: false, initdbFlags: ["--encoding=UTF8", "--locale=C"], onLog: () => undefined, onError: () => undefined });
  await withTimeout(server.initialise(), 120_000, "Setting up Postgres");
  await withTimeout(server.start(), 120_000, "Starting Postgres");
} catch (error) {
  skipReason = `Postgres for tests isn't available here (${String(error.message).split("\n")[0]})`;
  server = null;
}

const databaseUrl = `postgres://postgres:test@127.0.0.1:${port}/postgres`;
const run = server ? (name, fn) => test(name, { timeout: 90_000 }, fn) : (name, fn) => test(name, { skip: skipReason }, fn);

Object.assign(process.env, {
  MOCK_MODE: "false", OPENAI_API_KEY: "test-openai", SUPABASE_URL: "", SUPABASE_KEY: "", WORKER_MODE: "off", RESEND_API_KEY: "",
  PAYSTACK_SECRET_KEY: "paystack-test-secret", ADMIN_EMAILS: "boss@example.com", DATABASE_URL: databaseUrl, LOCAL_STORAGE_DIR: join(dataDirectory, "storage"),
});

let database;
let db;
let minutes;
let billing;
let audit;
let gate;
let plans;
let directClient; // a person editing in the Supabase table editor: it doesn't call itself "reellingo-api"

if (server) {
  const admin = new pg.Client({ connectionString: databaseUrl });
  await admin.connect();
  // Supabase has these two roles already; a plain Postgres doesn't.
  await admin.query("CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;");
  db = await import("../src/db.js");
  audit = await import("../src/audit.js");
  plans = await import("../src/plans.js");
  await admin.query(db.postgresSchemaSql(plans.planSeedSql()));
  await admin.query(audit.auditTriggersSql());
  await admin.end();

  directClient = new pg.Client({ connectionString: databaseUrl, application_name: "supabase-sql-editor" });
  await directClient.connect();

  database = await import("../src/database.js");
  minutes = await import("../src/minutes.js");
  billing = await import("../src/billing.js");
  gate = await import("../src/uploadgate.js");
  await database.initializeDatabase();
}

test.after(async () => {
  await directClient?.end().catch(() => undefined);
  if (database) await database.closeDatabase();
  if (server) await withTimeout(server.stop(), 30_000, "Stopping Postgres").catch(() => undefined);
  await rm(dataDirectory, { recursive: true, force: true }).catch(() => undefined);
  // If some connection is still open, don't let it keep the whole test run waiting.
  setTimeout(() => process.exit(process.exitCode ?? 0), 10_000).unref();
});

const childScript = fileURLToPath(new URL("../scripts/pg-test-child.mjs", import.meta.url));
const child = (...args) => new Promise((resolve, reject) => {
  const process_ = spawn(process.execPath, [childScript, ...args], { env: { ...process.env, NODE_TEST_CONTEXT: "child-v8" }, stdio: ["ignore", "pipe", "pipe"] });
  const killer = setTimeout(() => process_.kill(), 60_000);
  process_.on("close", () => clearTimeout(killer));
  let out = "";
  let err = "";
  process_.stdout.on("data", (chunk) => { out += chunk; });
  process_.stderr.on("data", (chunk) => { err += chunk; });
  process_.on("close", (code) => (code === 0 ? resolve(out.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line))) : reject(new Error(`child failed (${code}): ${err.slice(0, 500)}`))));
});

run("the schema file applies, applies again, and the app starts on it", async () => {
  const { postgresSchemaSql } = await import("../src/db.js");
  const again = new pg.Client({ connectionString: databaseUrl });
  await again.connect();
  await again.query(postgresSchemaSql(plans.planSeedSql())); // safe to run twice
  await again.end();
  assert.equal((await plans.listPlans()).length, 7, "the default plans were seeded");
  assert.ok((await db.many("SELECT relname FROM pg_class WHERE relname = 'admin_audit'")).length, "the audit table exists");
});

run("two servers can't spend the same minutes: the account lock works across processes", async () => {
  await minutes.grantMinutes("racer", 5, "pack", { reference: "race-pack" });
  const jobs = [];
  for (const target of ["en", "fr"]) {
    jobs.push(await database.createJob({ user_id: "racer", source_language: "yo", target_language: target, options_json: { charge: minutes.newCharge(3, "job") } }));
  }
  const startAt = Date.now() + 4000; // both servers wake up at the same moment
  const results = await Promise.all(jobs.map((job) => child("charge", String(job.id), "racer", String(startAt))));
  const outcomes = results.map((lines) => lines.at(-1).result).sort();
  assert.deepEqual(outcomes, ["paid", "refused"], "5 minutes can pay for one 3-minute job, never two");
  assert.equal((await minutes.minuteBalance("racer")).topup_left, 2, "and the balance never went negative");
});

run("a second process waits until the first lets go of the account", async () => {
  let releasedAt = 0;
  let other;
  await minutes.withAccountLock("held-account", async () => {
    other = child("enter-lock", "held-account"); // the other server starts waiting for the same account…
    await sleep(2500); // …for this whole time
    releasedAt = Date.now();
  });
  const [{ enteredAt }] = await other;
  assert.ok(enteredAt >= releasedAt - 5, `the other server got in only after the lock was released (${enteredAt - releasedAt} ms after)`);
});

run("a lock that is never released gives up with an error instead of hanging forever", async () => {
  let failure = null;
  await db.withDbLock("stuck-key", async () => {
    // A second connection asks for the same lock with a 300 ms patience.
    await db.withDbLock("stuck-key", async () => undefined, { timeoutMs: 300 }).catch((error) => { failure = error; });
  });
  assert.match(String(failure?.message), /lock timeout/);
});

run("a payment that's too small is held, and a repeated renewal extends the plan once (Postgres types)", async () => {
  await db.query("INSERT INTO profiles (user_id, email) VALUES ('pgbuyer', 'pgbuyer@example.com') ON CONFLICT DO NOTHING");
  await db.query("INSERT INTO payments (user_id, billing_id, provider, reference, kind, plan_code, amount, currency, billing_cycle) VALUES ('pgbuyer', 'pgbuyer', 'paystack', 'rl_pg', 'subscription', 'starter', 1500000, 'NGN', 'monthly')");
  await billing.handlePaystackEvent({ event: "charge.success", data: { reference: "rl_pg", amount: 1000000, currency: "NGN", customer: { customer_code: "CUS_PG" } } });
  assert.equal((await db.one("SELECT status FROM payments WHERE reference = 'rl_pg'")).status, "underpaid");
  assert.equal(await db.one("SELECT 1 FROM subscriptions WHERE user_id = 'pgbuyer'"), null);
  await billing.approvePayment("rl_pg");
  assert.equal((await db.one("SELECT tier FROM subscriptions WHERE user_id = 'pgbuyer'")).tier, "starter");

  const end = new Date(Date.now() + 9 * 86400000);
  await billing.activateSubscription("pgrenewer", "starter", { provider: "paystack", customer: "CUS_PGR", periodEnd: end });
  const renewal = { event: "charge.success", data: { reference: "pg_ren", amount: 1500000, currency: "NGN", customer: { customer_code: "CUS_PGR" }, plan: { plan_code: "PLN" } } };
  await billing.handlePaystackEvent(renewal);
  await billing.handlePaystackEvent(renewal);
  const expected = new Date(end);
  expected.setUTCMonth(expected.getUTCMonth() + 1);
  assert.equal(new Date((await db.one("SELECT current_period_end FROM subscriptions WHERE user_id = 'pgrenewer'")).current_period_end).toISOString(), expected.toISOString());
  assert.equal((await db.many("SELECT id FROM payments WHERE reference = 'renewal_pg_ren'")).length, 1);
});

run("deleting a project: refund only before paid work, with real Postgres timestamps", async () => {
  await billing.activateSubscription("pgrefund", "starter");
  const { purgeJob } = await import("../src/jobfiles.js");
  const { recordUsage } = await import("../src/costs.js");
  const make = async () => {
    const job = await database.createJob({ user_id: "pgrefund", source_language: "yo", target_language: "en", options_json: { charge: minutes.newCharge(3, "job") } });
    await minutes.ensureCharged(job, { billingId: "pgrefund", allowance: 16, periodEnd: null });
    return job;
  };
  const left = async () => (await minutes.minuteBalance("pgrefund", { allowance: 16, periodEnd: null })).available;
  const untouched = await make();
  assert.equal(await left(), 13);
  await purgeJob(await database.getJob(untouched.id));
  assert.equal(await left(), 16);
  const worked = await make();
  await recordUsage({ provider: "openai", operation: "translate", units: 10, unit: "tokens", costUsd: 0.01, userId: "pgrefund", jobId: worked.id });
  await database.updateJob(worked.id, { status: "awaiting_review" });
  await purgeJob(await database.getJob(worked.id));
  assert.equal(await left(), 13, "paid work was done, so no refund");
});

run("the hourly upload counter works on Postgres (ON CONFLICT … RETURNING)", async () => {
  const saved = (await import("../src/config.js")).config;
  saved.uploadsPerHour = 2;
  const now = Date.now();
  assert.deepEqual([await gate.uploadsExceeded("pgu", now), await gate.uploadsExceeded("pgu", now), await gate.uploadsExceeded("pgu", now)], [false, false, true]);
  assert.equal(await gate.purgeUploadCounters(now + 3 * 3600 * 1000), 1);
});

run("the audit log writes, reads, searches and purges on Postgres", async () => {
  await audit.writeAudit({ adminId: "boss", adminEmail: "boss@example.com", action: "PUT /admin/plans/:code", target: '{"code":"starter"}', details: { body: { password: "x", blurb: "y" } } });
  const [entry] = await audit.listAudit({ search: "plans" });
  assert.equal(entry.admin_email, "boss@example.com");
  assert.equal(entry.details.body.password, "[hidden]");
  await db.query("INSERT INTO admin_audit (action, created_at) VALUES ('PUT /ancient', '2019-01-01T00:00:00Z')");
  assert.ok(await audit.purgeOldAudit() >= 1);
  assert.equal((await audit.listAudit({ search: "ancient" })).length, 0);
});

run("edits made straight in the database are audited; the app's own edits are not written twice", async () => {
  const count = async (action) => Number((await db.one("SELECT COUNT(*) AS count FROM admin_audit WHERE action = $1", [action])).count);
  const before = await count("UPDATE plans");

  // The app changing a plan (it names its connections "reellingo-api"): skipped by the trigger.
  await db.query("UPDATE plans SET blurb = 'changed by the app' WHERE code = 'starter'");
  assert.equal(await count("UPDATE plans"), before);

  // Someone in the Supabase SQL editor.
  await directClient.query("UPDATE plans SET blurb = 'changed in the editor', price_ngn = 9999 WHERE code = 'starter'");
  assert.equal(await count("UPDATE plans"), before + 1);
  const row = await db.one("SELECT admin_id, admin_email, target, details FROM admin_audit WHERE action = 'UPDATE plans' ORDER BY id DESC LIMIT 1");
  assert.equal(row.admin_id, "database");
  assert.equal(row.target, "starter");
  const details = JSON.parse(row.details);
  assert.equal(details.before.blurb, "changed by the app");
  assert.equal(details.after.price_ngn, 9999);

  // Inserts and deletes too (settings, payments, minute grants).
  await directClient.query("INSERT INTO app_settings (key, value) VALUES ('maintenance_mode', 'true')");
  await directClient.query("DELETE FROM app_settings WHERE key = 'maintenance_mode'");
  await directClient.query("INSERT INTO minute_ledger (billing_id, delta, bucket, kind) VALUES ('someone', 500, 'topup', 'free_gift')");
  assert.equal(await count("INSERT app_settings"), 1);
  assert.equal(await count("DELETE app_settings"), 1);
  assert.equal(await count("INSERT minute_ledger"), 1);

  // Profiles: only becoming an admin or being suspended is logged, not the constant last-seen updates.
  await directClient.query("INSERT INTO profiles (user_id, email) VALUES ('edited', 'edited@example.com')");
  await directClient.query("UPDATE profiles SET name = 'New name', last_seen_at = now() WHERE user_id = 'edited'");
  assert.equal(await count("UPDATE profiles"), 0);
  await directClient.query("UPDATE profiles SET is_admin = TRUE WHERE user_id = 'edited'");
  assert.equal(await count("UPDATE profiles"), 1);

  // The app's own minute spending isn't doubled up.
  const ledgerBefore = await count("INSERT minute_ledger");
  await minutes.grantMinutes("someone", 1, "pack", { reference: "app-grant" });
  assert.equal(await count("INSERT minute_ledger"), ledgerBefore);
});
