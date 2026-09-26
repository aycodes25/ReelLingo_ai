export type JobStatus = "queued" | "processing" | "done" | "failed";

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
  language: string;
}

export interface DetectedLanguage {
  code: string;
  name: string;
}

export interface Job {
  id: number;
  status: JobStatus;
  current_step: string;
  source_language: string;
  target_language: string;
  voice_clone: boolean;
  output_video_url: string | null;
  output_video_download_url: string | null;
  output_srt_url: string | null;
  output_srt_download_url: string | null;
  error_message: string | null;
  demo_mode: boolean;
  transcript: TranscriptSegment[] | null;
  translated_segments: TranscriptSegment[] | null;
  detected_languages: DetectedLanguage[];
  duration_seconds: number | null;
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
  capabilities: { languages: number; voiceClone: boolean; authentication: boolean };
}
