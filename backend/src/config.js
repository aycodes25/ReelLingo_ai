import dotenv from "dotenv";
import { resolve } from "node:path";

dotenv.config();

const requestedMockMode = process.env.MOCK_MODE?.toLowerCase() !== "false";
const openaiApiKey = process.env.OPENAI_API_KEY || "";

export const config = {
  port: Number(process.env.PORT || 8000),
  databaseUrl: process.env.DATABASE_URL || "sqlite:///./local.db",
  supabaseUrl: process.env.SUPABASE_URL || "",
  supabaseKey: process.env.SUPABASE_KEY || "",
  openaiApiKey,
  openaiBaseUrl: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
  openaiTranscriptionModel: process.env.OPENAI_TRANSCRIPTION_MODEL || "whisper-1",
  openaiChatModel: process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini",
  elevenlabsApiKey: process.env.ELEVENLABS_API_KEY || "",
  // eleven_v4 is the ElevenLabs model that covers Yoruba, Hausa, Swahili and Somali.
  elevenlabsModel: process.env.ELEVENLABS_MODEL || "eleven_v4",
  // Stock voice used when the ElevenLabs plan cannot clone the speaker (free tier).
  elevenlabsFallbackVoiceId: process.env.ELEVENLABS_FALLBACK_VOICE_ID || "EXAVITQu4vr4xnSDxMaL",
  openaiTtsModel: process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts",
  mockMode: requestedMockMode && !openaiApiKey,
  uploadLimitBytes: 2 * 1024 * 1024 * 1024,
  maxVideoMinutes: Number(process.env.MAX_VIDEO_MINUTES || 30),
  // Limits for users without a row in the subscriptions table.
  freeVideosPerMonth: Number(process.env.FREE_VIDEOS_PER_MONTH || 5),
  freeMaxVideoMinutes: Number(process.env.FREE_MAX_VIDEO_MINUTES || 10),
  localStorageDir: resolve(process.env.LOCAL_STORAGE_DIR || "./storage"),
  frontendUrl: process.env.FRONTEND_URL || "http://localhost:3000",
};