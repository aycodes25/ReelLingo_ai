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

## 🛠️ Setup, features and development

Everything technical (running the app, keys, the database steps you run yourself in Supabase, the admin website, project structure and tests) is in the main **[README](../README.md)**.

---

*Built with purpose. Built for Africa. Built for the world.*
