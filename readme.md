# 🎙️ ReelLingo — AI Video Translator & Dubber for African Creators

> *Break the language barrier. Reach the world. Sound like yourself.*

---

## 📌 What Is ReelLingo?

**ReelLingo** is an AI-powered web platform that automatically translates and dubs videos from African languages (Yoruba, Igbo, Hausa, Pidgin English, Twi, Swahili, Amharic, and more) into major global languages like English, Spanish, French, and Portuguese — **in minutes, not days.**

A creator uploads a video. ReelLingo:
1. **Transcribes** the audio (speech → text in original language)
2. **Translates** the text (Yoruba → English, Spanish, French, etc.)
3. **Generates dubbed audio** in the creator's own cloned voice
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
│   [3] Transcription (OpenAI Whisper)                               │
│        ↓ (speech → text in original language)                       │
│                                                                     │
│   [4] Translation (DeepL + GPT-4o refinement)                      │
│        ↓ (text → target language, culturally accurate)              │
│                                                                     │
│   [5] Voice Cloning + Dubbing (ElevenLabs)                         │
│        ↓ (generates audio in creator's cloned voice)               │
│                                                                     │
│   [6] Audio-Video Merge (FFmpeg)                                    │
│        ↓ (replaces original audio track)                            │
│                                                                     │
│   [7] Subtitle Generation (.SRT file)                               │
│        ↓ (timestamped captions from translated text)               │
│                                                                     │
│   [8] Download Ready ✅                                             │
│        → Dubbed video file                                          │
│        → Subtitle .SRT file                                         │
│        → Email notification when complete                           │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 🌐 Supported Languages

### Source Languages (Input)
| Language | Country | Status |
|:---|:---|:---|
| Yoruba | Nigeria | ✅ Supported |
| Igbo | Nigeria | ✅ Supported |
| Hausa | Nigeria / Niger / Chad | ✅ Supported |
| Nigerian Pidgin English | Nigeria | ✅ Supported |
| Twi / Akan | Ghana | ✅ Supported |
| Swahili | Kenya / Tanzania / Uganda | ✅ Supported |
| Amharic | Ethiopia | ✅ Supported |
| Zulu / Xhosa | South Africa | 🔜 Coming Soon |
| Wolof | Senegal | 🔜 Coming Soon |

### Target Languages (Output Dubs)
- 🇬🇧 English
- 🇪🇸 Spanish
- 🇫🇷 French
- 🇵🇹 Portuguese (Brazil)
- 🇩🇪 German
- 🇮🇹 Italian
- 🇯🇵 Japanese
- 🇰🇷 Korean
- 🇦🇪 Arabic

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
├── backend/                         # FastAPI app (Python)
│   ├── app/
│   │   ├── main.py                  # FastAPI entrypoint, CORS, router registration
│   │   ├── config.py                # env-driven settings (MOCK_MODE, Supabase, API keys)
│   │   ├── db.py                    # SQLAlchemy engine/session (Supabase Postgres)
│   │   ├── models.py                # Job, Subscription
│   │   ├── security.py              # Supabase Auth bearer-token dependency
│   │   ├── storage.py                # Supabase Storage upload/signed URLs
│   │   ├── worker.py                # orchestrates pipeline stages, updates job status
│   │   ├── routers/
│   │   │   ├── jobs.py              # POST /jobs (upload), GET /jobs/{id}
│   │   │   └── auth.py              # signup/login/logout (Supabase Auth)
│   │   └── pipeline/
│   │       ├── extract_audio.py     # FFmpeg (real)
│   │       ├── merge.py             # FFmpeg (real)
│   │       ├── transcribe.py        # Whisper adapter (mockable)
│   │       ├── translate.py         # DeepL adapter (mockable)
│   │       ├── dub.py               # ElevenLabs adapter (mockable)
│   │       └── subtitles.py         # .SRT generation
│   ├── tests/                       # pytest suite (mock-mode adapters, real-ffmpeg pipeline, API)
│   ├── requirements.txt
│   └── .env.example
│
├── docker-compose.yml                # run frontend+backend together
└── readme.md                         # this file
```

---

## 🚀 Getting Started (Local Development)

### Prerequisites
- Node.js 20+
- Python 3.11+
- FFmpeg installed and on your `PATH` (confirm with `ffmpeg -version`)
- A free [Supabase](https://supabase.com) account
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
# Edit .env: paste in DATABASE_URL, SUPABASE_URL, SUPABASE_KEY from the Supabase dashboard.
# Leave MOCK_MODE=true and the OPENAI/DEEPL/ELEVENLABS keys blank until you have them.
python -m venv .venv
.venv/Scripts/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
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

### 4. Or run both with Docker Compose
```bash
docker compose up
```

### Notes
- With `MOCK_MODE=true` (the default), the full pipeline runs without any OpenAI/DeepL/ElevenLabs
  keys — transcription, translation, and dubbing return placeholder data, while audio
  extraction/merging and subtitle generation are real. Set `MOCK_MODE=false` and fill in the three
  API keys in `backend/.env` once you have them to switch to real calls.
- Paystack/Stripe checkout is not implemented yet — the pricing tiers are modeled in the database
  but billing is a stub.
