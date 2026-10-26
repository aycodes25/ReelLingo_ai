import OpenAI from "openai";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { recordChatUsage } from "./costs.js";
import { getLanguage } from "./languages.js";
import { withRetries } from "./retry.js";
import { addYorubaToneMarks, spitchConfigured } from "./spitch.js";

// Roughly how many characters per second a voice speaks at a natural pace (measured on real dubs).
const CHARS_PER_SECOND = {
  yo: 12.5, ig: 12.5, ha: 13, pcm: 14,
  en: 15, fr: 14, es: 15, pt: 15, de: 13, it: 14, sw: 12,
  zh: 4, ja: 7, ko: 5,
  bn: 9, hi: 9, ur: 9, ar: 10,
  ru: 12, tr: 12, vi: 8, th: 8,
};
const DEFAULT_CHARS_PER_SECOND = 13;
const BATCH = 30;

export const speechSeconds = (text, language) => text.trim().length / (CHARS_PER_SECOND[language] || DEFAULT_CHARS_PER_SECOND);

/** The time a line may take: its own slot plus the pause that follows it, so it never has to run into the next line. */
export function availableSeconds(segments, index, totalDuration) {
  const next = segments[index + 1]?.start ?? totalDuration;
  return Math.max(next - segments[index].start, segments[index].end - segments[index].start, 0.4);
}

let ai;
async function defaultComplete(request) {
  if (!config.openaiApiKey) throw new Error("OPENAI_API_KEY is required to shorten lines.");
  ai ||= new OpenAI({ apiKey: config.openaiApiKey, baseURL: config.openaiBaseUrl, timeout: 120_000 });
  return ai.chat.completions.create(request);
}

/**
 * Shortens the translated lines that would be too long to say in the time available, keeping their meaning, so the voice can
 * speak at a natural pace instead of being sped up. Lines that already fit are left exactly as they are.
 * Returns { segments, shortened } and never throws: if shortening isn't possible the lines are returned unchanged.
 */
export async function fitLines(translated, targetLanguage, totalDuration, { requestCompletion, onNote } = {}) {
  if (!config.fitLines || (!requestCompletion && !config.openaiApiKey)) return { segments: translated, shortened: 0 };
  const comfortable = 1.05; // aim for a natural pace; the scheduler keeps the small speed-up in reserve
  const tooLong = [];
  translated.forEach((segment, index) => {
    if (!segment.text?.trim()) return;
    const available = availableSeconds(translated, index, totalDuration);
    const needed = speechSeconds(segment.text, targetLanguage);
    if (needed > available * comfortable) {
      tooLong.push({ index, text: segment.text, maxCharacters: Math.floor(available * (CHARS_PER_SECOND[targetLanguage] || DEFAULT_CHARS_PER_SECOND)) });
    }
  });
  if (!tooLong.length) return { segments: translated, shortened: 0 };

  const result = translated.map((segment) => ({ ...segment }));
  let shortened = 0;
  try {
    const rewrites = await shortenLines(tooLong, targetLanguage, { requestCompletion });
    for (const [index, text] of rewrites) {
      result[index].text = text;
      shortened += 1;
    }
  } catch (error) {
    logger.warn({ err: error }, "Could not shorten long lines");
    onNote?.("Some long lines could not be shortened this time, so they may sound slightly faster.");
  }
  logger.info({ shortened, candidates: tooLong.length }, "Shortened long lines");
  return { segments: result, shortened };
}

/** Asks the model for shorter versions of { index, text, maxCharacters } lines. Returns a Map of index → new text (only real improvements). */
export async function shortenLines(items, targetLanguage, { requestCompletion } = {}) {
  const complete = requestCompletion || defaultComplete;
  const target = getLanguage(targetLanguage)?.name || targetLanguage;
  const rewrites = new Map();
  {
    for (let offset = 0; offset < items.length; offset += BATCH) {
      const batch = items.slice(offset, offset + BATCH);
      const response = await withRetries(() => complete({
        model: config.openaiChatModel,
        response_format: { type: "json_object" },
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content: `These ${target} lines are spoken in a dubbed video and are too long for the time on screen. Rewrite each one so it is no longer than its maxCharacters, keeping the meaning, the speaker's tone and every name, in natural spoken ${target}. Drop filler words and repetition first. Do not add anything. Return JSON {"segments":[{"index":0,"text":"..."}]} with one entry per input line, keeping each index.`,
          },
          { role: "user", content: JSON.stringify(batch.map((item) => ({ index: item.index, maxCharacters: item.maxCharacters, text: item.text }))) },
        ],
      }), { label: "Fitting lines to the time available", baseDelayMs: 1000 });
      await recordChatUsage("fit_lines", response.usage);
      const answers = JSON.parse(response.choices[0]?.message?.content || "{}").segments;
      if (!Array.isArray(answers)) continue;
      for (const item of answers) {
        const original = batch.find((line) => line.index === Number(item.index));
        let text = String(item.text || "").trim();
        // Only accept a rewrite that is really shorter; never let a bad answer replace the translation.
        if (!original || !text || text.length >= original.text.trim().length || text.length < original.text.trim().length * 0.2) continue;
        if (targetLanguage === "yo" && !requestCompletion && config.yorubaToneMarks && spitchConfigured()) text = await addYorubaToneMarks(text).catch(() => text);
        rewrites.set(original.index, text);
      }
    }
  }
  return rewrites;
}
