-- ReelLingo database schema for Supabase (Postgres).
-- Generated from backend/src/db.js by `npm run sql` — do not edit by hand.
-- Run it yourself: Supabase dashboard → SQL Editor → New query → paste this file → Run.
-- Safe to run more than once: it only adds what's missing and never deletes data.

BEGIN;

-- jobs
CREATE TABLE IF NOT EXISTS public.jobs (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT,
  team_id BIGINT,
  batch_id TEXT,
  depends_on BIGINT,
  status TEXT NOT NULL DEFAULT 'queued',
  current_step TEXT NOT NULL DEFAULT 'queued',
  source_language TEXT NOT NULL,
  target_language TEXT NOT NULL,
  voice_clone BOOLEAN NOT NULL DEFAULT FALSE,
  input_storage_path TEXT NOT NULL DEFAULT '',
  source_url TEXT,
  media_type TEXT NOT NULL DEFAULT 'video',
  options_json TEXT,
  output_video_path TEXT,
  output_srt_path TEXT,
  outputs_json TEXT,
  transcript_json TEXT,
  translated_segments_json TEXT,
  detected_languages_json TEXT,
  metadata_json TEXT,
  speakers_json TEXT,
  clips_json TEXT,
  duration_seconds DOUBLE PRECISION,
  error_message TEXT,
  original_filename TEXT,
  processing_note TEXT,
  priority BIGINT NOT NULL DEFAULT 0,
  attempts BIGINT NOT NULL DEFAULT 0,
  heartbeat_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  review_state TEXT,
  redub_count BIGINT NOT NULL DEFAULT 0,
  share_slug TEXT,
  share_original BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_at TIMESTAMPTZ,
  files_expired_at TIMESTAMPTZ,
  credit_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ
);
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS team_id BIGINT;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS batch_id TEXT;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS depends_on BIGINT;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'queued';
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS current_step TEXT NOT NULL DEFAULT 'queued';
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS source_language TEXT;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS target_language TEXT;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS voice_clone BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS input_storage_path TEXT NOT NULL DEFAULT '';
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS source_url TEXT;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS media_type TEXT NOT NULL DEFAULT 'video';
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS options_json TEXT;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS output_video_path TEXT;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS output_srt_path TEXT;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS outputs_json TEXT;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS transcript_json TEXT;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS translated_segments_json TEXT;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS detected_languages_json TEXT;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS metadata_json TEXT;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS speakers_json TEXT;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS clips_json TEXT;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS duration_seconds DOUBLE PRECISION;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS error_message TEXT;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS original_filename TEXT;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS processing_note TEXT;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS priority BIGINT NOT NULL DEFAULT 0;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS attempts BIGINT NOT NULL DEFAULT 0;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMPTZ;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS review_state TEXT;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS redub_count BIGINT NOT NULL DEFAULT 0;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS share_slug TEXT;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS share_original BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS files_expired_at TIMESTAMPTZ;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS credit_id BIGINT;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS jobs_user_created ON public.jobs (user_id, created_at);
CREATE INDEX IF NOT EXISTS jobs_status ON public.jobs (status);
CREATE INDEX IF NOT EXISTS jobs_team ON public.jobs (team_id);
CREATE INDEX IF NOT EXISTS jobs_batch ON public.jobs (batch_id);
CREATE UNIQUE INDEX IF NOT EXISTS jobs_share_slug ON public.jobs (share_slug);
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.jobs FROM anon, authenticated;

-- plans
CREATE TABLE IF NOT EXISTS public.plans (
  id BIGSERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  blurb TEXT,
  price_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
  price_ngn BIGINT NOT NULL DEFAULT 0,
  videos_per_month BIGINT NOT NULL DEFAULT 1,
  max_video_minutes BIGINT NOT NULL DEFAULT 3,
  voice_clone BOOLEAN NOT NULL DEFAULT FALSE,
  watermark BOOLEAN NOT NULL DEFAULT FALSE,
  priority BIGINT NOT NULL DEFAULT 0,
  max_targets BIGINT NOT NULL DEFAULT 1,
  lip_sync BOOLEAN NOT NULL DEFAULT FALSE,
  api_access BOOLEAN NOT NULL DEFAULT FALSE,
  team_seats BIGINT NOT NULL DEFAULT 1,
  saved_voices BIGINT NOT NULL DEFAULT 0,
  features_json TEXT,
  sort BIGINT NOT NULL DEFAULT 0,
  public BOOLEAN NOT NULL DEFAULT TRUE,
  permissions_json TEXT,
  contact_sales BOOLEAN NOT NULL DEFAULT FALSE
);
ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS code TEXT UNIQUE;
ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS blurb TEXT;
ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS price_usd DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS price_ngn BIGINT NOT NULL DEFAULT 0;
ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS videos_per_month BIGINT NOT NULL DEFAULT 1;
ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS max_video_minutes BIGINT NOT NULL DEFAULT 3;
ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS voice_clone BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS watermark BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS priority BIGINT NOT NULL DEFAULT 0;
ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS max_targets BIGINT NOT NULL DEFAULT 1;
ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS lip_sync BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS api_access BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS team_seats BIGINT NOT NULL DEFAULT 1;
ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS saved_voices BIGINT NOT NULL DEFAULT 0;
ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS features_json TEXT;
ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS sort BIGINT NOT NULL DEFAULT 0;
ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS public BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS permissions_json TEXT;
ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS contact_sales BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.plans FROM anon, authenticated;

-- subscriptions
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  tier TEXT NOT NULL DEFAULT 'free',
  videos_used_this_month BIGINT NOT NULL DEFAULT 0,
  max_video_minutes BIGINT NOT NULL DEFAULT 3,
  max_videos_per_month BIGINT NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  provider TEXT,
  provider_ref TEXT,
  provider_customer TEXT,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ,
  overrides_json TEXT
);
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS user_id TEXT UNIQUE;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS tier TEXT NOT NULL DEFAULT 'free';
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS videos_used_this_month BIGINT NOT NULL DEFAULT 0;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS max_video_minutes BIGINT NOT NULL DEFAULT 3;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS max_videos_per_month BIGINT NOT NULL DEFAULT 1;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS provider TEXT;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS provider_ref TEXT;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS provider_customer TEXT;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMPTZ;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS overrides_json TEXT;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.subscriptions FROM anon, authenticated;

-- payments
CREATE TABLE IF NOT EXISTS public.payments (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  billing_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  reference TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  plan_code TEXT,
  credit_pack TEXT,
  amount BIGINT NOT NULL DEFAULT 0,
  currency TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  raw_json TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ
);
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS billing_id TEXT;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS provider TEXT;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS reference TEXT UNIQUE;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS kind TEXT;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS plan_code TEXT;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS credit_pack TEXT;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS amount BIGINT NOT NULL DEFAULT 0;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS currency TEXT;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS raw_json TEXT;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS payments_billing ON public.payments (billing_id, created_at);
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payments FROM anon, authenticated;

-- credits
CREATE TABLE IF NOT EXISTS public.credits (
  id BIGSERIAL PRIMARY KEY,
  billing_id TEXT NOT NULL,
  max_minutes BIGINT NOT NULL,
  source TEXT NOT NULL,
  reference TEXT,
  job_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMPTZ
);
ALTER TABLE public.credits ADD COLUMN IF NOT EXISTS billing_id TEXT;
ALTER TABLE public.credits ADD COLUMN IF NOT EXISTS max_minutes BIGINT;
ALTER TABLE public.credits ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE public.credits ADD COLUMN IF NOT EXISTS reference TEXT;
ALTER TABLE public.credits ADD COLUMN IF NOT EXISTS job_id BIGINT;
ALTER TABLE public.credits ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE public.credits ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS credits_billing ON public.credits (billing_id, job_id);
ALTER TABLE public.credits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.credits FROM anon, authenticated;

-- profiles
CREATE TABLE IF NOT EXISTS public.profiles (
  user_id TEXT PRIMARY KEY,
  email TEXT,
  name TEXT,
  creator_type TEXT,
  phone TEXT,
  notify_email BOOLEAN NOT NULL DEFAULT TRUE,
  notify_whatsapp BOOLEAN NOT NULL DEFAULT FALSE,
  referral_code TEXT,
  referred_by TEXT,
  referral_rewarded BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ,
  is_admin BOOLEAN NOT NULL DEFAULT FALSE,
  disabled BOOLEAN NOT NULL DEFAULT FALSE,
  admin_notes TEXT,
  last_seen_at TIMESTAMPTZ
);
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS creator_type TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS notify_email BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS notify_whatsapp BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS referral_code TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS referred_by TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS referral_rewarded BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS disabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS admin_notes TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS profiles_referral_code ON public.profiles (referral_code);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.profiles FROM anon, authenticated;

-- voices
CREATE TABLE IF NOT EXISTS public.voices (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'elevenlabs',
  provider_voice_id TEXT NOT NULL,
  consent_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at TIMESTAMPTZ
);
ALTER TABLE public.voices ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE public.voices ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE public.voices ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'elevenlabs';
ALTER TABLE public.voices ADD COLUMN IF NOT EXISTS provider_voice_id TEXT;
ALTER TABLE public.voices ADD COLUMN IF NOT EXISTS consent_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE public.voices ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE public.voices ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ;
ALTER TABLE public.voices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.voices FROM anon, authenticated;

-- glossary_terms
CREATE TABLE IF NOT EXISTS public.glossary_terms (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  term TEXT NOT NULL,
  translation TEXT,
  target_language TEXT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE public.glossary_terms ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE public.glossary_terms ADD COLUMN IF NOT EXISTS term TEXT;
ALTER TABLE public.glossary_terms ADD COLUMN IF NOT EXISTS translation TEXT;
ALTER TABLE public.glossary_terms ADD COLUMN IF NOT EXISTS target_language TEXT;
ALTER TABLE public.glossary_terms ADD COLUMN IF NOT EXISTS note TEXT;
ALTER TABLE public.glossary_terms ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE public.glossary_terms ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.glossary_terms FROM anon, authenticated;

-- teams
CREATE TABLE IF NOT EXISTS public.teams (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS owner_id TEXT;
ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.teams FROM anon, authenticated;

-- team_members
CREATE TABLE IF NOT EXISTS public.team_members (
  id BIGSERIAL PRIMARY KEY,
  team_id BIGINT NOT NULL,
  user_id TEXT,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  status TEXT NOT NULL DEFAULT 'invited',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE public.team_members ADD COLUMN IF NOT EXISTS team_id BIGINT;
ALTER TABLE public.team_members ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE public.team_members ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE public.team_members ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'member';
ALTER TABLE public.team_members ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'invited';
ALTER TABLE public.team_members ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE UNIQUE INDEX IF NOT EXISTS team_members_email ON public.team_members (team_id, email);
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.team_members FROM anon, authenticated;

-- api_keys
CREATE TABLE IF NOT EXISTS public.api_keys (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);
ALTER TABLE public.api_keys ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE public.api_keys ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE public.api_keys ADD COLUMN IF NOT EXISTS prefix TEXT;
ALTER TABLE public.api_keys ADD COLUMN IF NOT EXISTS key_hash TEXT UNIQUE;
ALTER TABLE public.api_keys ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE public.api_keys ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ;
ALTER TABLE public.api_keys ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.api_keys FROM anon, authenticated;

-- cost_events
CREATE TABLE IF NOT EXISTS public.cost_events (
  id BIGSERIAL PRIMARY KEY,
  job_id BIGINT,
  user_id TEXT,
  provider TEXT NOT NULL,
  operation TEXT NOT NULL,
  units DOUBLE PRECISION NOT NULL DEFAULT 0,
  unit TEXT,
  cost_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE public.cost_events ADD COLUMN IF NOT EXISTS job_id BIGINT;
ALTER TABLE public.cost_events ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE public.cost_events ADD COLUMN IF NOT EXISTS provider TEXT;
ALTER TABLE public.cost_events ADD COLUMN IF NOT EXISTS operation TEXT;
ALTER TABLE public.cost_events ADD COLUMN IF NOT EXISTS units DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE public.cost_events ADD COLUMN IF NOT EXISTS unit TEXT;
ALTER TABLE public.cost_events ADD COLUMN IF NOT EXISTS cost_usd DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE public.cost_events ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS cost_events_job ON public.cost_events (job_id);
CREATE INDEX IF NOT EXISTS cost_events_created ON public.cost_events (created_at);
ALTER TABLE public.cost_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cost_events FROM anon, authenticated;

-- provider_budgets
CREATE TABLE IF NOT EXISTS public.provider_budgets (
  provider TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'usd',
  amount DOUBLE PRECISION NOT NULL DEFAULT 0,
  unit TEXT,
  period TEXT NOT NULL DEFAULT 'monthly',
  started_at TIMESTAMPTZ,
  alert_percent BIGINT NOT NULL DEFAULT 80,
  notes TEXT,
  last_alert_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
);
ALTER TABLE public.provider_budgets ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'usd';
ALTER TABLE public.provider_budgets ADD COLUMN IF NOT EXISTS amount DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE public.provider_budgets ADD COLUMN IF NOT EXISTS unit TEXT;
ALTER TABLE public.provider_budgets ADD COLUMN IF NOT EXISTS period TEXT NOT NULL DEFAULT 'monthly';
ALTER TABLE public.provider_budgets ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
ALTER TABLE public.provider_budgets ADD COLUMN IF NOT EXISTS alert_percent BIGINT NOT NULL DEFAULT 80;
ALTER TABLE public.provider_budgets ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE public.provider_budgets ADD COLUMN IF NOT EXISTS last_alert_at TIMESTAMPTZ;
ALTER TABLE public.provider_budgets ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
ALTER TABLE public.provider_budgets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.provider_budgets FROM anon, authenticated;

-- user_budgets
CREATE TABLE IF NOT EXISTS public.user_budgets (
  user_id TEXT PRIMARY KEY,
  monthly_usd_cap DOUBLE PRECISION,
  monthly_characters_cap BIGINT,
  notes TEXT,
  updated_at TIMESTAMPTZ
);
ALTER TABLE public.user_budgets ADD COLUMN IF NOT EXISTS monthly_usd_cap DOUBLE PRECISION;
ALTER TABLE public.user_budgets ADD COLUMN IF NOT EXISTS monthly_characters_cap BIGINT;
ALTER TABLE public.user_budgets ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE public.user_budgets ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
ALTER TABLE public.user_budgets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_budgets FROM anon, authenticated;

-- app_settings
CREATE TABLE IF NOT EXISTS public.app_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TIMESTAMPTZ,
  updated_by TEXT
);
ALTER TABLE public.app_settings ADD COLUMN IF NOT EXISTS value TEXT;
ALTER TABLE public.app_settings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
ALTER TABLE public.app_settings ADD COLUMN IF NOT EXISTS updated_by TEXT;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_settings FROM anon, authenticated;

-- integrations
CREATE TABLE IF NOT EXISTS public.integrations (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  data_encrypted TEXT NOT NULL,
  account_label TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ
);
ALTER TABLE public.integrations ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE public.integrations ADD COLUMN IF NOT EXISTS provider TEXT;
ALTER TABLE public.integrations ADD COLUMN IF NOT EXISTS data_encrypted TEXT;
ALTER TABLE public.integrations ADD COLUMN IF NOT EXISTS account_label TEXT;
ALTER TABLE public.integrations ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE public.integrations ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS integrations_user_provider ON public.integrations (user_id, provider);
ALTER TABLE public.integrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.integrations FROM anon, authenticated;

-- Default plans (from .docs/monetization.md). Existing plans are left untouched.
INSERT INTO public.plans (code, name, blurb, price_usd, price_ngn, videos_per_month, max_video_minutes, voice_clone, watermark, priority, max_targets, lip_sync, api_access, team_seats, saved_voices, features_json, sort, public, permissions_json, contact_sales)
  VALUES ('free', 'Free', 'Try ReelLingo on a short clip.', 0, 0, 1, 3, FALSE, TRUE, 0, 1, FALSE, FALSE, 1, 0, '{"features":["1 video per month","Up to 3 minutes per video","Standard AI voices","ReelLingo watermark","SRT & VTT subtitles"],"featured":false}', 0, TRUE, '{"multi_speaker":false,"review":true,"keep_background":true,"captions":true,"formats":false,"link_import":true,"youtube":false,"audio_only":true,"public_share":true}', FALSE)
  ON CONFLICT (code) DO NOTHING;
INSERT INTO public.plans (code, name, blurb, price_usd, price_ngn, videos_per_month, max_video_minutes, voice_clone, watermark, priority, max_targets, lip_sync, api_access, team_seats, saved_voices, features_json, sort, public, permissions_json, contact_sales)
  VALUES ('starter', 'Starter', 'For hobbyists and TikTokers.', 10, 16000, 5, 10, TRUE, FALSE, 1, 2, FALSE, FALSE, 1, 0, '{"features":["5 videos per month","Up to 10 minutes per video","Voice cloning","No watermark","2 languages per upload","Burned-in captions"],"featured":false}', 1, TRUE, '{"multi_speaker":false,"review":true,"keep_background":true,"captions":true,"formats":true,"link_import":true,"youtube":false,"audio_only":true,"public_share":true}', FALSE)
  ON CONFLICT (code) DO NOTHING;
INSERT INTO public.plans (code, name, blurb, price_usd, price_ngn, videos_per_month, max_video_minutes, voice_clone, watermark, priority, max_targets, lip_sync, api_access, team_seats, saved_voices, features_json, sort, public, permissions_json, contact_sales)
  VALUES ('creator', 'Creator', 'The sweet spot for YouTubers.', 25, 40000, 10, 25, TRUE, FALSE, 2, 4, FALSE, FALSE, 1, 1, '{"features":["10 videos per month","Up to 25 minutes per video","Premium voice cloning + saved voice","Priority processing","4 languages per upload","Multi-speaker dubbing","Publish to YouTube"],"featured":true}', 2, TRUE, '{"multi_speaker":true,"review":true,"keep_background":true,"captions":true,"formats":true,"link_import":true,"youtube":true,"audio_only":true,"public_share":true}', FALSE)
  ON CONFLICT (code) DO NOTHING;
INSERT INTO public.plans (code, name, blurb, price_usd, price_ngn, videos_per_month, max_video_minutes, voice_clone, watermark, priority, max_targets, lip_sync, api_access, team_seats, saved_voices, features_json, sort, public, permissions_json, contact_sales)
  VALUES ('studio', 'Studio', 'For media houses and Nollywood.', 80, 130000, 30, 60, TRUE, FALSE, 3, 10, TRUE, TRUE, 5, 5, '{"features":["30 videos per month","Up to 60 minutes per video","Lip-sync","Highest priority queue","10 languages per upload","Team workspace (5 seats)","API access","Dedicated WhatsApp support"],"featured":false}', 3, TRUE, '{"multi_speaker":true,"review":true,"keep_background":true,"captions":true,"formats":true,"link_import":true,"youtube":true,"audio_only":true,"public_share":true}', FALSE)
  ON CONFLICT (code) DO NOTHING;

COMMIT;
