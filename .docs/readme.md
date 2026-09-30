# 🎙️ ReelLingo — AI Video Translator & Dubber for African Creators

> *Break the language barrier. Reach the world. Sound like yourself.*

---

## 📌 What Is ReelLingo?

**ReelLingo** is an AI-powered web platform that automatically translates and dubs videos from African languages (Yoruba, Igbo, Hausa, Pidgin English, Twi, Swahili, Amharic, and more) into major global languages like English, Spanish, French, and Portuguese — **in minutes, not days.**

A creator uploads a video. ReelLingo:
1. **Transcribes** the audio (speech → text in original language)
2. **Translates** the text (Yoruba → English, Spanish, French, etc.)
3. **Generates dubbed audio** in the uploaded speaker's voice (ElevenLabs instant voice clone)
4. **Merges** the new audio back into the original video
5. **Outputs** a finished dubbed video + subtitle file (.SRT)

The creator downloads a professional, globally-ready video in under 10 minutes.

---

## 🌍 The Problem We Solve

African creators are producing world-class content every day.

| Creator | Language | Potential Audience | Actual Reach |
|:---|:---|:---|:---|
| Nigerian YouTuber | Yoruba | 50,000 local | Stuck locally |
| Ghanaian TikToker | Twi | 80,000 local | Stuck locally |
| Same creator with ReelLingo | English + Spanish | **50 million+ globally** | Unlocked |

**The gap is language, not quality.**

Professional dubbing studios charge **$50–$300 per video** and take **3–7 days.**
Big AI tools like HeyGen and Rask AI **don't support Yoruba, Igbo, Hausa, Twi, or Pidgin.**

ReelLingo is the first tool built **specifically for African-language creators**, priced for **African wallets**, and designed for African platforms (WhatsApp, TikTok, YouTube Shorts, Instagram Reels).

---

## 🎯 Who Is This For?

### Primary Users
- 🎥 **Nigerian YouTubers** (100K–5M subscribers) who post in Yoruba/Pidgin
- 📱 **TikTok/Reels creators** from Ghana, Kenya, Nigeria, Ethiopia
- 🎬 **Nollywood / African indie filmmakers** wanting international distribution
- 📚 **Online educators** creating courses in local languages

### Secondary Users
- 📣 **Diaspora media companies** broadcasting African content to UK/US/Canada
- 🏢 **African brands** running marketing campaigns in multiple languages
- 🎙️ **Podcasters** wanting to expand beyond local audiences

---

## 🔄 How The Pipeline Works

```
┌─────────────────────────────────────────────────────────────────────┐
│                        ReelLingo Pipeline                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   [1] Upload Video                                                  │
│        ↓ (MP4, MOV, AVI — up to 2GB)                              │
│                                                                     │
│   [2] Audio Extraction (FFmpeg)                                     │
│        ↓ (strips audio from video)                                  │
│                                                                     │
│   [3] Full-Length Transcription (chunked OpenAI Whisper)            │
│        ↓ (timestamped speech → text, from first word to last)       │
│                                                                     │
│   [4] Spoken-Language Detection (per transcript segment)            │
│        ↓ (list every detected language)                             │
│                                                                     │
│   [5] Translation (GPT-4o mini, timestamp-preserving)               │
│        ↓ (each detected source language → selected target)          │
│                                                                     │
│   [6] Speech Generation (uploaded-speaker clone via ElevenLabs)     │
│        ↓ (generates speech in the selected target language)         │
│                                                                     │
│   [7] Audio-Video Merge (FFmpeg)                                    │
│        ↓ (replaces original audio track)                            │
│                                                                     │
│   [8] Subtitle Generation (.SRT file)                               │
│        ↓ (timestamped captions from translated text)               │
│                                                                     │
│   [9] Download Ready ✅                                             │
│        → Dubbed video file                                          │
│        → Subtitle .SRT file                                         │
│        → Email notification when complete                           │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 🌐 Supported Languages

The source picker can detect speech automatically, including language changes between transcript segments. The catalog has 53 selectable languages across Nigeria, Africa, Europe, the Middle East, and Asia. It includes Yoruba, Igbo, Hausa, Nigerian Pidgin, Fulfulde, Kanuri, Tiv, Edo, Twi, Ewe, Swahili, Amharic, Oromo, Somali, Zulu, Xhosa, Afrikaans, Shona, Kinyarwanda, Lingala, Wolof, major European languages, Arabic, Persian, Hindi, Bengali, Tamil, Telugu, Urdu, Mandarin, Japanese, Korean, Indonesian, Malay, Thai, Vietnamese, and Filipino. Every detected segment is labeled, and the full original and translated text is available on the job page.

Actual recognition and voice quality depend on the underlying OpenAI speech models and selected voice provider. Regional languages are best-effort rather than a guarantee of native-level accuracy; review transcripts and dub output before publishing. A speaker-matched dub requires both OpenAI and ElevenLabs API keys and clear speech in the source video. ReelLingo creates a temporary clone from transcribed speech intervals and deletes it after generating the dub; no saved voice ID is needed.

---

## 🔑 Key Differentiators

| Feature | ReelLingo | HeyGen | Rask AI | Dubverse |
|:---|:---|:---|:---|:---|
| African language support | ✅ Yes | ❌ No | ❌ No | ❌ No |
| Voice cloning (sounds like you) | ✅ Yes | ✅ Yes | ✅ Yes | ❌ No |
| Pricing in Naira | ✅ Yes | ❌ No | ❌ No | ❌ No |
| Paystack payment | ✅ Yes | ❌ No | ❌ No | ❌ No |
| WhatsApp customer support | ✅ Yes | ❌ No | ❌ No | ❌ No |
| Built for African content | ✅ Yes | ❌ No | ❌ No | ❌ No |
| Starting price | **$10/mo** | $29/mo | $60/mo | $25/mo |

---

*Built with purpose. Built for Africa. Built for the world.*

---

## 🗂️ Project Structure

```
ReelLingo/
├── frontend/                        # Next.js app (TypeScript, App Router, Tailwind)
│   ├── app/
│   │   ├── page.tsx                 # Landing page (hero, CTA)
│   │   ├── dashboard/page.tsx       # Upload + language select + voice toggle
│   │   ├── jobs/[id]/page.tsx       # Processing status page (live steps)
│   │   ├── result/[id]/page.tsx     # Result page (download video/SRT)
│   │   ├── layout.tsx
│   │   └── globals.css
│   ├── components/                  # UploadDropzone, LanguagePicker, VoiceToggle, StatusTimeline
│   ├── lib/
│   │   ├── api.ts                   # typed client for backend endpoints
│   │   └── types.ts                 # shared Job/JobStatus types
│   ├── package.json
│   └── .env.local.example
│
├── backend/                         # Node.js/Express API and worker
│   ├── server.js                    # HTTP routes, auth, upload handling
│   ├── src/
│   │   ├── database.js              # Postgres or local WASM SQLite
│   │   ├── auth.js                  # Supabase Auth adapter
│   │   ├── storage.js               # Supabase Storage or local files
│   │   ├── languages.js             # regional language catalog
│   │   └── pipeline.js              # OpenAI, optional ElevenLabs, FFmpeg, SRT
│   ├── test/                        # node:test and FFmpeg integration tests
│   ├── Dockerfile
│   ├── package.json
│   └── .env.example
│
├── docker-compose.yml                # run frontend+backend together
└── .docs/                            # all project docs, plans, and specifications
   ├── readme.md                     # this file
   ├── marketing.md
   ├── monetization.md
   ├── tech_stack_and_costs.md
   ├── ui_ux_design.md
   └── superpowers/                   # design specs and implementation plans
```

---

## 🚀 Getting Started (Local Development)

### Prerequisites
- Node.js 20+
- FFmpeg installed and on your `PATH` (confirm with `ffmpeg -version`)
- An OpenAI API key for live transcription, translation, and speech generation
- A [Supabase](https://supabase.com) project for hosted auth, Postgres, and storage (optional for local demo mode)
- Docker Desktop (optional, only needed for the Docker Compose path below)

### 1. Create your Supabase project
1. Go to [supabase.com](https://supabase.com) and sign up / log in.
2. Click **New Project**, pick a name and a database password (save the password), and wait for
   provisioning to finish.
3. In **Project Settings → API**, copy the **Project URL** and the **anon public** key (or the
   **service_role** key if you want the backend to bypass Row Level Security during development).
4. In **Project Settings → Database**, copy the **Connection string** (URI format) — this is your
   `DATABASE_URL`.
5. In **Storage**, create a new bucket named `reellingo-videos`.

### 2. Backend setup
```bash
cd backend
cp .env.example .env
# Edit .env with your OpenAI key. Add Supabase values for hosted auth, database, and storage.
npm install
npm run dev
```
Backend runs at `http://localhost:8000` (check `http://localhost:8000/health`).

### 3. Frontend setup
```bash
cd frontend
cp .env.local.example .env.local
npm install
npm run dev
```
Frontend runs at `http://localhost:3000`.

### 4. Run the whole app with Docker

Docker Desktop is the only host prerequisite. From the repository root, run:

```bash
docker compose up --build
```

Open `http://localhost:3000`; the API health check is at `http://localhost:8000/health`. Local demo mode starts without a `.env` file and persists its database and files in Docker volumes. To enable live transcription and dubbing, create `backend/.env` with your provider keys before starting Compose. Compose loads that file when present and keeps secrets out of the backend image.

Stop both services with `Ctrl+C`; if started in the background with `docker compose up --build -d`, use `docker compose down`.
After changing `backend/.env`, apply the new values with `docker compose up -d --force-recreate backend frontend`.

### Notes
- Without an OpenAI key the backend reports demo mode and refuses uploads; it never marks placeholder text or a test tone as a completed dub.
- Adding `OPENAI_API_KEY` automatically switches the default demo setting to live transcription and translation, even if `MOCK_MODE=true` remains in `.env`. A completed speaker-matched dub also requires `ELEVENLABS_API_KEY`; uploads are blocked rather than falling back to a generic voice when either key is missing. A saved ElevenLabs voice ID is not needed.
- Local demo storage uses a file-backed WASM SQLite database. Hosted deployments use the configured Postgres `DATABASE_URL` and Supabase storage.
- For Docker, run `docker compose up --build` from the repository root. Compose loads provider keys from `backend/.env` when present; never put credentials in `.env.example`.
- Run backend tests with `npm --prefix backend test` and frontend tests with `npm --prefix frontend test`.
- Plans and prices live in the `plans` table (seeded from `backend/src/plans.js`, matching `monetization.md`). The landing page, billing page and upload limits all read it. `FREE_VIDEOS_PER_MONTH` / `FREE_MAX_VIDEO_MINUTES` override the free plan, and `MAX_VIDEO_MINUTES` caps every plan (set it to 60 for Studio's full limit).

---

## ⚙️ Optional features and how to switch them on

Every integration is off until its keys are set in `backend/.env` (see `backend/.env.example`). Settings → System status shows what's active.

| Feature | What to set |
|:---|:---|
| Job queue & separate worker | Works out of the box (`WORKER_MODE=inline`). For scale, set `WORKER_MODE=off` and run `npm run worker` (or `docker compose --profile worker up`). Jobs survive restarts and resume from their last step. |
| Keep background music/effects | Automatic. Best quality with Demucs (`docker compose build --build-arg INSTALL_DEMUCS=true backend`); otherwise ElevenLabs Voice Isolator or an FFmpeg fallback. `SEPARATION_PROVIDER` picks one. |
| Multi-speaker dubbing | `ELEVENLABS_API_KEY` (uses ElevenLabs Scribe diarization). |
| Payments (₦ and $) | `PAYSTACK_SECRET_KEY` and/or `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET`. Webhooks: `POST /billing/webhooks/paystack` and `/billing/webhooks/stripe`. Optional `PAYSTACK_PLAN_*` / `STRIPE_PRICE_*` for automatic renewals. |
| Email notifications | `RESEND_API_KEY`, `EMAIL_FROM` |
| WhatsApp notifications | `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` (+ `WHATSAPP_TEMPLATE` for messages outside a 24h chat) |
| Lip-sync (Studio) | `SYNC_API_KEY` (sync.so) and Supabase storage |
| Import from YouTube/TikTok/Instagram/Facebook | `yt-dlp` on the server (included in the Docker image). Drive, Dropbox and direct links need nothing. |
| Publish to YouTube | Google OAuth client: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, redirect URI `${PUBLIC_API_URL}/integrations/youtube/callback` |
| Admin dashboard | `ADMIN_EMAILS=you@example.com` |
| Upload virus scanning | `CLAMAV_HOST` (`docker compose --profile security up`) |
| Error tracking | `SENTRY_DSN` (backend), `NEXT_PUBLIC_SENTRY_DSN` (frontend) |
| Signing & encryption | Set `APP_SECRET` to a long random string in production. |

Other features need no configuration: resumable uploads, review-before-dub editor with per-line retranslation and cached re-dubs, glossary, translation tone, several target languages per upload, burned-in caption styles, VTT/ASS subtitles, 9:16 / 1:1 / 4:5 / 16:9 exports, audio-only (podcast) dubbing, AI titles/descriptions/hashtags, saved voices, public watch pages with before/after comparison, referrals, team workspaces, API keys (`/docs/api`), rate limiting, retention cleanup (`RETENTION_DAYS`) and live progress over SSE.
