import OpenAI from "openai";
import { config } from "./config.js";
import { recordChatUsage } from "./costs.js";
import { getLanguage } from "./languages.js";
import { logger } from "./logger.js";
import { withRetries } from "./retry.js";
import { addYorubaToneMarks, spitchConfigured } from "./spitch.js";

const BATCH = 25;
const MAX_LISTED = 30;

let ai;
async function defaultComplete(request) {
  if (!config.openaiApiKey) throw new Error("OPENAI_API_KEY is required for the quality check.");
  ai ||= new OpenAI({ apiKey: config.openaiApiKey, baseURL: config.openaiBaseUrl, timeout: 180_000 });
  return ai.chat.completions.create(request);
}

/** Lower-case letters and digits only, accents removed, so "Báwo ni?" and "bawo ni" count as the same words. */
export function normalizeText(text) {
  return String(text || "").normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function editDistance(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[b.length];
}

/** 0 to 1: how alike two pieces of text are once accents, case and punctuation are ignored. */
export function similarity(first, second) {
  const a = normalizeText(first);
  const b = normalizeText(second);
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  return 1 - editDistance(a, b) / Math.max(a.length, b.length);
}

/**
 * How well `line` appears somewhere inside `heard` (0 to 1). In quick conversation the words just before and after a line fall
 * inside its time window, so the line is looked for inside what was heard instead of being compared with all of it.
 */
export function containedSimilarity(line, heard) {
  const a = normalizeText(line);
  const b = normalizeText(heard);
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  // Approximate substring search: the cheapest way to turn `a` into any piece of `b`.
  let previous = Array.from({ length: a.length + 1 }, (_, index) => index);
  let best = previous[a.length];
  for (let j = 1; j <= b.length; j += 1) {
    const current = [0];
    for (let i = 1; i <= a.length; i += 1) {
      current[i] = Math.min(previous[i] + 1, current[i - 1] + 1, previous[i - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    best = Math.min(best, current[a.length]);
    previous = current;
  }
  return Math.max(0, 1 - best / a.length);
}

/** What a second speech-to-text engine heard during this line's time. */
export function alternateFor(segment, alternateSegments) {
  const parts = alternateSegments.filter((other) => {
    const overlap = Math.min(segment.end, other.end) - Math.max(segment.start, other.start);
    return overlap > 0.4 * Math.min(other.end - other.start, segment.end - segment.start);
  });
  return parts.map((part) => part.text).join(" ").trim();
}

export function speakerSummary(transcript) {
  const talk = new Map();
  for (const segment of transcript) {
    const id = segment.speaker || "speaker_0";
    talk.set(id, (talk.get(id) || 0) + Math.max(0, segment.end - segment.start));
  }
  const people = [...talk.entries()].sort((x, y) => y[1] - x[1]).map(([id, seconds]) => ({ id, seconds: Math.round(seconds * 10) / 10 }));
  return { count: people.length, people };
}

/**
 * Reads every line the way a careful bilingual proofreader would: is what was written down what was probably said (with a second
 * engine's version to compare), and does the translation say the same thing in natural spoken language? Only real problems are
 * reported. Serious translation errors are corrected when the setting allows it.
 */
export async function reviewTranslation({ transcript, translated, alternate = null, sourceLanguage, targetLanguage, autoFix = config.qualityAutoFix, requestCompletion, onNote }) {
  const complete = requestCompletion || defaultComplete;
  const target = getLanguage(targetLanguage)?.name || targetLanguage;
  const source = getLanguage(sourceLanguage)?.name || "the spoken language";
  const items = transcript.map((segment, index) => ({
    index,
    heard: segment.text,
    ...(alternate ? { second_opinion: alternateFor(segment, alternate) } : {}),
    translation: translated[index]?.text || "",
  }));
  const doubtful = alternate ? items.filter((item) => item.second_opinion && similarity(item.heard, item.second_opinion) < 0.6).length : 0;

  const nextTranscript = transcript.map((segment) => ({ ...segment }));
  const nextTranslated = translated.map((segment) => ({ ...segment }));
  const issues = [];
  let transcriptFixed = 0;
  let failed = false;
  for (let offset = 0; offset < items.length; offset += BATCH) {
    const batch = items.slice(offset, offset + BATCH);
    let answers = [];
    try {
      const response = await withRetries(() => complete({
        model: config.openaiChatModel,
        response_format: { type: "json_object" },
        temperature: 0,
        messages: [
          {
            role: "system",
            content: `You are a strict bilingual proofreader checking a video dub from ${source} into ${target}. Each line has "heard" (a speech-to-text transcript), sometimes "second_opinion" (what a second engine heard for the same moment), and "translation" (into ${target}).
For each line decide two things.
1. Transcript: if "heard" is clearly wrong (misheard words, wrong names) and the second opinion or the context shows what was really said, give "corrected_heard". Do not change spellings or punctuation that are only a matter of style.
2. Translation: does it say what was said, in natural spoken ${target}? Report "major" if the meaning is wrong, words are missing or invented, a name is wrong, or it is in the wrong language; "minor" for awkward but understandable wording. Give "fix": the corrected ${target} line, about the same length or shorter, for every line you report.
Report ONLY lines that have a problem. Return JSON {"lines":[{"index":0,"corrected_heard":"…or omit","severity":"major|minor","problem":"one short plain-English sentence","fix":"…"}]}. If everything is fine return {"lines":[]}.`,
          },
          { role: "user", content: JSON.stringify(batch) },
        ],
      }), { label: "Quality review", baseDelayMs: 1000 });
      await recordChatUsage("quality_review", response.usage);
      answers = JSON.parse(response.choices[0]?.message?.content || "{}").lines;
      if (!Array.isArray(answers)) answers = [];
    } catch (error) {
      failed = true;
      logger.warn({ err: error }, "Quality review of a batch failed");
      continue;
    }
    for (const answer of answers) {
      const index = Number(answer?.index);
      const line = batch.find((item) => item.index === index);
      if (!line) continue;
      const corrected = String(answer.corrected_heard || "").trim();
      if (corrected && normalizeText(corrected) !== normalizeText(line.heard)) {
        nextTranscript[index].text = corrected;
        transcriptFixed += 1;
      }
      const severity = answer.severity === "major" ? "major" : answer.severity === "minor" ? "minor" : null;
      if (!severity) continue;
      let fix = String(answer.fix || "").trim();
      // Only take a fix that is a real, sensible replacement.
      const usable = fix && normalizeText(fix) !== normalizeText(line.translation) && fix.length <= Math.max(line.translation.length * 1.3, line.translation.length + 12);
      let fixed = false;
      if (usable && severity === "major" && autoFix) {
        if (targetLanguage === "yo" && !requestCompletion && config.yorubaToneMarks && spitchConfigured()) fix = await addYorubaToneMarks(fix).catch(() => fix);
        nextTranslated[index].text = fix;
        fixed = true;
      }
      issues.push({ line: index + 1, severity, problem: String(answer.problem || "").slice(0, 200), before: line.translation, after: usable ? fix : null, fixed });
    }
  }
  if (failed) onNote?.("Part of the automatic quality check could not run this time.");
  const major = issues.filter((issue) => issue.severity === "major").length;
  return {
    transcript: nextTranscript,
    translated: nextTranslated,
    changed: transcriptFixed > 0 || issues.some((issue) => issue.fixed),
    report: {
      transcript: { second_opinion: Boolean(alternate), doubtful, corrected: transcriptFixed },
      translation: {
        checked: items.length, errors: issues.length, major, minor: issues.length - major,
        fixed: issues.filter((issue) => issue.fixed).length, issues: issues.slice(0, MAX_LISTED),
      },
      complete: !failed,
    },
  };
}

/** Languages whose speech-to-text tends to report a close neighbour (Pidgin is heard as English). */
function sameLanguage(heard, wanted) {
  if (!heard || !wanted) return true;
  if (heard === wanted) return true;
  return wanted === "pcm" && heard === "en";
}

/**
 * Compares what the dubbed voice actually says (heard by speech-to-text) with what it was meant to say, line by line,
 * using where each line was placed in the dub. words: [{ text, start, end }].
 */
export function compareDub({ words, timeline, translated, targetLanguage, heardLanguage }) {
  const spoken = words.filter((word) => word.type !== "spacing" && word.type !== "audio_event" && String(word.text || "").trim());
  const mismatched = [];
  let matched = 0;
  for (const [index, start, end] of timeline) {
    const intended = translated[index]?.text || "";
    const heard = spoken
      .filter((word) => {
        const middle = (Number(word.start) + Number(word.end)) / 2;
        return middle >= start - 0.4 && middle <= end + 0.4;
      })
      .map((word) => word.text).join(" ");
    const score = containedSimilarity(intended, heard);
    // Speech-to-text is itself imperfect in low-resource languages, so only clear differences are reported.
    if (score >= 0.5) matched += 1;
    else mismatched.push({ line: index + 1, intended, heard, similarity: Math.round(score * 100) / 100 });
  }
  const speeds = timeline.map((line) => Number(line[3]));
  return {
    checked: true,
    language_ok: sameLanguage(heardLanguage, targetLanguage),
    heard_language: heardLanguage || null,
    lines: timeline.length,
    matched_percent: timeline.length ? Math.round((matched / timeline.length) * 100) : null,
    mismatched: mismatched.sort((x, y) => x.similarity - y.similarity).slice(0, MAX_LISTED),
    mismatched_count: mismatched.length,
    rushed: speeds.filter((speed) => speed > config.dubMaxSpeed + 0.01).length,
    fastest: speeds.length ? Math.round(Math.max(...speeds) * 100) / 100 : null,
    average_speed: speeds.length ? Math.round((speeds.reduce((sum, speed) => sum + speed, 0) / speeds.length) * 100) / 100 : null,
  };
}
