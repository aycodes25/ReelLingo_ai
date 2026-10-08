# ReelLingo

**AI video translation and dubbing for African creators.** Upload a video in Yoruba, Igbo, Hausa, Pidgin, Swahili, Twi or 50+ other languages and get it back in English, French, Spanish, Portuguese and more — in the speaker's own voice, with the original music kept and subtitles ready.

> Break the language barrier. Reach the world. Sound like yourself.

---

## What it does

A creator uploads a video (or picks one from their own YouTube channel, or a Google Drive / Dropbox link). ReelLingo:

1. **Transcribes** the speech with timestamps, detecting the language of every line (videos that switch languages are fine).
2. **Translates** each line, following the creator's glossary and chosen tone.
3. *(Optional)* **Pauses for review**: a native-speaker reviewer (paid add-on) and/or the creator fixes names and slang line by line.
4. **Separates** the background music and sound effects from the voices.
5. **Dubs** each line in a clone of the original speaker's voice — one voice per speaker for interviews and skits — or in a native Nigerian voice (Spitch) for Yoruba, Hausa, Igbo and Pidgin.
6. **Mixes** the dub over the original background and puts it back on the video.
7. **Exports** the dubbed video, an MP3, SRT/VTT subtitles, optional burned-in captions, vertical/square versions, optional lip-sync, and on request 3-5 short captioned clips for TikTok and Reels.

Creators who only need subtitles can choose **Subtitles only**: no voice, a tenth of the minutes.

## Features

| Area | What's included |
|:---|:---|
| **Dubbing** | Speaker voice cloning, saved voices, native Yoruba/Hausa/Igbo/Pidgin voices (Spitch) with Yoruba tone marks, multi-speaker dubbing, background music kept, lip-sync (premium add-on), audio-only podcast dubbing, subtitles-only projects |
| **Translation** | 53 languages, automatic language detection per line, glossary of protected names and terms, tone (natural, formal, casual, keep the local flavour), review-and-edit before dubbing, re-dub only the edited lines |
| **Exports** | MP4, MP3, SRT, VTT, ASS; burned-in caption styles (classic, boxed, bold, karaoke); 9:16, 1:1, 4:5 and 16:9 versions; AI title, description and hashtags |
| **Input** | Resumable uploads up to 2 GB, import from the creator's own YouTube channel (ownership checked), Google Drive, Dropbox or a direct link, several target languages from one upload. TikTok/Instagram/Facebook links are refused: creators download their video and upload the file |
| **Sharing** | Public watch pages with a Dub/Original comparison player, one-click YouTube publishing, add subtitles and translated titles to videos already on YouTube, short clips |
| **Business** | Plans in minutes (monthly or yearly), Paystack (₦) and Stripe ($), never-expiring minute packs, paid add-ons (lip-sync, human review, clips), a Church & Ministry plan, referrals paid only on profitable purchases, team workspaces and API keys (hidden until switched on) |
| **Quality & trust** | Human review by native speakers (reviewers are paid per minute from the admin), Voice Lab to rate every voice before customers hear it, consent checkboxes for video rights and voice cloning, Terms of Service and an NDPA-aligned Privacy Policy, "download my data" and "delete my account" |
| **Operations** | Job queue that survives restarts, retries that resume where they stopped, email and WhatsApp notifications, live progress, rate limiting, virus scanning, structured logs, Sentry, file retention |
| **Admin** | A separate admin website ([ReelLingo_Admin](https://github.com/aycodes25/ReelLingo_Admin)) to manage users, plans, minutes, app-wide settings, teams and payments; a **Profit check** for every plan and pack; reviewers and their payouts; the Voice Lab; and an API usage dashboard: balance left at each paid provider, usage per user, monthly per-user limits and low-balance email alerts |

## Plans and minutes

Everything is paid for in **minutes**: 1 minute = 1 minute of video dubbed into 1 language. Plans include minutes every month (renewing on the customer's own billing day); **extra minutes** bought in packs never expire. Failed or deleted projects give their minutes back automatically.

| Plan | Price (monthly / yearly) | Minutes a month | Videos up to | Highlights |
|:---|:---|:---|:---|:---|
| Free | ₦0 | 2 | 3 min | Standard voices, watermark |
| Subtitles | ₦4,500 / ₦45,000 · $3 / $30 | 5 (= 50 of subtitles) | 60 min | Subtitles in 50+ languages, caption styles |
| Starter | ₦15,000 / ₦150,000 · $10 / $100 | 16 | 10 min | Voice cloning, no watermark, short clips |
| Creator | ₦38,000 / ₦380,000 · $25 / $250 | 40 | 30 min | Saved voice, multi-speaker, YouTube, human review & lip-sync add-ons |
| Studio | ₦115,000 / ₦1,150,000 · $75 / $750 | 125 | 60 min | Lip-sync add-on, team workspace, API access |
| Church & Ministry | ₦225,000 / ₦2,250,000 · $150 / $1,500 | 250 | 120 min | Sermons in English, French, Yoruba, Hausa & Igbo, pastor's saved voice |
| Agency & Nollywood | Custom | Custom | 120 min | Contact sales |

Minute packs: 5 min ₦5,000 · 15 min ₦14,500 · 30 min ₦28,500 · 60 min ₦57,000 (or $3.50 / $9.50 / $18.50 / $36).
Extras use more minutes per minute of video: subtitles only ×0.1, lip-sync +12, human review +1, a set of short clips 1 minute.

**Why these prices are safe:** a dubbed minute costs at most about **$0.45** in AI services (fast talker, every paid service on, at ₦1,600/$ — above today's rate on purpose). Every plan and pack above stays profitable even if a customer uses every single minute; typical customers leave a 60-80% margin. Free users together can never cost more than a monthly budget you set (default $20). Admin → **Profit check** shows the numbers for your own provider prices and warns you if any price could lose money; **Apply recommended pricing** puts these values on your live plans.

---

## Running it on your computer

ReelLingo runs directly on Windows, macOS or Linux — no Docker needed.

### What you need

- **Node.js 20+** — https://nodejs.org
- **FFmpeg** — Windows: `winget install Gyan.FFmpeg`
- **Python 3.10+** with **Demucs** and **yt-dlp** for background-music separation and link imports:
  `python -m pip install demucs soundfile yt-dlp`
  (On Windows, Demucs also needs the Microsoft Visual C++ Redistributable: `winget install Microsoft.VCRedist.2015+.x64`.)
- A **Supabase** project (sign-in and database), a **Cloudflare R2** bucket for video files (free tier: 10 GB, free downloads; Supabase Storage also works), an **OpenAI** API key and an **ElevenLabs** API key (a paid ElevenLabs plan is needed for voice cloning).

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
| Video storage | `STORAGE_PROVIDER=r2`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` (leave `STORAGE_PROVIDER` empty to use Supabase Storage) |
| Payments | `PAYSTACK_SECRET_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` |
| Notifications | `RESEND_API_KEY`, `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` |
| Premium & monitoring | `SPITCH_API_KEY` (native Nigerian voices), `OPENAI_ADMIN_KEY` (OpenAI billing on the usage dashboard), `SYNC_API_KEY` (lip-sync), `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (YouTube), `SENTRY_DSN`, `CLAMAV_HOST` |
| Plans renewing automatically | `PAYSTACK_PLAN_<PLAN>` and `PAYSTACK_PLAN_<PLAN>_YEARLY` (and `STRIPE_PRICE_…`) — optional; without them customers pay per period by card, transfer or USSD |
| Legal pages | `LEGAL_COMPANY_NAME`, `LEGAL_ADDRESS`, `DPO_EMAIL` (also editable in Admin → App settings → Legal) |

Optional features stay switched off until their keys are added. Business settings — which features are on, limits, maintenance mode, announcements — are changed live from the admin website.

### Database (Supabase): you apply changes yourself

The backend **never changes your Supabase database on its own**. When it starts it only checks, read-only, that its tables exist; if something is missing it stops and says what to run.

| File | What it does |
|:---|:---|
| [`backend/sql/check.sql`](backend/sql/check.sql) | Read-only. Lists your tables and whether Row Level Security is on. |
| [`backend/sql/schema.sql`](backend/sql/schema.sql) | Creates missing ReelLingo tables and columns, turns Row Level Security on, and blocks Supabase's public API roles from these tables. Safe to run more than once; never deletes data. |
| [`backend/sql/audit-triggers.sql`](backend/sql/audit-triggers.sql) | Optional. Also records changes made directly in the Supabase table editor or SQL editor in Admin → Audit log (changes made by the app are already logged and are skipped). Run it after `schema.sql`. |

To run one: Supabase dashboard → **SQL Editor** → **New query** → paste the file → **Run**.
If you store videos in Supabase Storage, make sure the `reellingo-videos` bucket is **private**. Moving to Cloudflare R2? `npm --prefix backend run storage:copy-to-r2` copies existing files across (it only reads from Supabase).

When the code's tables change, `npm --prefix backend run sql` regenerates `schema.sql` (without connecting to any database) and you run it again.

### Keep the database awake and backed up (free)

Free Supabase projects pause after 7 days without activity and don't keep backups you can restore. The workflow [`.github/workflows/database-keepalive-and-backup.yml`](.github/workflows/database-keepalive-and-backup.yml) runs every day on GitHub's computers (even when your PC is off): it touches the database so it never pauses, and saves a full copy to Cloudflare R2, keeping the last 14 days. It only reads the database.

Set it up once:

1. **Cloudflare:** R2 → **Create bucket** → name it `reellingo-backups` (private). Then R2 → **Manage API tokens** → **Create API token** → *Object Read & Write*, bucket `reellingo-backups` → copy the Access Key ID and Secret.
2. **Supabase:** Project → **Connect** → copy the **Session pooler** connection string (port 5432) and put your database password in it.
3. **GitHub:** this repository → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**, and add:
   `DATABASE_URL` (step 2), `R2_ACCOUNT_ID`, `R2_BACKUP_ACCESS_KEY_ID`, `R2_BACKUP_SECRET_ACCESS_KEY` (step 1), `R2_BACKUP_BUCKET` = `reellingo-backups`.
   Optional: `SUPABASE_URL` and `SUPABASE_ANON_KEY` (Supabase → Project Settings → API) for an extra API ping.
4. **Test it:** GitHub → **Actions** → *Keep the database awake and back it up* → **Run workflow**. A green tick means it worked; the backup appears in your R2 bucket under `database/`.

To restore a backup into a new Supabase project: download the `.dump` file from R2, then run `pg_restore --no-owner --dbname "<new project's connection string>" reellingo-db-YYYY-MM-DD.dump` (or ask for help). Once customers pay you, upgrading to Supabase Pro ($25/month) adds point-in-time backups and removes the pause entirely.

### Admin website

The admin area is a separate app: **[ReelLingo_Admin](https://github.com/aycodes25/ReelLingo_Admin)**. Clone it next to this project, run `npm install` and `npm run dev`, and open http://localhost:3001. Sign in with an email listed in `ADMIN_EMAILS`. Admins also see an **Admin ↗** link in the studio sidebar.

For Google/Facebook sign-in on the admin site, add `http://localhost:3001/auth/callback` under Supabase → Authentication → URL Configuration → Redirect URLs.

### Quality, reviewers and legal

- **Nigerian voices:** add `SPITCH_API_KEY`, then use **Admin → Voice Lab** to generate the same sentence with every engine and voice, send the samples to native Yoruba, Hausa and Igbo speakers, and record their scores before choosing the engine in Admin → App settings → Nigerian voices. Videos *spoken* in Yoruba, Hausa, Igbo or Pidgin are transcribed with ElevenLabs Scribe, which handles them far better than Whisper.
- **Human reviewers:** open a user in Admin → Users and tick *This person is a reviewer* with their languages. They see a Reviews page in the app, pick up projects, correct them and submit. Their earnings show in Admin → Reviewers; mark them paid after sending the money. Reviews nobody picks up within 48 hours continue without review and are refunded.
- **YouTube:** creators connect their channel in Settings to import their own videos and add subtitles/translated titles to videos already published. People who connected before this update must disconnect and connect again once (new permission).
- **Legal:** fill in your CAC business name, address and privacy email in Admin → App settings → Legal; they appear on `/terms` and `/privacy`. These pages follow Nigeria's Data Protection Act 2023, but have a Nigerian lawyer review them before launch.

---

## How it's built

| Part | Technology |
|:---|:---|
| Website | Next.js 15 (App Router), React 18, TypeScript |
| API & worker | Node.js, Express |
| Database & auth | Supabase (Postgres + Auth); SQLite for local tests |
| File storage | Cloudflare R2 (S3-compatible), or Supabase Storage |
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
