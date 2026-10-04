import { config } from "./config.js";
import { recordCost } from "./costs.js";
import { responseError, withRetries } from "./retry.js";

/**
 * Spitch (spitch.app): a Nigerian voice-AI company with native voices for Yoruba, Hausa, Igbo, Nigerian Pidgin
 * and Nigerian-accented English, plus translation and Yoruba tone marks. These voices are recorded from native
 * speakers, so they pronounce tones and names the way listeners expect.
 */

// System voices, ordered so that alternating speakers alternate between a man's and a woman's voice.
export const SPITCH_VOICES = {
  yo: [{ id: "femi", gender: "male" }, { id: "sade", gender: "female" }, { id: "segun", gender: "male" }, { id: "funmi", gender: "female" }],
  ha: [{ id: "aliyu", gender: "male" }, { id: "amina", gender: "female" }, { id: "hasan", gender: "male" }, { id: "zainab", gender: "female" }],
  ig: [{ id: "obinna", gender: "male" }, { id: "ngozi", gender: "female" }, { id: "ebuka", gender: "male" }, { id: "amara", gender: "female" }],
  pcm: [{ id: "justice", gender: "male" }, { id: "boma", gender: "female" }, { id: "tega", gender: "male" }, { id: "ufoma", gender: "female" }],
  am: [{ id: "haile", gender: "male" }, { id: "hana", gender: "female" }, { id: "tesfaye", gender: "male" }, { id: "tena", gender: "female" }],
  en: [{ id: "kingsley", gender: "male" }, { id: "remi", gender: "female" }, { id: "jude", gender: "male" }, { id: "lucy", gender: "female" }],
};

/** Languages ReelLingo sends to Spitch's native voices (Nigerian-accented English stays with ElevenLabs by default). */
export const NIGERIAN_VOICE_LANGUAGES = ["yo", "ha", "ig", "pcm"];
export const NIGERIAN_TRANSLATION_LANGUAGES = ["yo", "ha", "ig"];

export function spitchConfigured() {
  return Boolean(config.spitchApiKey);
}

/** Should this language be voiced by Spitch? Cloned and saved voices always stay with ElevenLabs. */
export function useSpitchVoice(language, { cloned = false } = {}) {
  if (cloned || !spitchConfigured() || !NIGERIAN_VOICE_LANGUAGES.includes(language)) return false;
  return config.nigerianVoiceEngine === "spitch" || config.nigerianVoiceEngine === "auto";
}

export function useSpitchTranslation(language) {
  if (!spitchConfigured() || !NIGERIAN_TRANSLATION_LANGUAGES.includes(language)) return false;
  return config.nigerianTranslationEngine === "spitch" || config.nigerianTranslationEngine === "auto";
}

/** The voice for a speaker: the creator's pick for the main speaker, then alternating men's and women's voices. */
export function spitchVoiceFor(language, rank = 0, preferred = null) {
  const voices = SPITCH_VOICES[language] || [];
  if (!voices.length) return null;
  if (preferred && voices.some((voice) => voice.id === preferred)) {
    if (rank === 0) return preferred;
    const others = voices.filter((voice) => voice.id !== preferred);
    return others[(rank - 1) % others.length].id;
  }
  return voices[rank % voices.length].id;
}

async function spitchFetch(path, body, label) {
  return withRetries(async () => {
    const response = await fetch(`${config.spitchApiUrl}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.spitchApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw await responseError(response, label);
    return response;
  }, { label });
}

const words = (text) => String(text).trim().split(/\s+/).filter(Boolean).length;

/** Speech for one line, as MP3. */
export async function synthesizeWithSpitch(text, voice, language) {
  const response = await spitchFetch("/speech", { text, voice, language, format: "mp3" }, "Spitch speech synthesis");
  const audio = Buffer.from(await response.arrayBuffer());
  if (!audio.length) throw new Error("Spitch returned an empty audio clip.");
  // Spitch bills per second of speech; ~14 characters are spoken per second.
  const seconds = Math.max(1, text.length / 14);
  await recordCost("spitch", "speech", seconds, "seconds", seconds * config.costs.spitchSpeechPerSecond);
  return audio;
}

export async function spitchTranslateText(text, target, source = undefined) {
  const response = await spitchFetch("/translate", { text, target, ...(source && source !== "auto" ? { source } : {}) }, "Spitch translation");
  const data = await response.json();
  const count = words(text);
  await recordCost("spitch", "translation", count, "words", (count / 10000) * config.costs.spitchTextPer10kWords);
  return String(data.text || "").trim();
}

const YORUBA_MARKS = /[àáèéìíòóùúẹọṣǹńÀÁÈÉÌÍÒÓÙÚẸỌṢ̣̀́]/;

/** Restores Yoruba tone marks (e.g. "Bawo ni" → "Báwo ni") so the voice reads the right tones. */
export async function addYorubaToneMarks(text) {
  if (!text?.trim() || YORUBA_MARKS.test(text)) return text;
  const response = await spitchFetch("/diacritics", { language: "yo", text }, "Spitch tone marks");
  const data = await response.json();
  const count = words(text);
  await recordCost("spitch", "tone_marks", count, "words", (count / 10000) * config.costs.spitchTextPer10kWords);
  return String(data.text || "").trim() || text;
}

async function mapLimited(items, limit, task) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await task(items[index], index);
    }
  }));
  return results;
}

/**
 * Translates transcript segments one by one (Spitch keeps each line separate, so timing stays exact).
 * Glossary terms with a fixed translation are applied afterwards.
 */
export async function spitchTranslateSegments(segments, target, { glossary = [] } = {}) {
  const fixed = glossary.filter((entry) => entry.translation && (!entry.target_language || entry.target_language === target));
  return mapLimited(segments, 4, async (segment) => {
    const source = segment.language && segment.language !== "und" ? segment.language : undefined;
    let text = segment.text?.trim() ? await spitchTranslateText(segment.text, target, source) : "";
    for (const entry of fixed) text = text.split(entry.term).join(entry.translation);
    if (!text) throw new Error("Spitch returned an empty translation.");
    return { ...segment, text };
  });
}

/** Adds tone marks to every Yoruba line that doesn't already have them. */
export async function toneMarkSegments(segments) {
  return mapLimited(segments, 4, async (segment) => ({ ...segment, text: await addYorubaToneMarks(segment.text) }));
}
