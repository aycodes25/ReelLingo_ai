import OpenAI from "openai";
import { config } from "./config.js";
import { recordChatUsage } from "./costs.js";
import { getLanguage, languages } from "./languages.js";
import { withRetries } from "./retry.js";

const ai = config.openaiApiKey ? new OpenAI({ apiKey: config.openaiApiKey, baseURL: config.openaiBaseUrl, timeout: 600_000 }) : null;

const CHAT_BATCH_SIZE = 40;
const CHAT_OUTPUT_ATTEMPTS = 3;

export const TONES = {
  natural: "Natural and conversational",
  formal: "Formal and polished",
  casual: "Casual, social-media friendly",
  keep_flavour: "Keep the local flavour (slang, Pidgin expressions)",
};

const TONE_INSTRUCTIONS = {
  natural: "natural, conversational",
  formal: "polished, formal",
  casual: "relaxed, casual, social-media friendly",
  keep_flavour: "natural, informal",
};

class IncompleteOutputError extends Error {}

function defaultComplete(request) {
  if (!ai) throw new Error("OPENAI_API_KEY is required for translation.");
  return ai.chat.completions.create(request);
}

// Retries network failures, and re-asks when the model returns JSON that is invalid or misses a segment.
async function completeSegmentBatch(complete, request, expectedCount, { retryDelayMs = 2000, label }) {
  let lastProblem;
  for (let attempt = 1; attempt <= CHAT_OUTPUT_ATTEMPTS; attempt += 1) {
    const response = await withRetries(() => complete(request), { baseDelayMs: retryDelayMs, label });
    await recordChatUsage(label.toLowerCase().replace(/\s+/g, "_"), response.usage);
    let items;
    try {
      items = JSON.parse(response.choices[0]?.message?.content || "{}").segments;
    } catch {
      lastProblem = new IncompleteOutputError(`${label} returned invalid segment data.`);
      continue;
    }
    if (!Array.isArray(items)) {
      lastProblem = new IncompleteOutputError(`${label} returned invalid segment data.`);
      continue;
    }
    const byIndex = new Map(items.map((item) => [Number(item.index), item]));
    if (byIndex.size < expectedCount || [...Array(expectedCount).keys()].some((index) => !byIndex.has(index))) {
      lastProblem = new IncompleteOutputError(`${label} returned ${byIndex.size} of ${expectedCount} segments.`);
      continue;
    }
    return byIndex;
  }
  throw lastProblem;
}

export async function detectSegmentLanguages(segments, requestCompletion, fallbackLanguage = "auto", { retryDelayMs } = {}) {
  if (!requestCompletion && !ai) throw new Error("OPENAI_API_KEY is required to identify spoken languages.");
  const complete = requestCompletion || defaultComplete;
  const catalog = languages.filter(({ code }) => code !== "auto").map(({ code, name }) => `${code}: ${name}`).join("\n");
  const result = [];

  for (let offset = 0; offset < segments.length; offset += CHAT_BATCH_SIZE) {
    const batch = segments.slice(offset, offset + CHAT_BATCH_SIZE);
    const byIndex = await completeSegmentBatch(complete, {
      model: config.openaiChatModel,
      response_format: { type: "json_object" },
      temperature: 0,
      messages: [
        {
          role: "system",
          content: `Identify the language actually spoken in each short transcript segment. A video may switch languages; classify every segment independently. Return JSON {"segments":[{"index":0,"language":"en"}]} with exactly one entry per input segment. Use only these codes, or "und" if genuinely uncertain:\n${catalog}`,
        },
        { role: "user", content: JSON.stringify(batch.map((segment, index) => ({ index, text: segment.text }))) },
      ],
    }, batch.length, { retryDelayMs, label: "Language identification" });

    result.push(...batch.map((segment, index) => {
      const code = String(byIndex.get(index)?.language || "und").toLowerCase();
      const fallback = getLanguage(segment.language) ? segment.language : fallbackLanguage;
      return { ...segment, language: getLanguage(code) ? code : getLanguage(fallback) && fallback !== "auto" ? fallback : "und" };
    }));
  }
  return result;
}

/** Glossary lines relevant to this text and target language, phrased as rules for the model. */
export function glossaryInstructions(glossary = [], targetLanguage, texts = []) {
  const haystack = texts.join("\n").toLowerCase();
  const relevant = glossary.filter((entry) => entry.term?.trim()
    && (!entry.target_language || entry.target_language === targetLanguage)
    && (glossary.length <= 30 || haystack.includes(entry.term.toLowerCase())));
  if (!relevant.length) return "";
  const rules = relevant.map((entry) => (entry.translation?.trim()
    ? `- "${entry.term}" → always translate as "${entry.translation.trim()}"`
    : `- "${entry.term}" → never translate or respell; keep exactly "${entry.term}"`));
  return `\nGlossary (these rules override everything else):\n${rules.join("\n")}`;
}

function toneInstruction(tone) {
  const base = TONE_INSTRUCTIONS[tone] || TONE_INSTRUCTIONS.natural;
  const extra = tone === "keep_flavour"
    ? " Preserve the speaker's local flavour: keep slang, exclamations and culturally specific expressions (for example \"Abeg\", \"Wahala\", \"Chai\", \"Ehen\") as spoken where a global audience can follow from context."
    : "";
  return { base, extra };
}

export async function translate(segments, targetLanguage, requestCompletion, { retryDelayMs, glossary = [], tone = "natural" } = {}) {
  const target = getLanguage(targetLanguage)?.name || targetLanguage;
  if (!requestCompletion && !ai) throw new Error("OPENAI_API_KEY is required for translation.");
  const complete = requestCompletion || defaultComplete;
  const translated = new Array(segments.length);
  const groups = new Map();
  const { base, extra } = toneInstruction(tone);

  segments.forEach((segment, index) => {
    const code = getLanguage(segment.language) ? segment.language : "und";
    if (!groups.has(code)) groups.set(code, []);
    groups.get(code).push({ index, ...segment });
  });

  for (const [sourceCode, group] of groups) {
    const source = getLanguage(sourceCode)?.name || "the spoken source language";
    for (let offset = 0; offset < group.length; offset += CHAT_BATCH_SIZE) {
      const batch = group.slice(offset, offset + CHAT_BATCH_SIZE);
      const rules = glossaryInstructions(glossary, targetLanguage, batch.map((item) => item.text));
      const byIndex = await completeSegmentBatch(complete, {
        model: config.openaiChatModel,
        response_format: { type: "json_object" },
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content: `Translate every segment from ${source} into ${base} ${target}. Translate every word faithfully, keep names as spoken, and never merge, split, skip or summarize segments.${extra} Return JSON {"segments":[{"index":0,"text":"..."}]} with exactly one entry per input segment, preserving each index.${rules}`,
          },
          { role: "user", content: JSON.stringify(batch.map((item, index) => ({ index, text: item.text }))) },
        ],
      }, batch.length, { retryDelayMs, label: "Translation" });

      batch.forEach((item, index) => {
        const text = String(byIndex.get(index)?.text || "").trim();
        if (!text) throw new Error(`Translation is missing transcript segment ${item.index + 1}.`);
        translated[item.index] = { ...segments[item.index], text };
      });
    }
  }
  return translated;
}

/** Re-translates one edited line, giving the model its neighbours so pronouns and references stay consistent. */
export async function translateLine(segments, index, targetLanguage, { glossary = [], tone = "natural", requestCompletion } = {}) {
  const complete = requestCompletion || defaultComplete;
  const target = getLanguage(targetLanguage)?.name || targetLanguage;
  const segment = segments[index];
  const source = getLanguage(segment.language)?.name || "the spoken source language";
  const context = segments.slice(Math.max(0, index - 2), index + 3).map((item) => item.text).join(" / ");
  const { base, extra } = toneInstruction(tone);
  const byIndex = await completeSegmentBatch(complete, {
    model: config.openaiChatModel,
    response_format: { type: "json_object" },
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content: `Translate the segment from ${source} into ${base} ${target}. Surrounding lines for context only: "${context}".${extra} Return JSON {"segments":[{"index":0,"text":"..."}]}.${glossaryInstructions(glossary, targetLanguage, [segment.text])}`,
      },
      { role: "user", content: JSON.stringify([{ index: 0, text: segment.text }]) },
    ],
  }, 1, { label: "Line translation" });
  return String(byIndex.get(0)?.text || "").trim();
}

/** Suggests a publish-ready title, description and hashtags in the target language. */
export async function generateMetadata(translatedSegments, targetLanguage, { originalTitle = "", requestCompletion } = {}) {
  const complete = requestCompletion || defaultComplete;
  const target = getLanguage(targetLanguage)?.name || targetLanguage;
  const transcript = translatedSegments.map((segment) => segment.text).join(" ").slice(0, 6000);
  const response = await withRetries(() => complete({
    model: config.openaiChatModel,
    response_format: { type: "json_object" },
    temperature: 0.6,
    messages: [
      {
        role: "system",
        content: `You write social video metadata in ${target}. From the transcript, return JSON {"title":"...","description":"...","hashtags":["#..."]}: a catchy title under 90 characters, a 2–4 sentence description that invites viewers to watch, and 5–10 relevant hashtags (mix broad and niche, include the topic and culture). Write everything in ${target}. Don't invent facts that aren't in the transcript.`,
      },
      { role: "user", content: `Original file name: ${originalTitle}\nTranscript: ${transcript}` },
    ],
  }), { label: "Metadata generation" });
  await recordChatUsage("metadata", response.usage);
  const data = JSON.parse(response.choices[0]?.message?.content || "{}");
  const hashtags = (Array.isArray(data.hashtags) ? data.hashtags : [])
    .map((tag) => `#${String(tag).replace(/^#+/, "").replace(/\s+/g, "")}`)
    .filter((tag) => tag.length > 1)
    .slice(0, 12);
  return {
    title: String(data.title || "").slice(0, 100),
    description: String(data.description || "").slice(0, 4500),
    hashtags,
  };
}
