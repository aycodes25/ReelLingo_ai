import OpenAI from "openai";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { runCapture } from "./media.js";

/**
 * Computes median fundamental frequency (pitch) of voiced frames from a 16kHz PCM buffer.
 * Adult male F0 is typically 85 - 155 Hz; adult female / child F0 is typically 165 - 300 Hz.
 */
export function estimatePitchFromPcm(pcmBuffer, sampleRate = 16000) {
  if (!pcmBuffer || pcmBuffer.length < 1024 * 2) return null;
  const int16 = new Int16Array(pcmBuffer.buffer, pcmBuffer.byteOffset, Math.floor(pcmBuffer.length / 2));
  const floats = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) floats[i] = int16[i] / 32768.0;

  const windowSize = 1024;
  const hopSize = 512;
  const minLag = Math.floor(sampleRate / 320); // ~320 Hz
  const maxLag = Math.floor(sampleRate / 75);  // ~75 Hz

  const pitches = [];

  for (let offset = 0; offset + windowSize <= floats.length; offset += hopSize) {
    let energy = 0;
    for (let i = 0; i < windowSize; i++) energy += floats[offset + i] * floats[offset + i];
    if (energy < 0.005) continue; // skip silence

    let bestLag = -1;
    let maxCorr = -1;

    for (let lag = minLag; lag <= maxLag; lag++) {
      let corr = 0;
      for (let i = 0; i < windowSize - lag; i++) {
        corr += floats[offset + i] * floats[offset + i + lag];
      }
      if (corr > maxCorr) {
        maxCorr = corr;
        bestLag = lag;
      }
    }

    if (bestLag > 0 && (maxCorr / energy) > 0.35) {
      pitches.push(sampleRate / bestLag);
    }
  }

  if (!pitches.length) return null;
  pitches.sort((a, b) => a - b);
  return pitches[Math.floor(pitches.length / 2)];
}

/** Extracts clean 16kHz speech audio for a speaker. */
async function extractSpeakerPcm(audioPath, segments, maxSeconds = 12) {
  const picked = segments.filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start);
  if (!picked.length) return null;

  let total = 0;
  const list = [];
  for (const s of picked) {
    list.push(s);
    total += s.end - s.start;
    if (total >= maxSeconds) break;
  }

  const filters = list.map((seg, idx) => (
    `[0:a]atrim=start=${Math.max(0, seg.start)}:end=${seg.end},asetpts=PTS-STARTPTS,highpass=f=80,lowpass=f=400,afftdn=nf=-20[a${idx}]`
  ));
  filters.push(`${list.map((_, idx) => `[a${idx}]`).join("")}concat=n=${list.length}:v=0:a=1[out]`);

  try {
    const { stdout } = await runCapture("ffmpeg", [
      "-v", "error", "-i", audioPath,
      "-filter_complex", filters.join(";"),
      "-map", "[out]", "-ac", "1", "-ar", "16000", "-f", "s16le", "pipe:1"
    ], { binary: true });
    return stdout;
  } catch {
    return null;
  }
}

let openaiClient;
function getOpenai() {
  if (!config.openaiApiKey) return null;
  openaiClient ||= new OpenAI({ apiKey: config.openaiApiKey, baseURL: config.openaiBaseUrl, timeout: 30000 });
  return openaiClient;
}

/**
 * Uses LLM to inspect dialogue for speaker genders (honorifics, pronouns, terms of address).
 */
async function inferGendersFromDialogue(segments, speakers) {
  const ai = getOpenai();
  if (!ai || !segments?.length || !speakers?.length) return {};

  const lines = segments
    .filter((s) => s.text?.trim())
    .slice(0, 50)
    .map((s) => ({ speaker: s.speaker || "speaker_0", text: s.text.trim() }));

  if (!lines.length) return {};

  try {
    const res = await ai.chat.completions.create({
      model: config.openaiChatModel || "gpt-4o-mini",
      response_format: { type: "json_object" },
      temperature: 0,
      messages: [
        {
          role: "system",
          content: "You are an expert audio-visual casting director. Given the dialogue transcript with speaker IDs, identify the gender (\"male\" or \"female\") of each speaker based on conversational context, honorifics (e.g. uncle, brother, sister, sir, bro, man, lady, mom, dad), tone, and typical roles. Return JSON: {\"speaker_0\": \"male\" | \"female\", ...}",
        },
        {
          role: "user",
          content: JSON.stringify({ speakers, dialogue: lines }),
        },
      ],
    });
    return JSON.parse(res.choices[0]?.message?.content || "{}");
  } catch (err) {
    logger.warn({ err }, "Dialogue gender detection failed");
    return {};
  }
}

/**
 * Detects whether each speaker is male or female using both acoustic pitch analysis and dialogue cues.
 * Returns a Map of speakerId -> "male" | "female".
 */
export async function detectSpeakerGenders(audioPath, segments) {
  const speakers = [...new Set(segments.map((s) => s.speaker || "speaker_0"))];
  const result = new Map();

  // 1. Try LLM dialogue inference
  const llmGenders = await inferGendersFromDialogue(segments, speakers);

  // 2. Measure acoustic pitch for each speaker
  for (const speaker of speakers) {
    const spkSegments = segments.filter((s) => (s.speaker || "speaker_0") === speaker);
    const pcm = await extractSpeakerPcm(audioPath, spkSegments);
    const pitch = estimatePitchFromPcm(pcm);

    let gender = "male"; // default

    // Prioritize LLM dialogue context (terms of address, pronouns, names) because background motor
    // hum or ambient sounds can distort acoustic pitch estimates.
    if (llmGenders[speaker] === "male" || llmGenders[speaker] === "female") {
      gender = llmGenders[speaker];
    } else if (pitch !== null) {
      gender = pitch < 165 ? "male" : "female";
    }

    result.set(speaker, gender);
    logger.info({ speaker, gender, pitch: pitch ? Math.round(pitch) : null, llm: llmGenders[speaker] }, "Speaker gender determined");
  }

  return result;
}
