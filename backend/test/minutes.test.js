import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const dataDirectory = await mkdtemp(join(tmpdir(), "reellingo-minutes-"));
Object.assign(process.env, {
  MOCK_MODE: "false",
  OPENAI_API_KEY: "test-openai",
  SUPABASE_URL: "",
  SUPABASE_KEY: "",
  WORKER_MODE: "off",
  DATABASE_URL: `sqlite:///${join(dataDirectory, "jobs.db").replaceAll("\\", "/")}`,
  LOCAL_STORAGE_DIR: join(dataDirectory, "storage"),
});

const database = await import("../src/database.js");
const { query } = await import("../src/db.js");
const { config } = await import("../src/config.js");
const minutes = await import("../src/minutes.js");
const { activateSubscription } = await import("../src/billing.js");
const { planFor } = await import("../src/accounts.js");
const reviews = await import("../src/reviews.js");
const { costPerMinute, paystackFee, profitReport } = await import("../src/profit.js");
const { spitchVoiceFor, useSpitchVoice } = await import("../src/spitch.js");

await database.initializeDatabase();
test.after(async () => {
  await database.closeDatabase();
  await rm(dataDirectory, { recursive: true, force: true });
});

test("plan minutes renew on the subscriber's own billing day, not on the 1st", () => {
  const end = new Date("2026-11-28T10:00:00Z");
  const window = minutes.allowanceWindow(end, new Date("2026-11-02T00:00:00Z"));
  assert.equal(window.start.toISOString(), "2026-10-28T10:00:00.000Z", "buying on the 28th doesn't get a fresh month on the 1st");
  assert.equal(window.end.toISOString(), "2026-11-28T10:00:00.000Z");
  // Yearly plans and admin "no expiry" plans still renew their minutes every month.
  const yearly = minutes.allowanceWindow("2027-03-15T00:00:00Z", new Date("2026-10-20T00:00:00Z"));
  assert.equal(yearly.start.toISOString(), "2026-10-15T00:00:00.000Z");
  assert.equal(yearly.end.toISOString(), "2026-11-15T00:00:00.000Z");
  const forever = minutes.allowanceWindow("2999-01-01T00:00:00Z", new Date("2026-10-20T00:00:00Z"));
  assert.equal(forever.start.toISOString(), "2026-10-01T00:00:00.000Z");
  // The 31st becomes the last day of shorter months.
  assert.equal(minutes.allowanceWindow("2027-01-31T00:00:00Z", new Date("2026-11-30T12:00:00Z")).start.toISOString(), "2026-11-30T00:00:00.000Z");
  // Free users (or an expired plan) use the calendar month.
  assert.equal(minutes.allowanceWindow(null, new Date("2026-10-20T00:00:00Z")).start.toISOString(), "2026-10-01T00:00:00.000Z");
});

test("minutes per job: dubbing, subtitles, lip-sync and human review, rounded up to 0.1", () => {
  assert.equal(minutes.jobMinutes({ durationSeconds: 90 }), 1.5);
  assert.equal(minutes.jobMinutes({ durationSeconds: 61 }), 1.1, "rounded up, never down");
  assert.equal(minutes.jobMinutes({ durationSeconds: 3 }), 0.1, "the smallest charge is 0.1");
  assert.equal(minutes.jobMinutes({ durationSeconds: 600, mode: "subtitles" }), 1);
  assert.equal(minutes.jobMinutes({ durationSeconds: 60, lipSync: true }), 13);
  assert.equal(minutes.jobMinutes({ durationSeconds: 60, mode: "subtitles", lipSync: true }), 0.1, "subtitles never lip-sync");
  assert.equal(minutes.jobMinutes({ durationSeconds: 120, humanReview: true }), 4);
  assert.equal(minutes.secondsAffordable(3, 1), 180);
});

test("spending uses plan minutes first, refunds return them, and old plan months refund as extra minutes", async () => {
  await activateSubscription("ada", "starter");
  const plan = await planFor({ userId: "ada" });
  assert.equal(plan.minutes.available, 16);
  const job = await database.createJob({ user_id: "ada", source_language: "yo", target_language: "en", options_json: { charge: minutes.newCharge(10, "job") } });
  await minutes.grantMinutes("ada", 5, "pack", { reference: "pack-1" });
  await minutes.ensureCharged(job, { billingId: "ada", allowance: 16, periodEnd: plan.periodEnd });
  await minutes.ensureCharged(job, { billingId: "ada", allowance: 16, periodEnd: plan.periodEnd });
  let balance = (await planFor({ userId: "ada" })).minutes;
  assert.equal(balance.plan_left, 6, "charging twice for the same run only charges once");
  assert.equal(balance.topup_left, 5);

  const second = await database.createJob({ user_id: "ada", source_language: "yo", target_language: "fr", options_json: { charge: minutes.newCharge(8, "job") } });
  await minutes.ensureCharged(second, { billingId: "ada", allowance: 16, periodEnd: plan.periodEnd });
  balance = (await planFor({ userId: "ada" })).minutes;
  assert.equal(balance.plan_left, 0);
  assert.equal(balance.topup_left, 3, "the rest came from extra minutes");
  await assert.rejects(
    minutes.ensureCharged(await database.createJob({ user_id: "ada", source_language: "yo", target_language: "ha", options_json: { charge: minutes.newCharge(4, "job") } }), { billingId: "ada", allowance: 16, periodEnd: plan.periodEnd }),
    (error) => error instanceof minutes.NotEnoughMinutes && error.needed === 4 && error.available === 3,
  );

  assert.equal(await minutes.refundRun(second), 8);
  balance = (await planFor({ userId: "ada" })).minutes;
  assert.equal(balance.plan_left, 6);
  assert.equal(balance.topup_left, 5);
  assert.equal(await minutes.refundRun(second), 0, "a run is refunded once");

  // A plan spend from a month that's over comes back as extra minutes (otherwise the new month would swallow it).
  const old = await database.createJob({ user_id: "ada", source_language: "yo", target_language: "sw", options_json: { charge: minutes.newCharge(2, "job") } });
  await query("INSERT INTO minute_ledger (billing_id, delta, bucket, kind, job_id, reference, created_at) VALUES ('ada', -2, 'plan', 'job', $1, $2, '2020-01-01 00:00:00')", [old.id, old.options_json.charge.run]);
  assert.equal(await minutes.refundRun(old), 2);
  assert.equal((await planFor({ userId: "ada" })).minutes.topup_left, 7);
});

test("old one-video credits become never-expiring minutes", async () => {
  await query("INSERT INTO credits (billing_id, max_minutes, source) VALUES ('legacy', 15, 'payg')");
  await query("INSERT INTO credits (billing_id, max_minutes, source, job_id) VALUES ('legacy', 30, 'payg', 99)");
  const balance = await minutes.minuteBalance("legacy");
  assert.equal(balance.topup_left, 15, "only unused credits are converted");
  assert.equal((await minutes.minuteBalance("legacy")).topup_left, 15, "and only once");
});

test("re-dubs are charged for the lines that changed, plus lip-sync for the whole video", () => {
  const segments = [{ text: "Hello there" }, { text: "Welcome to Lagos" }];
  const job = {
    duration_seconds: 120,
    translated_segments_json: segments,
    options_json: { dubbed_hashes: segments.map((segment) => minutes.lineHash(segment.text)) },
  };
  assert.equal(minutes.redubMinutes(job), 0, "nothing changed");
  const edited = { ...job, translated_segments_json: [segments[0], { text: "Welcome to Lagos!" }] };
  assert.equal(minutes.redubMinutes(edited), 1.3, "17 of 28 characters changed, of 2 minutes");
  assert.equal(minutes.redubMinutes({ ...job, options_json: { ...job.options_json, lip_sync: true } }), 24);
  assert.equal(minutes.redubMinutes({ ...job, options_json: {} }), 2, "unknown history: everything is re-voiced");
  assert.equal(minutes.redubMinutes({ ...job, options_json: { mode: "subtitles" } }), 0);
});

test("free users can never cost more than the free-tier budget", async () => {
  const before = await minutes.freeTierStatus();
  assert.equal(before.paused, false);
  const job = await database.createJob({ user_id: "freebie", source_language: "yo", target_language: "en", options_json: {}, plan_code: "free" });
  await query("INSERT INTO cost_events (job_id, user_id, provider, operation, units, unit, cost_usd) VALUES ($1, 'freebie', 'elevenlabs', 'speech', 1, 'characters', $2)", [job.id, config.freeMonthlyBudgetUsd]);
  const after = await minutes.freeTierStatus();
  assert.equal(after.spent_usd, config.freeMonthlyBudgetUsd);
  assert.equal(after.paused, true);
});

test("an unclaimed human review times out: the job continues and the review part is refunded", async () => {
  await activateSubscription("bola", "creator");
  const plan = await planFor({ userId: "bola" });
  const charge = minutes.newCharge(minutes.jobMinutes({ durationSeconds: 120, humanReview: true }), "job");
  let job = await database.createJob({ user_id: "bola", source_language: "yo", target_language: "en", options_json: { human_review: true, charge } });
  await minutes.ensureCharged(job, { billingId: "bola", allowance: plan.plan.minutes_per_month, periodEnd: plan.periodEnd });
  job = await database.updateJob(job.id, { duration_seconds: 120, status: "awaiting_review", review_state: "human_pending" });
  await reviews.openReviewTask(job);
  assert.equal((await planFor({ userId: "bola" })).minutes.available, 36);
  await query("UPDATE review_tasks SET created_at = '2020-01-01 00:00:00' WHERE job_id = $1", [job.id]);
  assert.equal(await reviews.expireStaleReviews(), 1);
  job = await database.getJob(job.id);
  assert.equal(job.status, "queued");
  assert.equal(job.options_json.human_review, false);
  assert.match(job.options_json.review_note, /No reviewer was free/);
  assert.equal((await planFor({ userId: "bola" })).minutes.available, 38, "the 2 review minutes came back");
  // If the dub then fails, the rest is refunded too, never more than was paid.
  assert.equal(await minutes.refundRun(job), 2);
  assert.equal((await planFor({ userId: "bola" })).minutes.available, 40);
});

test("profit check: every recommended price stays profitable at the worst case", async () => {
  const cost = costPerMinute();
  assert.ok(cost.dub_worst > 0.4 && cost.dub_worst < 0.6, `worst case per minute is about $0.45 (got ${cost.dub_worst})`);
  assert.ok(cost.dub_typical < cost.dub_worst);
  assert.equal(paystackFee(1000), 15, "no flat fee under ₦2,500");
  assert.equal(paystackFee(15000), 325);
  assert.equal(paystackFee(1000000), 2000, "capped");
  const report = await profitReport();
  assert.deepEqual(report.warnings, []);
  for (const row of report.rows.filter((item) => item.ngn?.revenue)) {
    assert.ok(row.ngn.worst_profit > 0, `${row.name} ${row.cycle} ₦ worst ${row.ngn.worst_profit}`);
    assert.ok(row.usd.worst_profit > 0, `${row.name} ${row.cycle} $ worst ${row.usd.worst_profit}`);
  }
  const free = report.rows.find((row) => row.code === "free");
  assert.ok(free.free.users_covered_by_budget > 0);
  // A weaker naira is caught: at ₦2,500 per dollar the yearly plans would lose money.
  const saved = config.ngnPerUsd;
  config.ngnPerUsd = 2500;
  try {
    assert.ok((await profitReport()).warnings.length > 0);
  } finally {
    config.ngnPerUsd = saved;
  }
});

test("Nigerian voices: Spitch is used for Yoruba, Hausa, Igbo and Pidgin, never for cloned voices", () => {
  const saved = config.spitchApiKey;
  try {
    config.spitchApiKey = "";
    assert.equal(useSpitchVoice("yo"), false, "not without a key");
    config.spitchApiKey = "key";
    assert.equal(useSpitchVoice("yo"), true);
    assert.equal(useSpitchVoice("ha"), true);
    assert.equal(useSpitchVoice("en"), false);
    assert.equal(useSpitchVoice("yo", { cloned: true }), false);
    config.nigerianVoiceEngine = "elevenlabs";
    assert.equal(useSpitchVoice("yo"), false, "the admin can turn it off");
  } finally {
    config.spitchApiKey = saved;
    config.nigerianVoiceEngine = "auto";
  }
  assert.equal(spitchVoiceFor("yo", 0), "femi");
  assert.equal(spitchVoiceFor("yo", 1), "sade", "a second speaker gets a different voice");
  assert.equal(spitchVoiceFor("yo", 0, "funmi"), "funmi");
  assert.notEqual(spitchVoiceFor("yo", 1, "funmi"), "funmi");
});

test("referral rewards wait for a payment big enough to pay for them", async () => {
  const { applyReferral, ensureProfile, rewardReferralIfDue } = await import("../src/accounts.js");
  await ensureProfile("host", "host@example.com");
  const host = await ensureProfile("host", "host@example.com");
  await ensureProfile("guest", "guest@example.com");
  assert.equal((await applyReferral("guest", host.referral_code)).applied, true);
  const starter = { kind: "subscription", plan_code: "starter", billing_cycle: "monthly", amount: 1500000, currency: "NGN" };
  assert.equal(await rewardReferralIfDue("guest", { kind: "subscription", plan_code: "subtitles", billing_cycle: "monthly", amount: 450000, currency: "NGN" }), false, "a ₦4,500 Subtitles plan doesn't qualify");
  assert.equal(await rewardReferralIfDue("guest", { kind: "subscription", plan_code: "subtitles", billing_cycle: "yearly", amount: 4500000, currency: "NGN" }), false, "nor does a yearly Subtitles plan (too little profit)");
  assert.equal(await rewardReferralIfDue("guest", { kind: "payg", credit_pack: "min_5", amount: 500000, currency: "NGN" }), false, "nor a 5-minute pack");
  assert.equal(await rewardReferralIfDue("guest", starter), true, "a ₦15,000 Starter plan does");
  assert.equal(await rewardReferralIfDue("guest", starter), false, "only once");
  assert.equal((await minutes.minuteBalance("host")).topup_left, 3);
  assert.equal((await minutes.minuteBalance("guest")).topup_left, 1);
  const report = await profitReport();
  assert.ok(report.referral.qualifying.includes("Starter (monthly)"));
  assert.ok(!report.referral.qualifying.includes("Subtitles (monthly)"));
});
