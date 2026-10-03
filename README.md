# ReelLingo

**AI video translation and dubbing for African creators.** Upload a video in Yoruba, Igbo, Hausa, Pidgin, Swahili, Twi or 50+ other languages and get it back in English, French, Spanish, Portuguese and more — in the speaker's own voice, with the original music kept and subtitles ready.

> Break the language barrier. Reach the world. Sound like yourself.

---

## What it does

A creator uploads a video (or pastes a link). ReelLingo:

1. **Transcribes** the speech with timestamps, detecting the language of every line (videos that switch languages are fine).
2. **Translates** each line, following the creator's glossary and chosen tone.
3. *(Optional)* **Pauses for review** so the creator can fix names and slang line by line.
4. **Separates** the background music and sound effects from the voices.
5. **Dubs** each line in a clone of the original speaker's voice — one voice per speaker for interviews and skits.
6. **Mixes** the dub over the original background and puts it back on the video.
7. **Exports** the dubbed video, an MP3, SRT/VTT subtitles, optional burned-in captions, vertical/square versions, and optional lip-sync.

## Features

| Area | What's included |
|:---|:---|
| **Dubbing** | Speaker voice cloning, saved voices, multi-speaker dubbing, background music kept, lip-sync (premium), audio-only podcast dubbing |
| **Translation** | 53 languages, automatic language detection per line, glossary of protected names and terms, tone (natural, formal, casual, keep the local flavour), review-and-edit before dubbing, re-dub only the edited lines |
| **Exports** | MP4, MP3, SRT, VTT, ASS; burned-in caption styles (classic, boxed, bold, karaoke); 9:16, 1:1, 4:5 and 16:9 versions; AI title, description and hashtags |
| **Input** | Resumable uploads up to 2 GB, import from YouTube, TikTok, Instagram, Facebook, Google Drive, Dropbox or a direct link, several target languages from one upload |
| **Sharing** | Public watch pages with a Dub/Original comparison player, one-click YouTube publishing |
| **Business** | Plans, Paystack (₦) and Stripe ($) checkout, pay-as-you-go credits, referrals, team workspaces, API keys |
| **Operations** | Job queue that survives restarts, retries that resume where they stopped, email and WhatsApp notifications, live progress, rate limiting, virus scanning, structured logs, Sentry, file retention |
| **Admin** | A separate admin website ([ReelLingo_Admin](https://github.com/aycodes25/ReelLingo_Admin)) to manage users, plans, app-wide settings, teams and payments, plus an API usage dashboard: balance left at each paid provider, usage per user, monthly per-user limits and low-balance email alerts |

## Plans

Plans live in the database and are edited from the admin website. The defaults follow [`.docs/monetization.md`](.docs/monetization.md):

| Plan | Price | Videos / month | Max length | Highlights |
|:---|:---|:---|:---|:---|
| Free | ₦0 | 1 | 3 min | Standard voices, watermark |
| Starter | ₦16,000 / $10 | 5 | 10 min | Voice cloning, no watermark, 2 languages per upload |
| Creator | ₦40,000 / $25 | 10 | 25 min | Saved voice, multi-speaker, YouTube publishing, 4 languages per upload |
| Studio | ₦130,000 / $80 | 30 | 60 min | Lip-sync, team workspace, API access, 10 languages per upload |

Pay-as-you-go credits cover one video each: up to 5, 15, 30 or 60 minutes.

---

## Running it on your computer

ReelLingo runs directly on Windows, macOS or Linux — no Docker needed.

### What you need

- **Node.js 20+** — https://nodejs.org
- **FFmpeg** — Windows: `winget install Gyan.FFmpeg`
- **Python 3.10+** with **Demucs** and **yt-dlp** for background-music separation and link imports:
  `python -m pip install demucs soundfile yt-dlp`
  (On Windows, Demucs also needs the Microsoft Visual C++ Redistributable: `winget install Microsoft.VCRedist.2015+.x64`.)
- A **Supabase** project (sign-in, database and video storage), an **OpenAI** API key and an **ElevenLabs** API key (a paid ElevenLabs plan is needed for voice cloning).

### Set up and start

```bash
npm run setup     # first time only: installs everything
npm run check     # shows which tools and keys are in place (never prints key values)
npm run dev       # starts the API (port 8000) and the website (port 3000) together
```

Open http://localhost:3000. Stop with `Ctrl+C`; after editing `backend/.env`, stop and run `npm run dev` again.

### Keys and settings

All keys go in **`backend/.env`** (copy `backend/.env.example` to start). Every key in that file has a comment above it explaining where to sign up and how to copy the key. The website's settings are in `frontend/.env.local`.

| Needed for | Keys |
|:---|:---|
| **Required** | `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_KEY` (service_role), `OPENAI_API_KEY`, `ELEVENLABS_API_KEY`, `APP_SECRET`, `ADMIN_EMAILS` |
| Payments | `PAYSTACK_SECRET_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` |
| Notifications | `RESEND_API_KEY`, `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` |
| Premium & monitoring | `OPENAI_ADMIN_KEY` (OpenAI billing on the usage dashboard), `SYNC_API_KEY` (lip-sync), `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (YouTube), `SENTRY_DSN`, `CLAMAV_HOST` |

Optional features stay switched off until their keys are added. Business settings — which features are on, limits, maintenance mode, announcements — are changed live from the admin website.

### Database (Supabase): you apply changes yourself

The backend **never changes your Supabase database on its own**. When it starts it only checks, read-only, that its tables exist; if something is missing it stops and says what to run.

| File | What it does |
|:---|:---|
| [`backend/sql/check.sql`](backend/sql/check.sql) | Read-only. Lists your tables and whether Row Level Security is on. |
| [`backend/sql/schema.sql`](backend/sql/schema.sql) | Creates missing ReelLingo tables and columns, turns Row Level Security on, and blocks Supabase's public API roles from these tables. Safe to run more than once; never deletes data. |

To run one: Supabase dashboard → **SQL Editor** → **New query** → paste the file → **Run**.
Also make sure the `reellingo-videos` storage bucket is **private**.

When the code's tables change, `npm --prefix backend run sql` regenerates `schema.sql` (without connecting to any database) and you run it again.

### Admin website

The admin area is a separate app: **[ReelLingo_Admin](https://github.com/aycodes25/ReelLingo_Admin)**. Clone it next to this project, run `npm install` and `npm run dev`, and open http://localhost:3001. Sign in with an email listed in `ADMIN_EMAILS`. Admins also see an **Admin ↗** link in the studio sidebar.

For Google/Facebook sign-in on the admin site, add `http://localhost:3001/auth/callback` under Supabase → Authentication → URL Configuration → Redirect URLs.

---

## How it's built

| Part | Technology |
|:---|:---|
| Website | Next.js 15 (App Router), React 18, TypeScript |
| API & worker | Node.js, Express |
| Database & auth | Supabase (Postgres + Auth + Storage); SQLite for local tests |
| Speech & translation | OpenAI Whisper and GPT-4o mini; ElevenLabs Scribe for multi-speaker |
| Voices | ElevenLabs (voice cloning and speech) |
| Media | FFmpeg, Demucs (music separation), yt-dlp (link imports), sync.so (lip-sync) |
| Payments | Paystack, Stripe |

The API runs the job queue inside the same process by default. For more capacity, set `WORKER_MODE=off` and run `npm --prefix backend run worker` separately.

## Project structure

```
ReelLingo/
├── backend/
│   ├── server.js            API entry point
│   ├── worker.js            Standalone job worker (optional)
│   ├── src/
│   │   ├── pipeline.js      The dubbing pipeline (resumable steps)
│   │   ├── transcription.js / translation.js / dubbing.js / separation.js / render.js / lipsync.js
│   │   ├── worker.js        Job queue, crash recovery, retention cleanup
│   │   ├── db.js            Schema, Postgres/SQLite access, read-only schema check
│   │   ├── plans.js / accounts.js / billing.js / teams.js / admin.js / settings.js
│   │   └── routes/          HTTP endpoints (jobs, account, billing, teams, admin, public, auth)
│   ├── sql/                 SQL you run yourself in Supabase
│   ├── scripts/             SQL generator
│   └── test/                Backend tests (node:test)
├── frontend/
│   ├── app/                 Pages: landing, dashboard, projects, editor, results, billing, teams, glossary, settings, watch, API docs
│   ├── components/          Shared UI
│   ├── lib/                 API client, types, helpers
│   └── tests/               Frontend tests (Vitest)
├── scripts/check-setup.mjs  `npm run check`
└── .docs/                   Product, marketing, pricing and design notes
```

## Tests

```bash
npm test                                # everything
npm --prefix backend test               # API, pipeline (end to end with mocked AI providers), admin, billing
npm --prefix frontend test              # UI and API client
npm --prefix frontend run typecheck
```

Tests use a temporary local SQLite database and mocked AI providers; they never touch Supabase or spend API credits.

## API

Studio-plan customers can automate dubbing with API keys. The reference is served by the website at `/docs/api` (http://localhost:3000/docs/api when running locally).

## More documentation

- [Product overview](.docs/readme.md) — the problem, who it's for, supported languages
- [Monetization](.docs/monetization.md) · [Marketing](.docs/marketing.md) · [Tech stack and costs](.docs/tech_stack_and_costs.md) · [UI/UX design](.docs/ui_ux_design.md)

---

*Built with purpose. Built for Africa. Built for the world.*
