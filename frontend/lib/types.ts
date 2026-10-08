export type JobStatus = "queued" | "processing" | "awaiting_review" | "done" | "failed";

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
  language: string;
  speaker?: string;
}

export interface DetectedLanguage {
  code: string;
  name: string;
}

export interface JobOutputFile {
  kind: "video" | "audio" | "subtitles" | "captioned" | "format" | "lipsync" | "clip";
  format: string | null;
  aspect: string | null;
  label: string;
  url: string | null;
  download_url: string | null;
  start?: number | null;
  end?: number | null;
}

export interface JobOptions {
  review: boolean;
  keep_background: boolean;
  multi_speaker: boolean;
  tone: string;
  captions: string | null;
  formats: string[];
  lip_sync: boolean;
  watermark: boolean;
  voice_id: number | null;
  trim_seconds: number | null;
  mode: "dub" | "subtitles";
  human_review: boolean;
  nigerian_voice: string | null;
}

export interface JobMetadata {
  title: string;
  description: string;
  hashtags: string[];
}

export interface Speaker {
  id: string;
  label: string;
  voice?: "clone" | "saved" | "standard" | "native";
}

export interface YoutubeState {
  status: "uploading" | "published" | "failed";
  video_id?: string;
  url?: string;
  error?: string;
  privacy?: string;
}

export interface Job {
  id: number;
  status: JobStatus;
  current_step: string;
  source_language: string;
  target_language: string;
  voice_clone: boolean;
  media_type: "video" | "audio";
  output_video_url: string | null;
  output_video_download_url: string | null;
  output_srt_url: string | null;
  output_srt_download_url: string | null;
  outputs: JobOutputFile[];
  input_video_url: string | null;
  error_message: string | null;
  original_filename: string | null;
  source_url: string | null;
  processing_note: string | null;
  created_at: string | null;
  completed_at: string | null;
  demo_mode: boolean;
  transcript: TranscriptSegment[] | null;
  translated_segments: TranscriptSegment[] | null;
  has_transcript: boolean;
  detected_languages: DetectedLanguage[];
  speakers: Speaker[] | null;
  metadata: JobMetadata | null;
  options: JobOptions;
  review_state: "pending" | "approved" | "human_pending" | null;
  minutes_charged: number | null;
  clips_pending: boolean;
  youtube_languages: YoutubeLanguageResult[];
  human_reviewed_at: string | null;
  review_note: string | null;
  redub_count: number;
  max_redubs: number;
  batch_id: string | null;
  batch?: { id: number; target_language: string; status: JobStatus }[];
  team_id: number | null;
  share_slug: string | null;
  share_url: string | null;
  youtube: YoutubeState | null;
  duration_seconds: number | null;
  files_expired: boolean;
  attempts: number;
  jobs?: Job[];
}

export interface YoutubeLanguageResult {
  video_id: string;
  title: string;
  language: string;
  localized: boolean;
  captions_id: string | null;
  notes: string[];
  added_at?: string;
}

export interface YoutubeVideo {
  id: string;
  title: string;
  thumbnail: string | null;
  published_at: string | null;
  duration_seconds: number | null;
  privacy: string | null;
  default_language: string | null;
}

export interface LanguageOption {
  code: string;
  name: string;
  region: string;
  flag: string;
  group: string;
}

export interface ApiHealth {
  status: string;
  mode: "demo" | "live";
  capabilities: {
    languages: number;
    voiceClone: boolean;
    authentication: boolean;
    multiSpeaker?: boolean;
    lipSync?: boolean;
    payments?: { paystack: boolean; stripe: boolean };
    email?: boolean;
    whatsapp?: boolean;
    youtube?: boolean;
    nativeVoices?: boolean;
    virusScan?: boolean;
    worker?: string;
  };
  settings?: PublicSettings;
}

/** Calm music offered while a video processes; the admin controls every part of it. */
export interface WaitingMusicSettings {
  enabled: boolean;
  autoplay: boolean;
  style: "calm" | "uplifting";
  volume: number;
  url: string;
}

/** The answer to "will this video get all the way through?", asked before anything is uploaded. */
export interface PreflightResult {
  ok: boolean;
  blockers: { code: string; message: string }[];
  warnings: { code: string; message: string }[];
}

export interface PublicSettings {
  maintenance: { enabled: boolean; message: string };
  waiting_music?: WaitingMusicSettings;
  signups_enabled: boolean;
  announcement: { text: string; tone: "info" | "success" | "warn" } | null;
  support: { email: string; whatsapp: string };
  features: Record<string, boolean>;
  pricing?: { weights: MinuteWeights; referral_bonus_minutes: number; referral_new_user_minutes: number };
  legal?: { company: string; address: string; privacy_email: string; terms_version: string };
}

/** How many minutes each extra uses per minute of video (dubbing itself is 1). */
export interface MinuteWeights {
  subtitles: number;
  lipSync: number;
  humanReview: number;
  clips: number;
}

/** Minutes left: the plan's monthly allowance (resets on resets_at) plus never-expiring extra minutes. */
export interface MinuteBalance {
  plan_allowance: number;
  plan_used: number;
  plan_left: number;
  topup_left: number;
  available: number;
  resets_at: string;
  period_start: string;
}

export interface MinuteLedgerEntry {
  id: number;
  delta: number;
  bucket: "plan" | "topup";
  kind: string;
  job_id: number | null;
  reference: string | null;
  note: string | null;
  created_at: string;
}

export interface Plan {
  code: string;
  name: string;
  blurb: string;
  price_usd: number;
  price_ngn: number;
  price_usd_yearly: number;
  price_ngn_yearly: number;
  minutes_per_month: number;
  max_video_minutes: number;
  voice_clone: boolean;
  watermark: boolean;
  priority: number;
  max_targets: number;
  lip_sync: boolean;
  api_access: boolean;
  team_seats: number;
  saved_voices: number;
  features: string[];
  featured: boolean;
  permissions: Record<string, boolean>;
  contact_sales: boolean;
  public: boolean;
  sort: number;
  custom?: boolean;
}

export interface CreditPack {
  code: string;
  minutes: number;
  price_usd: number;
  price_ngn: number;
}

export interface SubscriptionInfo {
  status: string;
  provider: string | null;
  billing_cycle?: "monthly" | "yearly";
  current_period_end: string | null;
  cancel_at_period_end: boolean;
}

export interface Usage {
  tier: string;
  plan: Plan;
  subscription: SubscriptionInfo | null;
  minutes: MinuteBalance;
  videos_this_month: number;
  minutes_this_month: number;
  max_video_minutes: number;
  weights: MinuteWeights;
}

export interface TeamSummary {
  id: number;
  name: string;
  role: "owner" | "admin" | "member";
  status: "active" | "invited";
}

export interface Me {
  user_id: string;
  email: string;
  name: string;
  creator_type: string;
  phone: string;
  notify_email: boolean;
  notify_whatsapp: boolean;
  referral_code: string;
  is_admin: boolean;
  plan: Usage;
  teams: TeamSummary[];
  referral: { code: string; link: string; invited: number; rewarded: number; bonus_minutes: number; new_user_minutes: number };
  channels: { email: boolean; whatsapp: boolean };
  is_reviewer: boolean;
  terms: { accepted_at: string | null; accepted_version: string | null; current_version: string };
}

export interface SessionUser {
  email: string;
  name: string;
  creatorType: string;
}

export interface GlossaryTerm {
  id: number;
  term: string;
  translation: string;
  target_language: string;
  note: string;
}

export interface SavedVoice {
  id: number;
  name: string;
  created_at: string;
  last_used_at: string | null;
}

export interface ApiKey {
  id: number;
  name: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
  key?: string;
}

export interface Payment {
  reference: string;
  provider: string;
  kind: string;
  plan_code: string | null;
  credit_pack: string | null;
  billing_cycle?: string | null;
  amount: number;
  currency: string;
  status: string;
  created_at: string;
}

export interface BillingInfo {
  tier: string;
  plan: Plan;
  subscription: SubscriptionInfo | null;
  minutes: MinuteBalance;
  usage: { videos_this_month: number; minutes_this_month: number };
  plans: Plan[];
  packs: CreditPack[];
  providers: { paystack: boolean; stripe: boolean };
  yearly: boolean;
  weights: MinuteWeights;
  /** Paystack plan codes are set, so card payments for a plan can renew automatically. */
  paystack_auto_renew?: boolean;
  /** Plan keys with a Paystack plan code, e.g. "creator" or "creator_yearly". */
  paystack_auto_renew_plans?: string[];
  payments: Payment[];
  workspace: { team_id: number; role: string } | null;
}

export interface TeamMember {
  id: number;
  user_id: string | null;
  email: string;
  role: "owner" | "admin" | "member";
  status: "active" | "invited";
}

export interface TeamDetail {
  id: number;
  name: string;
  owner_id: string;
  role: "owner" | "admin" | "member";
  members: TeamMember[];
  plan: Plan;
  seats: number;
}

export interface WatchData {
  slug: string;
  title: string;
  description: string;
  hashtags: string[];
  media_type: "video" | "audio";
  source_language: string;
  target_language: string;
  video_url: string | null;
  original_url: string | null;
  captions_url: string | null;
  duration_seconds: number | null;
  created_at: string | null;
  watermark: boolean;
  signup_url: string;
}

export interface CreateJobOptions {
  sourceLanguage: string;
  targetLanguages: string[];
  voiceMode: "clone" | "saved" | "standard";
  voiceId?: number | null;
  review: boolean;
  keepBackground: boolean;
  multiSpeaker: boolean;
  tone: string;
  captions: string | null;
  formats: string[];
  lipSync: boolean;
  trimToFit?: boolean;
  mode: "dub" | "subtitles";
  humanReview: boolean;
  nigerianVoice?: string | null;
  rightsConfirmed: boolean;
  voiceConsent: boolean;
}

export interface ReviewTask {
  id: number;
  job_id: number;
  language: string;
  language_name: string;
  status: "open" | "claimed" | "submitted" | "paid" | "expired";
  reviewer_id: string | null;
  minutes: number;
  payout_ngn: number;
  claimed_at: string | null;
  submitted_at: string | null;
  paid_at: string | null;
  notes: string | null;
  created_at: string | null;
  job: { id: number; source_language: string; target_language: string; duration_seconds: number | null; original_filename: string | null; lines: number } | null;
}

export interface ReviewerHome {
  reviewer: { user_id: string; email: string; name: string; languages: string[] };
  open: ReviewTask[];
  mine: ReviewTask[];
  earnings: { owed_ngn: number; paid_ngn: number; reviews: number; rate_ngn_per_minute: number };
}

