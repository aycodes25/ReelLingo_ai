import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "./config.js";
import { many, one, query } from "./db.js";
import { synthesizeWithElevenLabs, synthesizeWithOpenAI } from "./dubbing.js";
import { getLanguage } from "./languages.js";
import { addYorubaToneMarks, SPITCH_VOICES, spitchConfigured, synthesizeWithSpitch } from "./spitch.js";
import { getSignedUrl, uploadFile } from "./storage.js";

/**
 * Voice Lab (Admin → Voice Lab): generate the same sentence with each engine and voice, listen, send the samples to
 * native speakers, and record their rating, before customers ever hear a robotic voice.
 */

// Starter sentences. Ask a native speaker to replace them with sentences your creators really say.
export const SAMPLE_TEXT = {
  yo: "Ẹ kú àárọ̀ o! Ẹ ṣé gan-an tí ẹ wo fídíò yìí. Ẹ má gbàgbé láti tẹ bọ́tìnnì subscribe.",
  ha: "Barka da safiya! Na gode sosai da kallon wannan bidiyon. Kada ku manta ku danna subscribe.",
  ig: "Ụtụtụ ọma! Daalụ nke ukwuu maka ikiri vidiyo a. Echefula ịpị bọtịnụ subscribe.",
  pcm: "How una dey! Thank you well well for watching dis video. Abeg no forget to subscribe.",
  en: "Good morning! Thank you so much for watching this video. Don't forget to subscribe.",
  fr: "Bonjour à tous ! Merci beaucoup d'avoir regardé cette vidéo. N'oubliez pas de vous abonner.",
};

const LAB_LANGUAGES = ["yo", "ha", "ig", "pcm", "en", "fr", "sw", "am"];
const OPENAI_LAB_VOICES = ["alloy", "onyx", "nova", "echo", "shimmer", "fable"];

export function voiceLabOptions() {
  const engines = [];
  if (spitchConfigured()) engines.push({ id: "spitch", label: "Spitch (native Nigerian voices)", voices: SPITCH_VOICES });
  if (config.elevenlabsApiKey) {
    engines.push({ id: "elevenlabs", label: `ElevenLabs (${config.elevenlabsModel})`, voices: { any: config.elevenlabsStockVoices.map((id) => ({ id, gender: null })) } });
  }
  if (config.openaiApiKey) engines.push({ id: "openai", label: "OpenAI (backup voice)", voices: { any: OPENAI_LAB_VOICES.map((id) => ({ id, gender: null })) } });
  return {
    engines,
    languages: LAB_LANGUAGES.map((code) => ({ code, name: getLanguage(code)?.name || code, sample: SAMPLE_TEXT[code] || "" })),
    missing: [
      ...(spitchConfigured() ? [] : ["SPITCH_API_KEY (native Yoruba, Hausa, Igbo and Pidgin voices)"]),
      ...(config.elevenlabsApiKey ? [] : ["ELEVENLABS_API_KEY"]),
    ],
  };
}

function normalizeTest(row, url = null) {
  return {
    id: Number(row.id), language: row.language, language_name: getLanguage(row.language)?.name || row.language, engine: row.engine,
    voice: row.voice || null, text: row.text, rating: row.rating === null || row.rating === undefined ? null : Number(row.rating),
    notes: row.notes || null, created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at, audio_url: url,
  };
}

export async function createVoiceSample({ language, engine, voice, text }, adminId, directory) {
  const code = String(language || "");
  if (!getLanguage(code) || code === "auto") throw new Error("Choose a language.");
  const words = String(text || SAMPLE_TEXT[code] || "").trim().slice(0, 600);
  if (!words) throw new Error("Type a sentence to read.");
  let spoken = words;
  let audio;
  if (engine === "spitch") {
    if (!spitchConfigured()) throw new Error("Add SPITCH_API_KEY to backend/.env first.");
    const voices = SPITCH_VOICES[code];
    if (!voices) throw new Error(`Spitch doesn't have ${getLanguage(code)?.name} voices yet.`);
    const chosen = voices.some((item) => item.id === voice) ? voice : voices[0].id;
    if (code === "yo" && config.yorubaToneMarks) spoken = await addYorubaToneMarks(words);
    audio = await synthesizeWithSpitch(spoken, chosen, code);
    voice = chosen;
  } else if (engine === "elevenlabs") {
    if (!config.elevenlabsApiKey) throw new Error("Add ELEVENLABS_API_KEY to backend/.env first.");
    const chosen = config.elevenlabsStockVoices.includes(voice) ? voice : config.elevenlabsFallbackVoiceId;
    audio = await synthesizeWithElevenLabs(spoken, chosen, code);
    voice = chosen;
  } else if (engine === "openai") {
    if (!config.openaiApiKey) throw new Error("Add OPENAI_API_KEY to backend/.env first.");
    const chosen = OPENAI_LAB_VOICES.includes(voice) ? voice : "alloy";
    audio = await synthesizeWithOpenAI(spoken, code, chosen);
    voice = chosen;
  } else {
    throw new Error("Choose a voice engine.");
  }
  const local = join(directory, "sample.mp3");
  await writeFile(local, audio);
  const path = await uploadFile(`voice-lab/${randomUUID()}.mp3`, local, "audio/mpeg");
  const row = await one(
    "INSERT INTO voice_tests (language, engine, voice, text, audio_path, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *",
    [code, engine, voice, spoken, path, adminId],
  );
  return normalizeTest(row, await getSignedUrl(path, 7 * 24 * 3600));
}

export async function listVoiceTests(limit = 60) {
  const rows = await many("SELECT * FROM voice_tests ORDER BY id DESC LIMIT $1", [limit]);
  return Promise.all(rows.map(async (row) => normalizeTest(row, row.audio_path ? await getSignedUrl(row.audio_path, 7 * 24 * 3600).catch(() => null) : null)));
}

export async function rateVoiceTest(id, { rating, notes }) {
  const value = rating === null || rating === undefined || rating === "" ? null : Math.round(Number(rating));
  if (value !== null && !(value >= 1 && value <= 5)) throw new Error("Rate from 1 (robotic) to 5 (sounds like a native speaker).");
  const updated = await query("UPDATE voice_tests SET rating = $1, notes = $2 WHERE id = $3", [value, String(notes || "").slice(0, 1000) || null, id]);
  if (!updated.rowCount) throw Object.assign(new Error("Sample not found."), { status: 404 });
  const row = await one("SELECT * FROM voice_tests WHERE id = $1", [id]);
  return normalizeTest(row);
}
