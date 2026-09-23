export type JobStatus = "queued" | "processing" | "done" | "failed";

export interface Job {
  id: number;
  status: JobStatus;
  current_step: string;
  source_language: string;
  target_language: string;
  voice_clone: boolean;
  output_video_url: string | null;
  output_srt_url: string | null;
  error_message: string | null;
}
