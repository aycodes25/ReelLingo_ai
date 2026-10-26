import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

process.env.OPENAI_API_KEY = "test";
const { config } = await import("../src/config.js");
const { fitLines, shortenLines, speechSeconds, availableSeconds } = await import("../src/fitlines.js");
const { layoutDubTimeline, retimeToDub } = await import("../src/dubbing.js");

const dir = await mkdtemp(join(tmpdir(), "dubq-"));
const run = (command, args) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { stdio: "ignore" });
  child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`))));
});
const tone = async (name, seconds) => {
  const path = join(dir, name);
  await run("ffmpeg", ["-y", "-f", "lavfi", "-i", `sine=frequency=440:duration=${seconds}`, "-ac", "1", "-ar", "24000", "-c:a", "libmp3lame", path]);
  return path;
};

const chat = (answer) => async () => ({ choices: [{ message: { content: JSON.stringify({ segments: answer }) } }], usage: { prompt_tokens: 1, completion_tokens: 1 } });

test("only lines that cannot be said in the time available are shortened, and bad rewrites are ignored", async () => {
  const segments = [
    { start: 0, end: 1, text: "Bẹ́ẹ̀ni." },
    { start: 1, end: 2, text: "Ẹ kú àárọ̀ gbogbo ènìyàn, inú mi dùn púpọ̀ láti rí yín lónìí níbí." },
    { start: 6, end: 8, text: "Ó dára." },
  ];
  const asked = [];
  const complete = async (request) => {
    asked.push(JSON.parse(request.messages[1].content));
    return { choices: [{ message: { content: JSON.stringify({ segments: [{ index: 1, text: "Ẹ kú àárọ̀, inú mi dùn." }] }) } }], usage: {} };
  };
  const result = await fitLines(segments, "yo", 10, { requestCompletion: complete });
  assert.deepEqual(asked.map((batch) => batch.map((line) => line.index)), [[1]]);
  assert.equal(result.shortened, 1);
  assert.equal(result.segments[1].text, "Ẹ kú àárọ̀, inú mi dùn.");
  assert.equal(result.segments[0].text, segments[0].text, "short lines are untouched");

  const longer = await shortenLines([{ index: 0, text: "Ó dára.", maxCharacters: 3 }], "yo", { requestCompletion: chat([{ index: 0, text: "Ó dára gan-an ni gbogbo nǹkan" }]) });
  assert.equal(longer.size, 0, "a rewrite that is not shorter is rejected");
  const empty = await shortenLines([{ index: 0, text: "Ó dára pupọ.", maxCharacters: 3 }], "yo", { requestCompletion: chat([{ index: 0, text: "" }]) });
  assert.equal(empty.size, 0);
});

test("shortening can be switched off and never throws", async () => {
  const segments = [{ start: 0, end: 1, text: "Ẹ kú àárọ̀ gbogbo ènìyàn, inú mi dùn púpọ̀ láti rí yín lónìí níbí." }];
  config.fitLines = false;
  assert.equal((await fitLines(segments, "yo", 5, { requestCompletion: chat([]) })).shortened, 0);
  config.fitLines = true;
  const notes = [];
  const failing = async () => { throw Object.assign(new Error("boom"), { status: 400 }); };
  const result = await fitLines(segments, "yo", 5, { requestCompletion: failing, onNote: (note) => notes.push(note) });
  assert.equal(result.segments[0].text, segments[0].text);
  assert.equal(notes.length, 1);
});

test("a line may borrow time from the next one, but the delay stays within the drift budget and is gone after a pause", async () => {
  config.dubMaxDrift = 2.5;
  config.dubMaxSpeed = 1.25;
  const a = await tone("a.mp3", 3);
  const b = await tone("b.mp3", 1);
  const c = await tone("c.mp3", 1);
  const clips = [
    { index: 0, path: a, start: 0, end: 1.5 },
    { index: 1, path: b, start: 2, end: 3 },
    { index: 2, path: c, start: 10, end: 11 },
  ];
  const { placements } = await layoutDubTimeline(clips, 20, join(dir, "track.wav"));
  assert.ok(placements[0].speed <= 1.5 + 1e-9);
  assert.ok(placements[1].start - clips[1].start <= 2.5 + 0.01, "within the drift budget");
  assert.ok(Math.abs(placements[2].start - 10) < 0.01, "back in step after a pause");
  for (let i = 1; i < placements.length; i += 1) assert.ok(placements[i].start >= placements[i - 1].end - 0.01, "lines never overlap");
});

test("natural-length lines are not sped up at all", async () => {
  const a = await tone("n.mp3", 1);
  const { placements } = await layoutDubTimeline([{ index: 0, path: a, start: 1, end: 3 }], 5, join(dir, "natural.wav"));
  assert.equal(placements[0].speed, 1);
  assert.ok(Math.abs(placements[0].start - 1) < 0.01);
});

test("subtitles are timed from where each voice line landed", () => {
  const segments = [{ start: 0, end: 1, text: "a" }, { start: 2, end: 3, text: "b" }, { start: 4, end: 5, text: "c" }];
  const timeline = [[0, 0.1, 1.4, 1.1, 1.5], [2, 5.2, 6.1, 1.25, 1.1]];
  const timed = retimeToDub(segments, timeline);
  assert.deepEqual(timed.map((line) => [line.start, line.end]), [[0.1, 1.4], [2, 3], [5.2, 6.1]]);
  assert.equal(retimeToDub(segments, undefined), segments);
});

test("speech length estimates and available time", () => {
  assert.ok(speechSeconds("a".repeat(25), "yo") > 1.9 && speechSeconds("a".repeat(25), "yo") < 2.1);
  const lines = [{ start: 0, end: 1 }, { start: 3, end: 4 }];
  assert.equal(availableSeconds(lines, 0, 10), 3, "its own slot plus the pause after it");
  assert.equal(availableSeconds(lines, 1, 10), 7);
});

test("the dub track length still matches the video", async () => {
  const a = await tone("len.mp3", 1);
  const path = join(dir, "len.wav");
  await layoutDubTimeline([{ index: 0, path: a, start: 0, end: 1 }], 4, path);
  assert.equal((await readFile(path)).length, 44 + 4 * 24000 * 2);
});
