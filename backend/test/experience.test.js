import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const run = promisify(execFile);

// A stand-in for OpenAI's chat API that translates every line to "[translated] …" (the SDK doesn't use the global fetch).
const fakeOpenAi = createServer((request, response) => {
  let body = "";
  request.on("data", (chunk) => { body += chunk; });
  request.on("end", () => {
    const messages = JSON.parse(body || "{}").messages || [];
    const lines = JSON.parse(messages[1]?.content || "[]");
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ segments: lines.map((line) => ({ index: line.index, text: `[translated] ${line.text}` })) }) } }],
      usage: { prompt_tokens: 10, completion_tokens: 10 },
    }));
  });
});
await new Promise((resolve) => fakeOpenAi.listen(0, "127.0.0.1", resolve));

const dataDirectory = await mkdtemp(join(tmpdir(), "reellingo-experience-"));
Object.assign(process.env, {
  OPENAI_BASE_URL: `http://127.0.0.1:${fakeOpenAi.address().port}/v1`,
  MOCK_MODE: "false",
  FEATURE_API: "true",
  OPENAI_API_KEY: "test-openai",
  ELEVENLABS_API_KEY: "test-elevenlabs",
  SPITCH_API_KEY: "test-spitch",
  SUPABASE_URL: "",
  SUPABASE_KEY: "",
  WORKER_MODE: "off",
  ADMIN_EMAILS: "boss@example.com",
  RESEND_API_KEY: "",
  DATABASE_URL: `sqlite:///${join(dataDirectory, "jobs.db").replaceAll("\\", "/")}`,
  LOCAL_STORAGE_DIR: join(dataDirectory, "storage"),
});

// Nothing here reaches a real provider: outside calls are answered by the handlers below (or fail the test).
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
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const { app } = await import("../server.js");
const database = await import("../src/database.js");
const { config } = await import("../src/config.js");
const { query } = await import("../src/db.js");
const { createApiKey } = await import("../src/auth.js");
const { activateSubscription } = await import("../src/billing.js");
const { ensureProfile, planFor } = await import("../src/accounts.js");
const spitch = await import("../src/spitch.js");
const { translate } = await import("../src/translation.js");
const { friendlyError, alertAdminsOnce, resetAlertThrottle } = await import("../src/friendly.js");
const { preflight, resetPreflightCache } = await import("../src/preflight.js");
const { setProviderBudget, clearUsageCache } = await import("../src/usage.js");
const { recordUsage } = await import("../src/costs.js");
const { publicSettings } = await import("../src/settings.js");

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

// ---------- Spitch: never more requests open than it allows ----------

test("Spitch is never asked for more calls at once than its tier allows, and a busy answer is retried", async () => {
  let open = 0;
  let mostAtOnce = 0;
  let refused = 0;
  mock(config.spitchApiUrl, async () => {
    open += 1;
    mostAtOnce = Math.max(mostAtOnce, open);
    await sleep(25);
    open -= 1;
    // Spitch's own message when a tier's limit is passed; the first call of the run is told to wait.
    if (refused === 0) {
      refused += 1;
      return json({ detail: { code: "concurrency_limit_exceeded", message: "Tier 1 allows 3 concurrent calls." } }, 429);
    }
    return json({ text: "translated" });
  });
  config.spitchConcurrency = 3;
  const results = await Promise.all(Array.from({ length: 12 }, (_, index) => spitch.spitchTranslateText(`line ${index}`, "yo", "en")));
  assert.equal(results.length, 12);
  assert.ok(results.every((text) => text === "translated"), "every line was translated, even though one was told to wait");
  assert.equal(refused, 1);
  assert.ok(mostAtOnce <= 3, `never more than 3 open at once (saw ${mostAtOnce})`);

  // The limit is a setting: with a higher Spitch tier, more run together.
  mostAtOnce = 0;
  config.spitchConcurrency = 6;
  await Promise.all(Array.from({ length: 12 }, (_, index) => spitch.spitchTranslateText(`line ${index}`, "yo", "en")));
  assert.ok(mostAtOnce > 3 && mostAtOnce <= 6, `a higher limit is used (saw ${mostAtOnce})`);
  config.spitchConcurrency = 3;
});

test("if Spitch can't translate, the backup translator finishes the video and the customer is told", async () => {
  mock(config.spitchApiUrl, () => json({ detail: "service unavailable for this language" }, 400)); // a refusal that retrying won't fix
  const notes = [];
  const segments = [{ start: 0, end: 2, text: "Good morning", language: "en" }, { start: 2, end: 4, text: "Welcome home", language: "en" }];
  const translated = await translate(segments, "yo", undefined, { onNote: (note) => notes.push(note) });
  assert.deepEqual(translated.map((segment) => segment.text), ["[translated] Good morning", "[translated] Welcome home"]);
  assert.ok(notes.some((note) => /backup translator/.test(note)));
  assert.ok(notes.some((note) => /tone marks/.test(note)), "a failed nice-to-have (tone marks) doesn't fail the video either");
});

// ---------- Readable failure messages ----------

test("provider errors become sentences a customer can act on", () => {
  const spitchBusy = friendlyError(new Error(`Spitch translation failed: Spitch translation (429): {"detail":{"code":"concurrency_limit_exceeded","message":"Tier 1 allows 3 concurrent calls."}}`));
  assert.equal(spitchBusy.kind, "busy");
  assert.match(spitchBusy.text, /press Retry/);
  assert.ok(!/429|Tier 1|concurrency/.test(spitchBusy.text), "no raw provider text");
  assert.equal(spitchBusy.alertsAdmin, false);

  const credit = friendlyError(new Error("OpenAI: You exceeded your current quota, please check your plan and billing details (insufficient_quota)"));
  assert.equal(credit.kind, "credit");
  assert.match(credit.text, /minutes were returned/);
  assert.equal(credit.alertsAdmin, true);

  assert.equal(friendlyError(new Error("Incorrect API key provided: sk-…")).kind, "keys");
  assert.equal(friendlyError(new Error("fetch failed")).kind, "network");
  assert.equal(friendlyError(new Error("This file has no audio track.")).text, "This file has no audio track.", "unknown problems keep their own words");
});

test("the admins are emailed once an hour about a problem on our side, not once per failed video", async () => {
  config.resendApiKey = "re_test";
  const email = mock("https://api.resend.com", () => json({ id: "e" }));
  resetAlertThrottle();
  assert.equal(await alertAdminsOnce("credit", "ReelLingo: out of credit", "details"), true);
  assert.equal(await alertAdminsOnce("credit", "ReelLingo: out of credit", "details"), false);
  assert.equal(await alertAdminsOnce("keys", "ReelLingo: key problem", "details"), true, "a different problem still gets its own email");
  assert.equal(await alertAdminsOnce("credit", "ReelLingo: out of credit", "details", Date.now() + 3601 * 1000), true, "and again after an hour");
  assert.equal(email.calls.length, 3);
  config.resendApiKey = "";
});

// ---------- Warn before starting ----------

async function useElevenLabs(limit, used) {
  mock("https://api.elevenlabs.io/v1/user/subscription", () => json({ tier: "free", character_count: used, character_limit: limit }));
  clearUsageCache();
  resetPreflightCache();
}

test("a video that can't be finished is refused up front, with a plain reason", async () => {
  await useElevenLabs(1000, 900); // 100 characters left
  const long = await preflight({ targets: ["en"], duration: 600, mode: "dub" });
  assert.equal(long.ok, false);
  assert.equal(long.blockers[0].code, "provider_credit");
  assert.match(long.blockers[0].message, /topping up one of our services/);
  assert.ok(long.blockers[0].needed > long.blockers[0].remaining);

  const tiny = await preflight({ targets: ["en"], duration: 3, mode: "dub" });
  assert.equal(tiny.ok, true, "a short clip fits in what is left");

  await useElevenLabs(100000, 0);
  assert.equal((await preflight({ targets: ["en", "fr"], duration: 600, mode: "dub" })).ok, true, "plenty of credit: fine");

  await useElevenLabs(1000, 1000);
  assert.equal((await preflight({ targets: ["en"], duration: 5, mode: "dub" })).ok, false, "no credit at all");
  assert.equal((await preflight({ targets: ["en"], duration: 600, mode: "subtitles" })).ok, true, "subtitles don't use the voice service");
  const native = await preflight({ targets: ["yo"], duration: 600, mode: "dub", cloned: false });
  assert.equal(native.ok, true, "native Nigerian voices come from Spitch, not the empty ElevenLabs balance");
  const cloned = await preflight({ targets: ["yo"], duration: 600, mode: "dub", cloned: true });
  assert.equal(cloned.ok, false, "but a cloned voice always uses ElevenLabs");
});

test("each service the video needs is checked: translation credit, native voices, lip-sync", async () => {
  await useElevenLabs(100000, 0);
  const budget = (provider) => setProviderBudget(provider, { amount: 1, unit: "usd", period: "one_time", started_at: "2020-01-01" });
  const spend = (provider, usd) => recordUsage({ provider, operation: "test", units: 1, unit: "usd", costUsd: usd, userId: "x" });

  await budget("openai");
  await spend("openai", 1.5);
  clearUsageCache();
  resetPreflightCache();
  assert.equal((await preflight({ targets: ["en"], duration: 60, mode: "subtitles" })).blockers[0].provider, "openai", "translation credit finished");

  await budget("spitch");
  await spend("spitch", 1.5);
  await budget("sync");
  await spend("sync", 1.5);
  await query("DELETE FROM provider_budgets WHERE provider = 'openai'");
  clearUsageCache();
  resetPreflightCache();
  const check = await preflight({ targets: ["yo"], duration: 60, mode: "dub", lipSync: true });
  assert.deepEqual(check.blockers.map((blocker) => blocker.provider).sort(), ["spitch", "sync"]);
  assert.match(check.blockers.find((blocker) => blocker.provider === "sync").message, /continue without lip-sync/);

  // The admin can turn the whole check off from Admin → App settings.
  config.blockOnEmptyProvider = false;
  assert.equal((await preflight({ targets: ["yo"], duration: 60, mode: "dub", lipSync: true })).ok, true);
  config.blockOnEmptyProvider = true;
  await query("DELETE FROM provider_budgets");
  clearUsageCache();
  resetPreflightCache();
  assert.equal((await preflight({ targets: ["yo"], duration: 60, mode: "dub", lipSync: true })).ok, true, "balances back to normal: allowed again");
});

test("the studio can ask first, nothing is charged when a video is refused, and admins can still try", async () => {
  await ensureProfile("asker", "asker@example.com");
  await activateSubscription("asker", "studio");
  await ensureProfile("boss", "boss@example.com");
  await activateSubscription("boss", "studio");
  const asker = { Authorization: `Bearer ${(await createApiKey("asker", "t")).key}`, "Content-Type": "application/json" };
  const boss = { Authorization: `Bearer ${(await createApiKey("boss", "t")).key}`, "Content-Type": "application/json" };
  await useElevenLabs(1000, 1000);

  const ask = (headers) => fetch(`${base}/jobs/preflight`, { method: "POST", headers, body: JSON.stringify({ mode: "dub", target_languages: ["en"], duration_seconds: 120, voice_mode: "clone" }) }).then((response) => response.json());
  const asked = await ask(asker);
  assert.equal(asked.ok, false);
  assert.match(asked.blockers[0].message, /new videos are paused/);
  const adminAsked = await ask(boss);
  assert.equal(adminAsked.ok, true);
  assert.ok(adminAsked.warnings.length > 0, "admins are shown the problem as a warning");

  // A real upload is refused before anything is stored or charged.
  const audio = join(dataDirectory, "clip.wav");
  await run("ffmpeg", ["-y", "-f", "lavfi", "-i", "sine=frequency=300:duration=2", audio]);
  const bytes = await readFile(audio);
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: "audio/wav" }), "clip.wav");
  for (const [key, value] of Object.entries({ rights_confirmed: "true", voice_consent: "true", source_language: "yo", target_language: "en" })) form.append(key, value);
  const before = (await planFor({ userId: "asker" })).minutes.available;
  const refused = await fetch(`${base}/jobs`, { method: "POST", headers: { Authorization: asker.Authorization }, body: form });
  assert.equal(refused.status, 503);
  const body = await refused.json();
  assert.equal(body.code, "provider_unavailable");
  assert.match(body.detail, /topping up/);
  assert.equal((await planFor({ userId: "asker" })).minutes.available, before, "no minutes were used");
  assert.equal((await database.listJobs("asker", 10)).length, 0, "and no project was created");

  // Once the service is topped up the same upload goes through.
  await useElevenLabs(100000, 0);
  const second = new FormData();
  second.append("file", new Blob([bytes], { type: "audio/wav" }), "clip.wav");
  for (const [key, value] of Object.entries({ rights_confirmed: "true", voice_consent: "true", source_language: "yo", target_language: "en" })) second.append(key, value);
  const accepted = await fetch(`${base}/jobs`, { method: "POST", headers: { Authorization: asker.Authorization }, body: second });
  assert.equal(accepted.status, 201, await accepted.clone().text());
});

// ---------- Waiting music is controlled from the admin ----------

test("the waiting-music settings reach the studio, and bad values can't", () => {
  const saved = { ...config.waitingMusic };
  try {
    assert.deepEqual(Object.keys(publicSettings().waiting_music).sort(), ["autoplay", "enabled", "style", "url", "volume"]);
    config.waitingMusic.enabled = false;
    config.waitingMusic.volume = 7;
    config.waitingMusic.url = "http://insecure.example/track.mp3";
    const shown = publicSettings().waiting_music;
    assert.equal(shown.enabled, false);
    assert.equal(shown.volume, 1, "volume is kept between 0 and 1");
    assert.equal(shown.url, "", "only https tracks are offered");
    config.waitingMusic.url = "https://cdn.example/calm.mp3";
    assert.equal(publicSettings().waiting_music.url, "https://cdn.example/calm.mp3");
  } finally {
    Object.assign(config.waitingMusic, saved);
  }
});
