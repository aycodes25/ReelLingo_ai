import type { Job, LanguageOption, TranscriptSegment } from "./types";

export function languageName(languages: LanguageOption[], code: string): string {
  if (code === "auto") return "Auto-detect";
  return languages.find((language) => language.code === code)?.name || code.toUpperCase();
}

export function sourceLabel(job: Job, languages: LanguageOption[]): string {
  if (job.source_language === "auto" && job.detected_languages.length) {
    return job.detected_languages.map((language) => language.name).join(" + ");
  }
  return languageName(languages, job.source_language);
}

export function projectFileName(job: Job): string {
  return job.original_filename || `Project_${job.id}.mp4`;
}

export function projectTitle(job: Job): string {
  if (!job.original_filename) return `Project #${job.id}`;
  return job.original_filename.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || `Project #${job.id}`;
}

export function relativeTime(iso: string | null): string {
  if (!iso) return "Just now";
  const seconds = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (!Number.isFinite(seconds) || seconds < 60) return "Just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function clock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds || 0));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function timestamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds || 0));
  const hours = Math.floor(total / 3600);
  return `${String(hours).padStart(2, "0")}:${clock(total % 3600)}`;
}

export const PIPELINE_STAGES = [
  { key: "upload", label: "Upload", steps: ["queued", "importing", "extracting_audio"] },
  { key: "transcription", label: "Transcription", steps: ["transcribing", "detecting_languages"] },
  { key: "translation", label: "Translation", steps: ["translating", "human_review", "review"] },
  { key: "dubbing", label: "Dubbing", steps: ["separating", "dubbing", "mixing"] },
  { key: "merge", label: "Merge", steps: ["merging"] },
  { key: "subtitle", label: "Export", steps: ["generating_subtitles", "rendering", "lip_syncing", "choosing_clips", "rendering_clips"] },
  { key: "download", label: "Download", steps: ["done"] },
] as const;

export function stageIndex(step: string): number {
  const index = PIPELINE_STAGES.findIndex((stage) => (stage.steps as readonly string[]).includes(step));
  return index === -1 ? 0 : index;
}

export function progressPercent(job: Job): number {
  if (job.status === "done") return 100;
  // Each finished stage counts fully and the active one counts as half done.
  return Math.round(((stageIndex(job.current_step) + 0.5) / PIPELINE_STAGES.length) * 100);
}

export const STEP_MESSAGES: Record<string, string> = {
  queued: "Video received and queued for processing.",
  importing: "Downloading your video from the link.",
  extracting_audio: "Extracting the audio track from your video.",
  transcribing: "Transcribing speech with timestamps.",
  detecting_languages: "Identifying the spoken languages.",
  translating: "Translating each segment with cultural context.",
  review: "Translation ready for your review.",
  separating: "Separating background music and effects from the voices.",
  dubbing: "Generating the dubbed voice track.",
  mixing: "Mixing the dub over the original background audio.",
  merging: "Replacing the original speech with the dub.",
  generating_subtitles: "Writing synchronized subtitles.",
  rendering: "Rendering captioned and resized versions.",
  lip_syncing: "Matching lip movements to the new audio.",
  done: "Localization complete. Your files are ready.",
};

export function formatMoney(amount: number, currency: "USD" | "NGN" | string): string {
  try {
    return new Intl.NumberFormat(currency === "NGN" ? "en-NG" : "en-US", { style: "currency", currency, maximumFractionDigits: currency === "NGN" ? 0 : 2 }).format(amount);
  } catch {
    return `${currency} ${amount}`;
  }
}

export function isInFlight(job: Job): boolean {
  return job.status === "queued" || job.status === "processing";
}

export function segmentsToText(segments: TranscriptSegment[]): string {
  return segments.map((segment) => `[${timestamp(segment.start)}] ${segment.text}`).join("\n");
}

export function segmentsToVtt(segments: TranscriptSegment[]): string {
  const cue = (seconds: number) => {
    const millis = Math.round((seconds % 1) * 1000);
    return `${timestamp(seconds)}.${String(millis).padStart(3, "0")}`;
  };
  return `WEBVTT\n\n${segments.map((segment, index) => `${index + 1}\n${cue(segment.start)} --> ${cue(segment.end)}\n${segment.text}`).join("\n\n")}\n`;
}

export function downloadText(fileName: string, contents: string, type: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

/** "12.5 min", "1 min", "0 min" */
export function formatMinutes(value: number | null | undefined): string {
  const rounded = Math.round(Number(value || 0) * 10) / 10;
  return `${rounded.toLocaleString(undefined, { maximumFractionDigits: 1 })} min`;
}

/**
 * Minutes a new project will use: video length × languages, weighted for subtitles-only and the paid extras.
 * Mirrors backend/src/minutes.js (each language is rounded up to the next 0.1 minute).
 */
export function estimateMinutes(seconds: number, languages: number, weights: { subtitles: number; lipSync: number; humanReview: number }, options: { mode: "dub" | "subtitles"; lipSync: boolean; humanReview: boolean }): number {
  const minutes = Math.max(0, seconds) / 60;
  if (!minutes) return 0;
  let perLanguage = minutes * (options.mode === "subtitles" ? weights.subtitles : 1);
  if (options.lipSync && options.mode !== "subtitles") perLanguage += minutes * weights.lipSync;
  if (options.humanReview) perLanguage += minutes * weights.humanReview;
  const rounded = Math.max(0.1, Math.ceil(perLanguage * 10 - 1e-9) / 10);
  return Math.round(rounded * Math.max(1, languages) * 10) / 10;
}
