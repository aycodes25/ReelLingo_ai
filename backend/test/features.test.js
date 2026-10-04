import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { run, getMediaInfo, runCapture } from "../src/media.js";
import { captionChunks, generateAss, generateVtt, mergeAudioVideo, aspectSize, writeAss, displaySize } from "../src/render.js";
import { mixDubWithBackground } from "../src/separation.js";
import { wordsToSegments } from "../src/transcription.js";
import { glossaryInstructions, translate } from "../src/translation.js";
import { assertPublicHost, classifyImportUrl } from "../src/importer.js";
import { allocate } from "../src/routes/jobs.js";
import { decrypt, encrypt, signState, verifyState } from "../src/secrets.js";
import { rankSpeakers } from "../src/dubbing.js";

async function makeVideo(path, seconds = 2, size = "320x240") {
  await run("ffmpeg", ["-y", "-f", "lavfi", "-i", `color=c=black:s=${size}:d=${seconds}:r=24`, "-f", "lavfi", "-i", `sine=frequency=440:duration=${seconds}`, "-shortest", "-c:v", "libx264", "-c:a", "aac", path]);
}

async function peak(path) {
  const { stderr } = await runCapture("ffmpeg", ["-v", "info", "-i", path, "-af", "volumedetect", "-f", "null", "-"]);
  return Number(stderr.match(/max_volume:\s*(-?\d+(?:\.\d+)?)/)[1]);
}

test("captions are split into readable chunks that share the segment's time", () => {
  const chunks = captionChunks({ start: 10, end: 14, text: "one two three four five six seven eight nine ten eleven twelve" }, 22);
  assert.ok(chunks.length >= 3);
  assert.equal(chunks[0].start, 10);
  assert.ok(Math.abs(chunks.at(-1).end - 14) < 1e-9);
  for (let index = 1; index < chunks.length; index += 1) assert.equal(chunks[index].start, chunks[index - 1].end);
  assert.ok(chunks.every((chunk) => chunk.words.join(" ").length <= 22 || chunk.words.length === 1));
});

test("karaoke subtitles time each word and escape override characters", () => {
  const ass = generateAss([{ start: 0, end: 2, text: "Hello {bad} world" }], { width: 1080, height: 1920, style: "karaoke" });
  assert.match(ass, /PlayResX: 1080/);
  assert.match(ass, /PlayResY: 1920/);
  const dialogue = ass.split("\n").find((line) => line.startsWith("Dialogue:"));
  assert.match(dialogue, /\{\\k\d+\}HELLO/);
  assert.doesNotMatch(dialogue.replace(/\{\\k\d+\}/g, ""), /[{}]/);
  const vtt = generateVtt([{ start: 1.5, end: 3.25, text: "Hi" }]);
  assert.match(vtt, /00:00:01\.500 --> 00:00:03\.250/);
});

test("reframed sizes keep resolution and use even dimensions", () => {
  assert.deepEqual(aspectSize({ width: 1920, height: 1080 }, "9:16"), { width: 1080, height: 1920 });
  assert.deepEqual(aspectSize({ width: 640, height: 360 }, "1:1"), { width: 360, height: 360 });
  assert.deepEqual(aspectSize({ width: 1080, height: 1920 }, "16:9"), { width: 1920, height: 1080 });
});

test("watermark, burned-in captions and vertical reframing render a valid video", async () => {
  const dir = await mkdtemp(join(tmpdir(), "reellingo-render-"));
  try {
    const source = join(dir, "source.mp4");
    const dub = join(dir, "dub.wav");
    await makeVideo(source, 2, "640x360");
    await run("ffmpeg", ["-y", "-f", "lavfi", "-i", "sine=frequency=880:duration=2", "-ac", "1", dub]);
    const info = await getMediaInfo(source);
    const target = aspectSize(displaySize(info), "9:16");
    const assPath = await writeAss(join(dir, "captions.ass"), [{ start: 0, end: 2, text: "Welcome to Lagos" }], { ...target, style: "bold" });
    const output = join(dir, "vertical.mp4");
    await mergeAudioVideo(source, dub, output, { watermark: true, assPath, aspect: "9:16" });
    const video = (await getMediaInfo(output)).streams.find((stream) => stream.codec_type === "video");
    assert.equal(Number(video.width), target.width);
    assert.equal(Number(video.height), target.height);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the dub is mixed over the separated background instead of replacing it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "reellingo-mix-"));
  try {
    const dub = join(dir, "dub.wav");
    const background = join(dir, "bg.wav");
    const silentDub = join(dir, "silent.wav");
    await run("ffmpeg", ["-y", "-f", "lavfi", "-i", "sine=frequency=500:duration=2", "-ac", "1", dub]);
    await run("ffmpeg", ["-y", "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono:d=3", silentDub]);
    await run("ffmpeg", ["-y", "-f", "lavfi", "-i", "sine=frequency=120:duration=3", "-ac", "2", background]);
    const mixed = await mixDubWithBackground(silentDub, background, join(dir, "mixed.wav"));
    assert.ok(await peak(mixed) > -30, "background music survives under a quiet dub");
    const info = await getMediaInfo(mixed);
    assert.ok(Math.abs(Number(info.format.duration) - 3) < 0.1, "output follows the dub track's length");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("diarized words become per-speaker segments that never mix voices", () => {
  const words = [
    { type: "word", text: "Hello", start: 0, end: 0.4, speaker_id: "speaker_0" }, { type: "spacing", text: " " },
    { type: "word", text: "there.", start: 0.4, end: 0.8, speaker_id: "speaker_0" }, { type: "spacing", text: " " },
    { type: "word", text: "Hi!", start: 0.9, end: 1.2, speaker_id: "speaker_1" },
    { type: "audio_event", text: "(laughs)", start: 1.2, end: 1.5 },
    { type: "word", text: "Later", start: 4, end: 4.5, speaker_id: "speaker_1" },
  ];
  const segments = wordsToSegments(words, "en");
  assert.deepEqual(segments.map((segment) => [segment.speaker, segment.text]), [["speaker_0", "Hello there."], ["speaker_1", "Hi!"], ["speaker_1", "Later"]]);
  assert.deepEqual(rankSpeakers([{ start: 0, end: 1, speaker: "a" }, { start: 1, end: 5, speaker: "b" }]).map((item) => item.speaker), ["b", "a"]);
});

test("glossary and tone are sent to the translator", async () => {
  const glossary = [{ term: "Iya Basira", translation: "" }, { term: "ọjà", translation: "market", target_language: "en" }, { term: "Oga", translation: "Boss", target_language: "fr" }];
  const rules = glossaryInstructions(glossary, "en", ["Iya Basira went to the ọjà"]);
  assert.match(rules, /keep exactly "Iya Basira"/);
  assert.match(rules, /"ọjà" → always translate as "market"/);
  assert.doesNotMatch(rules, /Oga/);
  let prompt = "";
  await translate([{ start: 0, end: 1, text: "Abeg", language: "pcm" }], "en", async (request) => {
    prompt = request.messages[0].content;
    return { choices: [{ message: { content: JSON.stringify({ segments: [{ index: 0, text: "Please" }] }) } }] };
  }, { glossary, tone: "keep_flavour" });
  assert.match(prompt, /local flavour/);
  assert.match(prompt, /Iya Basira/);
});

test("import links are classified, social sites are refused and private network targets are refused", async () => {
  // Social links are refused (their rules forbid downloading, and the creator may not own the video).
  assert.throws(() => classifyImportUrl("https://www.youtube.com/watch?v=abc"), /connect your channel/);
  assert.throws(() => classifyImportUrl("https://www.facebook.com/watch/?v=123"), /can't be imported/);
  assert.throws(() => classifyImportUrl("https://fb.watch/abc/"), /can't be imported/);
  assert.throws(() => classifyImportUrl("https://vm.tiktok.com/xyz"), /can't be imported/);
  assert.throws(() => classifyImportUrl("https://www.instagram.com/reel/abc/"), /can't be imported/);
  // A video from the creator's own (verified) YouTube channel is imported internally.
  const own = classifyImportUrl("youtube:dQw4w9WgXcQ");
  assert.equal(own.kind, "social");
  assert.equal(own.url.href, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  assert.match(classifyImportUrl("https://drive.google.com/file/d/1AbCdEfGhIjKlMn/view?usp=sharing").url.href, /drive\.usercontent\.google\.com\/download\?id=1AbCdEfGhIjKlMn/);
  assert.equal(classifyImportUrl("https://www.dropbox.com/s/x/video.mp4?dl=0").url.searchParams.get("dl"), "1");
  assert.throws(() => classifyImportUrl("ftp://example.com/video.mp4"), /http/);
  await assert.rejects(assertPublicHost(new URL("http://127.0.0.1/video.mp4")), /private network/);
  await assert.rejects(assertPublicHost(new URL("http://169.254.169.254/latest/meta-data")), /private network/);
  await assert.rejects(assertPublicHost(new URL("http://[::1]/x")), /private network/);
});

test("uploads are charged in minutes per language, with trimming and clear messages when minutes run out", () => {
  const plan = { maxVideoMinutes: 10, minutes: { available: 12 } };
  // 5 minutes into 2 languages = 10 minutes.
  assert.deepEqual(allocate(plan, ["en", "fr"], 300, {}), { perTarget: 5, total: 10, trimSeconds: null, weight: 1 });
  // Subtitles only use a tenth: 5 minutes of video = 0.5 minutes.
  assert.equal(allocate(plan, ["en"], 300, { mode: "subtitles" }).perTarget, 0.5);
  // Lip-sync adds 12 minutes per minute of video, human review 1.
  assert.equal(allocate({ ...plan, minutes: { available: 100 } }, ["en"], 60, { lipSync: true, humanReview: true }).perTarget, 14);
  // Longer than the plan allows: trim to the plan's limit, or explain.
  assert.equal(allocate({ ...plan, minutes: { available: 100 } }, ["en"], 20 * 60, { trimToFit: true }).trimSeconds, 600);
  assert.throws(() => allocate(plan, ["en"], 20 * 60, {}), (error) => error.status === 402 && error.extra.code === "too_long" && error.extra.can_trim);
  // Not enough minutes: 3 languages × 5 minutes = 15 > 12.
  assert.throws(() => allocate(plan, ["en", "fr", "ha"], 300, {}), (error) => error.extra.code === "minutes" && error.extra.needed === 15 && error.extra.available === 12);
  // …unless it may be trimmed to what's left: 12 minutes / 3 languages = 4 minutes each.
  assert.equal(allocate(plan, ["en", "fr", "ha"], 300, { trimToFit: true }).trimSeconds, 240);
  // Links with an unknown length are charged once downloaded.
  assert.equal(allocate(plan, ["en"], null, {}).total, 0);
});

test("integration tokens are encrypted and OAuth state is tamper-proof", () => {
  const sealed = encrypt({ refresh_token: "secret" });
  assert.doesNotMatch(sealed, /secret/);
  assert.equal(decrypt(sealed).refresh_token, "secret");
  const state = signState({ userId: "u1" });
  assert.equal(verifyState(state).userId, "u1");
  assert.equal(verifyState(`${state}x`), null);
  assert.equal(verifyState(signState({ userId: "u1" }, -10)), null);
});

test("backend/sql/schema.sql matches the schema in code (run `npm run sql` after changing tables)", async () => {
  const { readFile } = await import("node:fs/promises");
  const { postgresSchemaSql, SCHEMA } = await import("../src/db.js");
  const { planSeedSql } = await import("../src/plans.js");
  const onDisk = (await readFile(new URL("../sql/schema.sql", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
  assert.equal(onDisk, postgresSchemaSql(planSeedSql()));
  for (const table of SCHEMA) {
    assert.match(onDisk, new RegExp(`ALTER TABLE public\.${table.name} ENABLE ROW LEVEL SECURITY;`));
    assert.match(onDisk, new RegExp(`REVOKE ALL ON public\.${table.name} FROM anon, authenticated;`));
  }
  assert.doesNotMatch(onDisk, /DROP |DELETE FROM|TRUNCATE/i, "the schema file never removes data");
});

test("failure reasons are grouped into short readable lines", async () => {
  const { errorGroup } = await import("../src/routes/admin.js");
  assert.equal(
    errorGroup('Could not clone the speaker from this video (402): {"detail":{"type":"payment_required","message":"Your subscription does not include instant voice cloning."}}'),
    "Could not clone the speaker from this video (402): Your subscription does not include instant voice cloning.",
  );
  assert.equal(errorGroup(String.raw`Transcription failed for C:\Users\Hp\AppData\Local\Temp\reellingo-12-abc\chunk-0003.wav: Connection error.`), "Transcription failed for chunk-0003.wav: Connection error.");
  assert.equal(errorGroup("Transcription failed for /tmp/reellingo-7-x/chunks/chunk-0001.wav: Connection error."), "Transcription failed for chunk-0001.wav: Connection error.");
  assert.match(errorGroup("404 The model `gpt-4o-mini-tts` does not exist"), /gpt-4o-mini-tts/, "small numbers stay readable");
  assert.doesNotMatch(errorGroup("Too large in organization `org_01k2m9f4afwee7y8qy3fn1a2dt`"), /org_01/, "account IDs are hidden");
});
