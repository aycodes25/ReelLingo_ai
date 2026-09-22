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

ReelLingo/
├── frontend/                      # Next.js app
│   ├── app/
│   │   ├── page.tsx               # Landing page (hero split-video, CTA)
│   │   ├── dashboard/page.tsx     # Upload + language select + voice toggle
│   │   ├── jobs/[id]/page.tsx     # Processing status page (live steps)
│   │   └── result/[id]/page.tsx   # Result page (download video/SRT, share)
│   ├── components/                # UploadDropzone, LanguagePicker, StatusTimeline, etc.
│   └── lib/api.ts                 # typed client for backend endpoints
│
├── backend/                       # FastAPI app
│   ├── app/
│   │   ├── main.py                # FastAPI entrypoint
│   │   ├── routers/
│   │   │   ├── jobs.py            # POST /jobs (upload), GET /jobs/{id}
│   │   │   └── auth.py            # thin wrapper over Supabase Auth
│   │   ├── pipeline/
│   │   │   ├── extract_audio.py   # FFmpeg
│   │   │   ├── transcribe.py      # Whisper adapter (mockable)
│   │   │   ├── translate.py       # DeepL/GPT-4o adapter (mockable)
│   │   │   ├── dub.py             # ElevenLabs adapter (mockable)
│   │   │   ├── merge.py           # FFmpeg re-merge
│   │   │   └── subtitles.py       # .SRT generation
│   │   ├── worker.py              # runs pipeline steps as a background job, updates job status
│   │   ├── models.py               # SQLAlchemy models (users, jobs, subscriptions)
│   │   ├── db.py                  # Supabase Postgres connection
│   │   └── storage.py             # Supabase Storage upload/download
│   ├── requirements.txt
│   └── .env.example
│
├── docker-compose.yml              # optional: run frontend+backend together
└── README.md                       # updated setup instructions (Supabase project creation steps)
