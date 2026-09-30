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
  kind: "video" | "audio" | "subtitles" | "captioned" | "format" | "lipsync";
  format: string | null;
  aspect: string | null;
  label: string;
  url: string | null;
  download_url: string | null;
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
}

export interface JobMetadata {
  title: string;
  description: string;
  hashtags: string[];
}

export interface Speaker {
  id: string;
  label: string;
  voice?: "clone" | "saved" | "standard";
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
  review_state: "pending" | "approved" | null;
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
    virusScan?: boolean;
    worker?: string;
  };
}

export interface Plan {
  code: string;
  name: string;
  blurb: string;
  price_usd: number;
  price_ngn: number;
  videos_per_month: number;
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
}

export interface CreditPack {
  code: string;
  minutes: number;
  price_usd: number;
  price_ngn: number;
}

export interface Credit {
  id: number;
  max_minutes: number;
  source: string;
}

export interface SubscriptionInfo {
  status: string;
  provider: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
}

export interface Usage {
  tier: string;
  plan: Plan;
  subscription: SubscriptionInfo | null;
  videos_this_month: number;
  minutes_this_month: number;
  max_videos_per_month: number;
  max_video_minutes: number;
  credits: Credit[];
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
  referral: { code: string; link: string; invited: number; rewarded: number; bonus_minutes: number; bonus_videos: number };
  channels: { email: boolean; whatsapp: boolean };
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
  amount: number;
  currency: string;
  status: string;
  created_at: string;
}

export interface BillingInfo {
  tier: string;
  plan: Plan;
  subscription: SubscriptionInfo | null;
  credits: Credit[];
  usage: { videos_this_month: number; max_videos_per_month: number; minutes_this_month: number };
  plans: Plan[];
  packs: CreditPack[];
  providers: { paystack: boolean; stripe: boolean };
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

export interface AdminOverview {
  days: number;
  jobs: { total: number; by_status: Record<string, number>; failure_rate: number; minutes_processed: number };
  processing_seconds: { median: number; p90: number } | null;
  top_errors: { message: string; count: number }[];
  top_users: { user_id: string; jobs: number }[];
  costs: { total_usd: number; per_done_job_usd: number | null; per_minute_usd: number | null; by_operation: { provider: string; operation: string; cost_usd: number; calls: number }[] };
  revenue: { estimated_usd: number; by_currency: { currency: string; amount: number; count: number }[]; margin_usd: number; ngn_per_usd: number };
}

export interface AdminJob extends Job {
  user_id: string;
  deleted: boolean;
  costs: { total_usd: number; items: { provider: string; operation: string; units: number; unit: string; cost_usd: number }[] };
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
}
