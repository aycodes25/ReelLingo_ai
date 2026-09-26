# ⚙️ Tech Stack & Costs

## 🔧 The APIs & Tools You Need

### 1. OpenAI Whisper (Transcription)
- **What it does:** Listens to the video audio → converts speech to text.
- **Language coverage:** Regional-language quality varies. Review transcripts for Yoruba, Igbo, Hausa, and Pidgin before publishing.
- **Cost:** $0.006 per minute of audio.

### 2. OpenAI GPT-4o mini (Translation)
- **What it does:** Converts transcribed text to target language.
- **Approach:** Translates timestamped segments and retains their order and timings.
- **Cost:** Model pricing varies by token volume; see OpenAI's current pricing before setting plan limits.

### 3. OpenAI Speech (Dubbing)
- **What it does:** Generates spoken audio in the selected target language.
- **Voice cloning:** ElevenLabs instant voice cloning is required for a completed dub. It uses a speech sample extracted from the uploaded clip, then deletes the temporary clone after synthesis. No saved voice ID is needed.
- **Cost:** Check current provider pricing; audio generation cost depends on model and transcript length.

### 4. FFmpeg (Audio/Video Processing)
- **What it does:** Strips audio, merges new audio, generates subtitles.
- **Cost:** Free (runs on your backend server).

### 5. Backend & Storage
- **Backend Framework:** Next.js (Frontend) + Node.js/Express (Processing API and worker).
- **Hosting:** Railway or Render ($10-$20/mo) for backend, Vercel (Free) for frontend.
- **Storage:** Cloudflare R2 ($0.015 per GB, free egress).
- **Database:** Supabase (Free tier is enough to start).
- **Payments:** Paystack & Stripe.

---

## 💸 Cost per 60-Minute Video

| Component | Estimated Cost |
| :--- | :--- |
| Transcription, translation, and speech generation | Depends on selected models and transcript length |
| Storage + compute | Depends on video duration, size, and hosting |
| **TOTAL per video** | **Set plan pricing after measuring provider usage** |

## 💡 Profit Margins

| Video Length | Your Cost | You Charge User | Profit Per Video |
| :--- | :--- | :--- | :--- |
| 5 minutes | ~$1.10 | $3.00 | **$1.90** |
| 15 minutes | ~$3.40 | $5.00 | **$1.60** |
| 30 minutes | ~$6.40 | $10.00 | **$3.60** |
| 60 minutes | ~$12.39 | $20.00 | **$7.61** |
