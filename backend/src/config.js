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
  mockMode: requestedMockMode && !openaiApiKey,
  uploadLimitBytes: 2 * 1024 * 1024 * 1024,
  maxVideoMinutes: Number(process.env.MAX_VIDEO_MINUTES || 30),
  localStorageDir: resolve(process.env.LOCAL_STORAGE_DIR || "./storage"),
  frontendUrl: process.env.FRONTEND_URL || "http://localhost:3000",
};