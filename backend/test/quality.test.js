import assert from "node:assert/strict";
import test from "node:test";

process.env.OPENAI_API_KEY = "test";
const { reviewTranslation, compareDub, similarity, normalizeText, alternateFor, speakerSummary } = await import("../src/quality.js");

const answer = (lines) => async () => ({ choices: [{ message: { content: JSON.stringify({ lines }) } }], usage: { prompt_tokens: 1, completion_tokens: 1 } });

test("text is compared without accents, case or punctuation", () => {
  assert.equal(normalizeText("Báwo ni, Ẹ kú àárọ̀!"), "bawo ni e ku aaro");
  assert.equal(similarity("Báwo ni?", "bawo ni"), 1);
  assert.ok(similarity("Mo fẹ́ jẹun", "Ọkọ̀ ofurufú") < 0.4);
  assert.equal(similarity("", ""), 1);
  assert.equal(similarity("a", ""), 0);
});

test("a second engine's version of a line is found by time", () => {
  const alt = [{ start: 0, end: 2, text: "hello there" }, { start: 5, end: 6, text: "far away" }];
  assert.equal(alternateFor({ start: 0.2, end: 1.9 }, alt), "hello there");
  assert.equal(alternateFor({ start: 3, end: 4 }, alt), "");
});

test("speakers are counted with how long each one talks", () => {
  const summary = speakerSummary([
    { start: 0, end: 5, speaker: "speaker_1" }, { start: 5, end: 7, speaker: "speaker_0" }, { start: 8, end: 10, speaker: "speaker_1" },
  ]);
  assert.equal(summary.count, 2);
  assert.deepEqual(summary.people[0], { id: "speaker_1", seconds: 7 });
});

test("serious translation errors are counted and corrected, minor ones are only reported, and the transcript can be corrected", async () => {
  const transcript = [{ start: 0, end: 2, text: "I want to buy rice", speaker: "a" }, { start: 2, end: 4, text: "How much is it", speaker: "b" }, { start: 4, end: 6, text: "Thank you", speaker: "a" }];
  const translated = [{ ...transcript[0], text: "Mo fẹ́ ra ẹja" }, { ...transcript[1], text: "Elo ni èyí" }, { ...transcript[2], text: "O ṣé" }];
  const asked = [];
  const complete = async (request) => {
    asked.push(JSON.parse(request.messages[1].content));
    return answer([
      { index: 0, severity: "major", problem: "Says fish instead of rice.", fix: "Mo fẹ́ ra ìrẹsì" },
      { index: 1, corrected_heard: "How much is this", severity: "minor", problem: "A bit stiff.", fix: "Elo ni èyí nìyí" },
      { index: 7, severity: "major", problem: "not a real line", fix: "x" },
    ])();
  };
  const result = await reviewTranslation({
    transcript, translated, alternate: [{ start: 0, end: 2, text: "I want to buy rice" }], sourceLanguage: "en", targetLanguage: "yo", requestCompletion: complete, autoFix: true,
  });
  assert.equal(asked[0][0].second_opinion, "I want to buy rice");
  assert.equal(asked[0][1].second_opinion, "", "no second opinion for that moment");
  assert.equal(result.translated[0].text, "Mo fẹ́ ra ìrẹsì", "serious error fixed");
  assert.equal(result.translated[1].text, "Elo ni èyí", "minor ones are left as they are");
  assert.equal(result.transcript[1].text, "How much is this", "transcript corrected");
  assert.equal(result.report.translation.errors, 2);
  assert.equal(result.report.translation.major, 1);
  assert.equal(result.report.translation.fixed, 1);
  assert.equal(result.report.transcript.corrected, 1);
  assert.equal(result.report.translation.issues[0].line, 1);
  assert.equal(result.changed, true);
  assert.equal(result.translated[2].text, "O ṣé");
});

test("with auto-fix off, errors are reported but nothing is changed; a bad fix is never applied", async () => {
  const transcript = [{ start: 0, end: 1, text: "Good morning", speaker: "a" }];
  const translated = [{ ...transcript[0], text: "Ẹ kú àárọ̀" }];
  const off = await reviewTranslation({ transcript, translated, sourceLanguage: "en", targetLanguage: "yo", autoFix: false, requestCompletion: answer([{ index: 0, severity: "major", problem: "x", fix: "Ẹ kú alẹ́" }]) });
  assert.equal(off.translated[0].text, "Ẹ kú àárọ̀");
  assert.equal(off.report.translation.errors, 1);
  assert.equal(off.report.translation.fixed, 0);
  const rambling = await reviewTranslation({ transcript, translated, sourceLanguage: "en", targetLanguage: "yo", autoFix: true, requestCompletion: answer([{ index: 0, severity: "major", problem: "x", fix: "Ẹ kú àárọ̀ ".repeat(8) }]) });
  assert.equal(rambling.translated[0].text, "Ẹ kú àárọ̀", "a much longer 'fix' is refused");
});

test("when the proofreader is unavailable the job is not blocked and the report says it is incomplete", async () => {
  const notes = [];
  const result = await reviewTranslation({
    transcript: [{ start: 0, end: 1, text: "Hi" }], translated: [{ start: 0, end: 1, text: "Báwo" }], sourceLanguage: "en", targetLanguage: "yo",
    requestCompletion: async () => { throw Object.assign(new Error("down"), { status: 400 }); }, onNote: (note) => notes.push(note),
  });
  assert.equal(result.changed, false);
  assert.equal(result.report.complete, false);
  assert.equal(notes.length, 1);
});

test("the dub is checked line by line against what it should say", () => {
  const translated = [{ text: "Mo fẹ́ ra ìrẹsì" }, { text: "Elo ni èyí" }, { text: "O ṣé gan-an" }];
  const words = [
    ...["Mo", "fe", "ra", "iresi"].map((text, i) => ({ text, start: 0.1 + i * 0.3, end: 0.3 + i * 0.3, type: "word" })),
    ...["Ounje", "dun"].map((text, i) => ({ text, start: 2.1 + i * 0.4, end: 2.4 + i * 0.4, type: "word" })),
    ...["O", "se", "gan", "an"].map((text, i) => ({ text, start: 4.1 + i * 0.3, end: 4.3 + i * 0.3, type: "word" })),
  ];
  const timeline = [[0, 0, 1.5, 1, 1.5], [1, 2, 3, 1.4, 1], [2, 4, 5.5, 1.1, 1.5]];
  const report = compareDub({ words, timeline, translated, targetLanguage: "yo", heardLanguage: "yo" });
  assert.equal(report.lines, 3);
  assert.equal(report.mismatched_count, 1);
  assert.equal(report.mismatched[0].line, 2);
  assert.equal(report.mismatched[0].heard, "Ounje dun");
  assert.equal(report.matched_percent, 67);
  assert.equal(report.rushed, 1);
  assert.equal(report.fastest, 1.4);
  assert.equal(report.language_ok, true);
  assert.equal(compareDub({ words, timeline, translated, targetLanguage: "yo", heardLanguage: "en" }).language_ok, false);
  assert.equal(compareDub({ words, timeline, translated, targetLanguage: "pcm", heardLanguage: "en" }).language_ok, true, "Pidgin is heard as English");
});
