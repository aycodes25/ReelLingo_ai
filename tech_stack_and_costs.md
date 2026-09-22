# ⚙️ Tech Stack & Costs

## 🔧 The APIs & Tools You Need

### 1. OpenAI Whisper (Transcription)
- **What it does:** Listens to the video audio → converts speech to text.
- **Why Whisper:** Best-in-class for African languages and accents. Genuinely understands Pidgin.
- **Cost:** $0.006 per minute of audio.

### 2. DeepL API / GPT-4o (Translation)
- **What it does:** Converts transcribed text to target language.
- **Approach:** Use DeepL for base translation (cheaper), then optionally use GPT-4o to refine it so it sounds natural.
- **DeepL Cost:** 500,000 characters/month FREE. After that: $0.025 per 1,000 chars.
- **GPT-4o Cost:** ~$0.13 per 60 mins of dialogue.

### 3. ElevenLabs (Voice Dubbing)
- **What it does:** Generates realistic dubbed audio in the creator's cloned voice.
- **Cost:** This is your biggest expense.
  - $22/mo Creator plan gives you 100,000 characters.
  - Overage is $0.30 per 1,000 extra characters.
  - *Tip:* Clone the voice once and reuse it to save API calls, or limit video length on lower tiers.

### 4. FFmpeg (Audio/Video Processing)
- **What it does:** Strips audio, merges new audio, generates subtitles.
- **Cost:** Free (runs on your backend server).

### 5. Backend & Storage
- **Backend Framework:** Next.js (Frontend) + Node.js/Python FastAPI (Processing queue).
- **Hosting:** Railway or Render ($10-$20/mo) for backend, Vercel (Free) for frontend.
- **Storage:** Cloudflare R2 ($0.015 per GB, free egress).
- **Database:** Supabase (Free tier is enough to start).
- **Payments:** Paystack & Stripe.

---

## 💸 Cost per 60-Minute Video

| Component | Estimated Cost |
| :--- | :--- |
| Whisper transcription (60 mins) | $0.36 |
| GPT-4o translation | $0.13 |
| ElevenLabs voice dubbing | $11.70 |
| Storage + compute | $0.20 |
| **TOTAL per 60-minute video** | **~$12.39** (~₦20,000) |

## 💡 Profit Margins

| Video Length | Your Cost | You Charge User | Profit Per Video |
| :--- | :--- | :--- | :--- |
| 5 minutes | ~$1.10 | $3.00 | **$1.90** |
| 15 minutes | ~$3.40 | $5.00 | **$1.60** |
| 30 minutes | ~$6.40 | $10.00 | **$3.60** |
| 60 minutes | ~$12.39 | $20.00 | **$7.61** |
