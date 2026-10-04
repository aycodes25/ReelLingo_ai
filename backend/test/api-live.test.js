import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(stderr))));
  });
}

const dataDirectory = await mkdtemp(join(tmpdir(), "reellingo-live-api-"));
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
  PAYSTACK_SECRET_KEY: "paystack-test-secret",
  STRIPE_SECRET_KEY: "",
  STRIPE_WEBHOOK_SECRET: "whsec_test",
  CLAMAV_HOST: "",
  PUBLIC_API_URL: "http://127.0.0.1:0",
  DATABASE_URL: `sqlite:///${join(dataDirectory, "jobs.db").replaceAll("\\", "/")}`,
  LOCAL_STORAGE_DIR: join(dataDirectory, "storage"),
});

const { app } = await import("../server.js");
const database = await import("../src/database.js");
const { createApiKey } = await import("../src/auth.js");
const { activateSubscription, createCheckout } = await import("../src/billing.js");
const { applyReferral, ensureProfile, planFor } = await import("../src/accounts.js");
const { grantMinutes, minuteBalance } = await import("../src/minutes.js");
const { config } = await import("../src/config.js");
const { query } = await import("../src/db.js");

test("live API: uploads, batches, review, sharing, deletion, minutes and webhooks", async (context) => {
  await database.initializeDatabase();
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  config.publicApiUrl = baseUrl;
  context.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await database.closeDatabase();
    await rm(dataDirectory, { recursive: true, force: true });
  });

  const video = join(dataDirectory, "clip.mp4");
  await run("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=blue:s=320x240:d=3:r=24", "-f", "lavfi", "-i", "sine=frequency=300:duration=3", "-shortest", "-c:v", "libx264", "-c:a", "aac", video]);
  const videoBytes = await readFile(video);

  // Plans are public and come from one table.
  const plans = await fetch(`${baseUrl}/plans`).then((response) => response.json());
  assert.deepEqual(plans.plans.map((plan) => plan.code), ["free", "subtitles", "starter", "creator", "studio", "ministry", "agency"]);
  assert.equal(plans.packs.length, 4);
  assert.match(plans.plans.find((plan) => plan.code === "starter").features[0], /16 minutes of dubbing a month \(or 160 of subtitles\)/);
  assert.equal(plans.providers.paystack, true);

  // API keys only work on plans with API access.
  const freeKey = await createApiKey("free-user", "free");
  assert.equal((await fetch(`${baseUrl}/jobs`, { headers: { "X-API-Key": freeKey.key } })).status, 403);
  await activateSubscription("studio-user", "studio");
  const studioKey = await createApiKey("studio-user", "ci");
  const headers = { Authorization: `Bearer ${studioKey.key}` };
  assert.equal((await fetch(`${baseUrl}/jobs`, { headers })).status, 200);

  const upload = (fields) => {
    const form = new FormData();
    form.append("file", new Blob([videoBytes], { type: "video/mp4" }), "Lagos Market.mp4");
    for (const [key, value] of Object.entries({ rights_confirmed: "true", voice_consent: "true", ...fields })) form.append(key, value);
    return fetch(`${baseUrl}/jobs`, { method: "POST", headers, body: form });
  };
  const studioMinutes = async () => (await planFor({ userId: "studio-user" })).minutes;

  // Consent: everyone confirms they may use the video, and cloning needs the speakers' permission.
  const noRights = await upload({ source_language: "yo", target_language: "en", rights_confirmed: "false" });
  assert.equal(noRights.status, 400);
  assert.equal((await noRights.json()).code, "rights");
  const noConsent = await upload({ source_language: "yo", target_language: "en", voice_consent: "false" });
  assert.equal(noConsent.status, 400);
  assert.equal((await noConsent.json()).code, "voice_consent");
  assert.equal((await studioMinutes()).available, 125, "refused uploads use no minutes");

  // One upload, two target languages: the second job waits for the first one's transcript.
  const created = await upload({ source_language: "yo", target_languages: "en,fr", captions: "karaoke", formats: "9:16", review: "true", multi_speaker: "true" });
  assert.equal(created.status, 201, await created.clone().text());
  const batch = await created.json();
  assert.equal(batch.jobs.length, 2);
  const [leader, follower] = await Promise.all(batch.jobs.map((job) => database.getJob(job.id)));
  assert.equal(leader.batch_id, follower.batch_id);
  assert.equal(follower.depends_on, leader.id);
  assert.equal(leader.input_storage_path, follower.input_storage_path, "the upload is stored once");
  assert.equal(leader.priority, 3);
  assert.equal(leader.voice_clone, true);
  const { charge, rights_confirmed_at: rightsAt, voice_consent_at: consentAt, ...stored } = leader.options_json;
  assert.deepEqual(stored, {
    mode: "dub", review: true, keep_background: true, multi_speaker: true, tone: "natural", captions: "karaoke", formats: ["9:16"],
    lip_sync: false, human_review: false, trim_to_fit: false, watermark: false,
  });
  assert.ok(rightsAt && consentAt, "consent is recorded with a timestamp");
  // A 3-second video into 2 languages: 0.1 minute each (charges round up to the next 0.1 minute).
  assert.equal(charge.minutes, 0.1);
  assert.equal(charge.kind, "job");
  assert.equal((await studioMinutes()).available, 124.8);
  const claimed = await database.claimNextJob();
  assert.equal(claimed.id, leader.id, "the follower can't start before the leader has a transcript");
  assert.equal(await database.claimNextJob(), null);

  // Editing is refused while a job is still running.
  assert.equal((await fetch(`${baseUrl}/jobs/${leader.id}/segments`, { method: "PATCH", headers: { ...headers, "Content-Type": "application/json" }, body: "{}" })).status, 409);

  // Review flow: edit a translated line, then approve to continue.
  await database.updateJob(leader.id, {
    status: "awaiting_review", review_state: "pending",
    transcript_json: [{ start: 0, end: 1.5, text: "Bawo ni", language: "yo" }, { start: 1.5, end: 3, text: "E kaabo", language: "yo" }],
    translated_segments_json: [{ start: 0, end: 1.5, text: "How are you", language: "yo" }, { start: 1.5, end: 3, text: "Welcome", language: "yo" }],
  });
  assert.ok(await database.claimNextJob(), "the follower is released once the leader has a transcript");
  const edited = await fetch(`${baseUrl}/jobs/${leader.id}/segments`, {
    method: "PATCH", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ segments: [{ index: 1, text: "You are welcome" }] }),
  }).then((response) => response.json());
  assert.equal(edited.translated_segments[1].text, "You are welcome");
  const approved = await fetch(`${baseUrl}/jobs/${leader.id}/approve`, { method: "POST", headers }).then((response) => response.json());
  assert.equal(approved.status, "queued");
  assert.equal(approved.review_state, "approved");

  // A finished job can be shared on a public page whose links are re-signed on every visit.
  const { uploadBuffer } = await import("../src/storage.js");
  await uploadBuffer(`jobs/${leader.id}/output-test.mp4`, videoBytes, "video/mp4");
  await database.updateJob(leader.id, { status: "done", current_step: "done", duration_seconds: 3, outputs_json: [{ kind: "video", label: "Dubbed video (MP4)", path: `jobs/${leader.id}/output-test.mp4` }] });
  const shared = await fetch(`${baseUrl}/jobs/${leader.id}/share`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ enabled: true }) }).then((response) => response.json());
  assert.match(shared.share_url, /\/watch\/[\w-]+$/);
  const watch = await fetch(`${baseUrl}/public/watch/${shared.share_slug}`).then((response) => response.json());
  assert.equal(watch.target_language, "English");
  const file = await fetch(watch.video_url);
  assert.equal(file.status, 200);
  assert.equal(Buffer.from(await file.arrayBuffer()).length, videoBytes.length);
  assert.equal((await fetch(watch.video_url.replace(/sig=[^&]+/, "sig=forged"))).status, 403, "local files need a valid signature");
  assert.equal((await fetch(`${baseUrl}/files/jobs/${leader.id}/output-test.mp4`)).status, 403, "unsigned local file URLs are refused");

  // Re-dub: only finished jobs, and it goes back in the queue without re-transcribing.
  const redub = await fetch(`${baseUrl}/jobs/${leader.id}/redub`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ captions: "bold" }) }).then((response) => response.json());
  assert.equal(redub.status, "queued");
  assert.equal(redub.redub_count, 1);
  assert.equal(redub.options.captions, "bold");
  assert.equal((await database.getJob(leader.id)).transcript_json.length, 2);
  assert.equal(redub.minutes_charged, 0.1, "a re-dub pays only for the voice it regenerates");
  assert.equal((await studioMinutes()).available, 124.7);

  // A failed run gives its minutes back; Retry pays for it again.
  const { refundRun } = await import("../src/minutes.js");
  await database.updateJob(follower.id, { status: "failed", error_message: "boom" });
  assert.equal(await refundRun(await database.getJob(follower.id)), 0.1);
  assert.equal((await studioMinutes()).available, 124.8);
  const retried = await fetch(`${baseUrl}/jobs/${follower.id}/retry`, { method: "POST", headers }).then((response) => response.json());
  assert.equal(retried.status, "queued");
  assert.equal(retried.error_message, null);
  assert.equal((await studioMinutes()).available, 124.7);
  const retriedAgain = await fetch(`${baseUrl}/jobs/${follower.id}/retry`, { method: "POST", headers });
  assert.equal(retriedAgain.status, 409, "only failed jobs can be retried");

  // Deleting removes files and hides the project (and its share page).
  await database.updateJob(leader.id, { status: "done" });
  assert.equal((await fetch(`${baseUrl}/jobs/${leader.id}`, { method: "DELETE", headers })).status, 204);
  assert.equal((await fetch(`${baseUrl}/jobs/${leader.id}`, { headers })).status, 404);
  assert.equal((await fetch(`${baseUrl}/public/watch/${shared.share_slug}`)).status, 404);
  assert.equal((await fetch(watch.video_url)).status, 404, "the stored file is gone");

  // When the plan's minutes run out, uploads stop; extra minutes (packs, gifts) are used next and never expire.
  await query("INSERT INTO minute_ledger (billing_id, delta, bucket, kind) VALUES ('studio-user', -124.7, 'plan', 'test')");
  assert.equal((await studioMinutes()).available, 0);
  const blocked = await upload({ source_language: "yo", target_language: "en" });
  assert.equal(blocked.status, 402);
  const blockedBody = await blocked.json();
  assert.equal(blockedBody.code, "minutes");
  assert.equal(blockedBody.needed, 0.1);
  await grantMinutes("studio-user", 5, "pack", { reference: "test-pack" });
  const paid = await upload({ source_language: "yo", target_language: "en" });
  assert.equal(paid.status, 201);
  const minutesAfter = await studioMinutes();
  assert.equal(minutesAfter.topup_left, 4.9, "the extra minutes paid for it");
  assert.equal(minutesAfter.plan_left, 0);

  // Glossary.
  const glossary = await fetch(`${baseUrl}/glossary`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ term: "Iya Basira" }) }).then((response) => response.json());
  assert.equal(glossary[0].term, "Iya Basira");

  // Teams: a free team has one seat, so inviting asks for an upgrade.
  const team = await fetch(`${baseUrl}/teams`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ name: "Nolly Studio" }) }).then((response) => response.json());
  const invite = await fetch(`${baseUrl}/teams/${team.id}/invites`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ email: "editor@example.com" }) });
  assert.equal(invite.status, 400);
  assert.match((await invite.json()).detail, /Studio plan/);
  await activateSubscription(`team:${team.id}`, "studio");
  const invited = await fetch(`${baseUrl}/teams/${team.id}/invites`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ email: "editor@example.com" }) }).then((response) => response.json());
  assert.ok(invited.some((member) => member.email === "editor@example.com" && member.status === "invited"));
  const teamJobs = await fetch(`${baseUrl}/jobs`, { headers: { ...headers, "X-Workspace": String(team.id) } }).then((response) => response.json());
  assert.deepEqual(teamJobs, [], "team workspaces have their own project list");
  assert.equal((await fetch(`${baseUrl}/jobs`, { headers: { ...headers, "X-Workspace": "99999" } })).status, 403);

  // Paystack webhook: bad signatures are rejected; a valid charge adds the purchased minutes once.
  // (payg_15 is an old 15-minute pack: payments made before minutes existed are still honoured.)
  await query("INSERT INTO payments (user_id, billing_id, provider, reference, kind, credit_pack, amount, currency) VALUES ('studio-user', 'studio-user', 'paystack', 'rl_test_ref', 'payg', 'payg_15', 800000, 'NGN')");
  const event = JSON.stringify({ event: "charge.success", data: { reference: "rl_test_ref", customer: { customer_code: "CUS_1" } } });
  assert.equal((await fetch(`${baseUrl}/billing/webhooks/paystack`, { method: "POST", headers: { "x-paystack-signature": "bad" }, body: event })).status, 401);
  const signature = createHmac("sha512", "paystack-test-secret").update(event).digest("hex");
  for (let attempt = 0; attempt < 2; attempt += 1) {
    assert.equal((await fetch(`${baseUrl}/billing/webhooks/paystack`, { method: "POST", headers: { "x-paystack-signature": signature, "Content-Type": "application/json" }, body: event })).status, 200);
  }
  assert.equal((await studioMinutes()).topup_left, 19.9, "webhook retries don't add the minutes twice");

  // Referrals pay out when the invited friend makes their first payment (not when they sign up).
  await ensureProfile("friend", "friend@example.com");
  const studioProfile = await ensureProfile("studio-user", "studio@example.com");
  assert.equal((await applyReferral("friend", studioProfile.referral_code)).applied, true);
  await query("INSERT INTO payments (user_id, billing_id, provider, reference, kind, plan_code, amount, currency, billing_cycle) VALUES ('friend', 'friend', 'paystack', 'rl_friend_ref', 'subscription', 'starter', 1500000, 'NGN', 'monthly')");
  const friendEvent = JSON.stringify({ event: "charge.success", data: { reference: "rl_friend_ref", customer: { customer_code: "CUS_2" } } });
  const friendSignature = createHmac("sha512", "paystack-test-secret").update(friendEvent).digest("hex");
  assert.equal((await fetch(`${baseUrl}/billing/webhooks/paystack`, { method: "POST", headers: { "x-paystack-signature": friendSignature, "Content-Type": "application/json" }, body: friendEvent })).status, 200);
  assert.equal((await studioMinutes()).topup_left, 22.9, "the inviter gets 3 minutes");
  const friend = await planFor({ userId: "friend" });
  assert.equal(friend.tier, "starter");
  assert.equal(friend.minutes.plan_left, 16);
  assert.equal(friend.minutes.topup_left, 1, "the friend gets a 1-minute welcome bonus");

  // Paystack checkout: with a plan code the payment renews automatically (cards only); "pay once" leaves it out so
  // transfer and USSD are offered too. Yearly plans cost 10 months and use their own plan code.
  config.paystackPlanCodes.creator = "PLN_creator_test";
  config.paystackPlanCodes.creator_yearly = "PLN_creator_yearly_test";
  const sentToPaystack = [];
  const fetchBeforeCheckout = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (!String(url).startsWith("https://api.paystack.co/")) return fetchBeforeCheckout(url, options);
    sentToPaystack.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ status: true, data: { authorization_url: "https://checkout.paystack.com/x" } }), { status: 200 });
  };
  try {
    const buyer = { id: "studio-user", email: "studio@example.com" };
    await createCheckout({ provider: "paystack", user: buyer, billingId: "studio-user", planCode: "creator" });
    await createCheckout({ provider: "paystack", user: buyer, billingId: "studio-user", planCode: "creator", autoRenew: false });
    await createCheckout({ provider: "paystack", user: buyer, billingId: "studio-user", planCode: "creator", cycle: "yearly" });
    await createCheckout({ provider: "paystack", user: buyer, billingId: "studio-user", packCode: "min_15" });
    assert.equal(sentToPaystack[0].plan, "PLN_creator_test");
    assert.equal(sentToPaystack[0].amount, 3800000, "₦38,000 in kobo");
    assert.equal(sentToPaystack[1].plan, undefined, "pay once: no plan, so transfer and USSD are allowed");
    assert.equal(sentToPaystack[2].plan, "PLN_creator_yearly_test");
    assert.equal(sentToPaystack[2].amount, 38000000, "a year costs 10 months");
    assert.equal(sentToPaystack[3].amount, 1450000, "the 15-minute pack");
    const yearlyPayment = await query("SELECT billing_cycle FROM payments WHERE amount = 38000000");
    assert.equal(yearlyPayment.rows[0].billing_cycle, "yearly");
    await assert.rejects(createCheckout({ provider: "paystack", user: buyer, billingId: "studio-user", packCode: "nope" }), /no longer exists/);
  } finally {
    globalThis.fetch = fetchBeforeCheckout;
    delete config.paystackPlanCodes.creator;
    delete config.paystackPlanCodes.creator_yearly;
  }
  // A yearly plan still renews its minutes every month, on the day it was bought.
  const { activateSubscription: activate } = await import("../src/billing.js");
  await activate("yearly-user", "creator", { cycle: "yearly" });
  const yearly = await planFor({ userId: "yearly-user" });
  assert.equal(yearly.subscription.billing_cycle, "yearly");
  assert.equal(yearly.minutes.plan_left, 40);
  assert.ok(new Date(yearly.minutes.resets_at) - Date.now() < 32 * 86400000, "yearly plans reset minutes monthly");
  assert.ok(new Date(yearly.subscription.current_period_end) - Date.now() > 360 * 86400000);
  assert.ok((await minuteBalance("nobody")).available === 0);

  // Stripe webhook signatures are verified too.
  const stripeBody = JSON.stringify({ type: "customer.subscription.deleted", data: { object: { id: "sub_x" } } });
  const timestamp = Math.floor(Date.now() / 1000);
  const stripeSignature = createHmac("sha256", "whsec_test").update(`${timestamp}.${stripeBody}`).digest("hex");
  assert.equal((await fetch(`${baseUrl}/billing/webhooks/stripe`, { method: "POST", headers: { "stripe-signature": `t=${timestamp},v1=wrong` }, body: stripeBody })).status, 401);
  assert.equal((await fetch(`${baseUrl}/billing/webhooks/stripe`, { method: "POST", headers: { "stripe-signature": `t=${timestamp},v1=${stripeSignature}` }, body: stripeBody })).status, 200);
});
