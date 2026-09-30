"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Clock3, Download, Ellipsis, ExternalLink, FileAudio, FileVideo, Globe, PencilLine, RotateCcw, Trash2 } from "lucide-react";
import { deleteJob, retryJob } from "@/lib/api";
import { isInFlight, progressPercent, projectFileName, relativeTime, sourceLabel, languageName } from "@/lib/format";
import type { Job, LanguageOption } from "@/lib/types";

const STATUS_LABEL: Record<Job["status"], string> = {
  done: "Completed", processing: "Processing", queued: "Queued", failed: "Failed", awaiting_review: "Needs review",
};

export function projectHref(job: Job) {
  if (job.status === "done") return `/result/${job.id}`;
  if (job.status === "awaiting_review") return `/jobs/${job.id}/edit`;
  return `/jobs/${job.id}`;
}

export default function ProjectRow({ job, languages, onRemoved }: { job: Job; languages: LanguageOption[]; onRemoved?: (id: number) => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const percent = progressPercent(job);
  const inFlight = isInFlight(job);
  const Icon = job.media_type === "audio" ? FileAudio : FileVideo;

  async function handleRetry() {
    setBusy(true);
    setError(null);
    try {
      await retryJob(job.id);
      router.push(`/jobs/${job.id}`);
    } catch (retryError) {
      setError(retryError instanceof Error ? retryError.message : "Retry failed");
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm(`Delete "${projectFileName(job)}"? Its video, audio and subtitle files are removed permanently.`)) return;
    setBusy(true);
    setError(null);
    try {
      await deleteJob(job.id);
      onRemoved?.(job.id);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="project-row">
      <span className={`project-thumb ${job.status === "done" ? "is-done" : ""}`}><Icon size={22} strokeWidth={1.8} /></span>
      <div className="project-info">
        <div className="project-name">
          <Link href={projectHref(job)}>{projectFileName(job)}</Link>
          <span className={`badge badge-${job.status}`}>{STATUS_LABEL[job.status]}</span>
          {job.files_expired && <span className="badge badge-soft">Files expired</span>}
        </div>
        <div className="project-meta">
          <span><Globe size={13} />{sourceLabel(job, languages)} → {languageName(languages, job.target_language)}</span>
          <i className="sep" />
          <span><Clock3 size={13} />{relativeTime(job.created_at)}</span>
        </div>
        {error && <p role="alert" className="form-error" style={{ marginTop: 6 }}>{error}</p>}
      </div>
      <div className="project-actions">
        {job.status === "done" && <Link href={projectHref(job)} className="btn btn-outline btn-sm">View Result</Link>}
        {job.status === "awaiting_review" && <Link href={projectHref(job)} className="btn btn-primary btn-sm"><PencilLine size={15} />Review</Link>}
        {inFlight && (
          <div className="row-progress" aria-label={`Progress ${percent}%`}>
            <div><span>PROGRESS</span><span>{percent}%</span></div>
            <div className="split-bar"><i style={{ width: `${percent}%` }} /></div>
          </div>
        )}
        {job.status === "failed" && !job.files_expired && <button type="button" className="retry-link" onClick={handleRetry} disabled={busy}><RotateCcw size={14} />Retry</button>}
        <details className="row-menu">
          <summary className="icon-btn" aria-label={`More actions for ${projectFileName(job)}`}><Ellipsis size={20} /></summary>
          <div className="row-menu-list">
            <Link href={projectHref(job)}><ExternalLink size={15} />{job.status === "done" ? "Open result" : job.status === "awaiting_review" ? "Review translation" : "View progress"}</Link>
            {job.output_video_download_url && <a href={job.output_video_download_url} download><Download size={15} />Download {job.media_type === "audio" ? "audio" : "video"}</a>}
            {job.output_srt_download_url && <a href={job.output_srt_download_url} download><Download size={15} />Download subtitles</a>}
            {job.status !== "processing" && <button type="button" className="is-danger" onClick={handleDelete} disabled={busy}><Trash2 size={15} />Delete project</button>}
          </div>
        </details>
      </div>
    </li>
  );
}
