# ReelLingo MVP Scaffold — Design

## Context

ReelLingo (renamed from AfriDub) is an AI video translation/dubbing platform for African-language
creators, described in `readme.md`, `tech_stack_and_costs.md`, `ui_ux_design.md`, and
`monetization.md`. Prior to this design, the workspace contained only planning docs — no
application code existed. This spec scopes a first, runnable full-stack scaffold of the product,
built to run locally without any paid API keys, and designed to swap in real integrations later
via env vars with no code changes.

## Goals

- A runnable full-stack app: Next.js frontend + FastAPI backend, wired together.
- The full pipeline (upload → extract audio → transcribe → translate → dub → merge → subtitles)
  runs end-to-end locally using mocked adapters, so the UX described in `ui_ux_design.md` (live
  status updates, result page) can be seen and exercised without any paid API keys.
- Real Supabase (Postgres + Auth + Storage) integration, since the user will create a free
  Supabase project themselves. No SQLite/local-disk fallback — Supabase is required to run
  anything that touches persistence.
- Every external paid service (Whisper, DeepL/GPT-4o, ElevenLabs, Paystack/Stripe) is wrapped in a
  small adapter with a `MOCK_MODE` flag, so flipping to `MOCK_MODE=false` with real keys later
  requires no code changes elsewhere.

## Non-goals (deferred, not part of this scaffold)

- Real payment collection (Paystack/Stripe checkout) — stubbed as "coming soon"; wiring a real
  business's payment account is out of scope for a scaffold.
- Background job queue infrastructure (Redis/Celery/etc.) — FastAPI `BackgroundTasks` is used for
  MVP; revisit if/when concurrency needs grow.
- Social login, password reset flows, team/agency accounts.
- End-to-end test automation for the frontend.
- Cloudflare R2 — Supabase Storage (S3-compatible, same free tier) is used instead, to avoid a
  third external service for the MVP.

## Architecture

Two services in a monorepo:

- **`frontend/`** — Next.js (TypeScript, App Router). Renders the landing page and dashboard from
  `ui_ux_design.md`, talks to the backend over HTTP, uploads video files directly to Supabase
  Storage, and polls job status.
- **`backend/`** — Python FastAPI. Exposes the job/auth REST API and runs the processing pipeline
  as a background task per job.
- **Supabase** — Postgres (users/jobs/subscriptions tables), Auth (email/password), Storage
  (uploaded + processed video files, subtitle files). The user creates the free project
  themselves; the backend reads `SUPABASE_URL`, `SUPABASE_KEY`, and `DATABASE_URL` from `.env`.
- **External AI/payment services** — Whisper (transcription), DeepL + GPT-4o (translation),
  ElevenLabs (voice dubbing), Paystack/Stripe (payments). Each is wrapped behind an adapter
  interface. In `MOCK_MODE=true` (the default with no keys set), adapters return canned/fake
  results so the pipeline completes without cost or credentials.

## Repo structure

```
ReelLingo/
├── frontend/
│   ├── app/
│   │   ├── page.tsx               # Landing page (hero split-video, CTA)
│   │   ├── dashboard/page.tsx     # Upload + language select + voice toggle
│   │   ├── jobs/[id]/page.tsx     # Processing status page (live steps)
│   │   └── result/[id]/page.tsx   # Result page (download video/SRT, share)
│   ├── components/                # UploadDropzone, LanguagePicker, StatusTimeline, etc.
│   └── lib/api.ts                 # typed client for backend endpoints
│
├── backend/
│   ├── app/
│   │   ├── main.py                # FastAPI entrypoint
│   │   ├── routers/
│   │   │   ├── jobs.py            # POST /jobs (create), GET /jobs/{id} (status)
│   │   │   └── auth.py            # thin wrapper over Supabase Auth
│   │   ├── pipeline/
│   │   │   ├── extract_audio.py   # FFmpeg
│   │   │   ├── transcribe.py      # Whisper adapter (mockable)
│   │   │   ├── translate.py       # DeepL/GPT-4o adapter (mockable)
│   │   │   ├── dub.py             # ElevenLabs adapter (mockable)
│   │   │   ├── merge.py           # FFmpeg re-merge
│   │   │   └── subtitles.py       # .SRT generation
│   │   ├── worker.py              # runs pipeline stages in order, updates job status
│   │   ├── models.py              # SQLAlchemy models: users, jobs, subscriptions
│   │   ├── db.py                  # Supabase Postgres connection (SQLAlchemy)
│   │   └── storage.py             # Supabase Storage upload/download helpers
│   ├── tests/                     # pytest: pipeline adapters (mock mode), job-status transitions
│   ├── requirements.txt
│   └── .env.example
│
├── docker-compose.yml              # optional: run frontend+backend together
└── README.md                       # updated with Supabase project creation steps + run instructions
```

## Data flow

1. User signs up/logs in via Supabase Auth in the frontend; the session token is sent to the
   backend as `Authorization: Bearer <token>`.
2. User drags a video into the dashboard, picks source/target language and the voice-clone
   toggle. The frontend uploads the file directly to a Supabase Storage bucket, then calls
   `POST /jobs` with the storage path and chosen options.
3. Backend creates a `jobs` row (`status: queued`) and starts a background task.
4. The worker runs each pipeline stage in order, updating `jobs.status` / `jobs.current_step`
   after each stage: `extracting_audio` → `transcribing` → `translating` → `dubbing` → `merging`
   → `generating_subtitles` → `done` / `failed`.
5. The frontend polls `GET /jobs/{id}` every few seconds on the status page, driving the live
   "Extracting audio... Transcribing..." UI from `ui_ux_design.md`.
6. On `done`, the result page fetches signed URLs for the output video and `.srt` file from
   Supabase Storage.

## Auth & billing (MVP scope)

- **Auth:** Supabase email/password only — signup, login, logout. No social login or password
  reset flow yet.
- **Billing:** The tiers and pay-as-you-go options from `monetization.md` are modeled in a
  `subscriptions` table and enforced with simple checks (max video length, monthly video count)
  at job-creation time. Real Paystack/Stripe checkout is stubbed (a "Coming soon" action that
  records intent) rather than faked, since real payment collection needs the user's own business
  accounts.

## Error handling

- Each pipeline stage runs in a try/except; on failure the job is marked `failed` with an
  `error_message` field, surfaced on the status page instead of hanging or silently retrying.
- Uploads are validated for file type and size (2GB cap, per `readme.md`) before a job is
  accepted.
- Per-tier limits (video length, monthly count) are checked at job-creation time and return a
  4xx with an upsell message, rather than silently trimming the video.

## Testing

- **Backend:** pytest covering pipeline adapters in mock mode (each stage produces the expected
  output shape) and job-status transitions (queued → ... → done/failed).
- **Frontend:** no automated e2e for this scaffold; verified manually by running the dev server
  and walking the upload → processing → result flow.

## Mock mode details

- Controlled by a single `MOCK_MODE` env var (default `true` when no keys are present).
- `transcribe.py`: returns a fixed placeholder transcript string in the requested source language.
- `translate.py`: returns the transcript prefixed/tagged as translated (no real translation call).
- `dub.py`: copies the extracted audio through unchanged (no real voice synthesis) so the merge
  stage has a real audio file to work with.
- `extract_audio.py` / `merge.py` / `subtitles.py`: always run for real via FFmpeg — these are
  free, local, and don't need mocking.
- Paystack/Stripe adapter: always stubbed in this scaffold regardless of `MOCK_MODE` (see
  Non-goals).

## Open items for the user

- Create a free Supabase project (steps documented in the updated `README.md`) and supply
  `SUPABASE_URL`, `SUPABASE_KEY`, `DATABASE_URL` in `backend/.env`.
- FFmpeg must be installed locally (or available in the dev container) for audio
  extraction/merging to work even in mock mode.
