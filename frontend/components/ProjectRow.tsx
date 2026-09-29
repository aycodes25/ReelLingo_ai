import Link from "next/link";
import { Clock3, Download, Ellipsis, ExternalLink, FileVideo, Globe } from "lucide-react";
import { progressPercent, projectFileName, relativeTime, sourceLabel, languageName } from "@/lib/format";
import type { Job, LanguageOption } from "@/lib/types";

const STATUS_LABEL: Record<Job["status"], string> = { done: "Completed", processing: "Processing", queued: "Queued", failed: "Failed" };

export function projectHref(job: Job) {
  return job.status === "done" ? `/result/${job.id}` : `/jobs/${job.id}`;
}

export default function ProjectRow({ job, languages }: { job: Job; languages: LanguageOption[] }) {
  const percent = progressPercent(job);
  const inFlight = job.status === "processing" || job.status === "queued";

  return (
    <li className="project-row">
      <span className={`project-thumb ${job.status === "done" ? "is-done" : ""}`}><FileVideo size={22} strokeWidth={1.8} /></span>
      <div className="project-info">
        <div className="project-name">
          <Link href={projectHref(job)}>{projectFileName(job)}</Link>
          <span className={`badge badge-${job.status}`}>{STATUS_LABEL[job.status]}</span>
        </div>
        <div className="project-meta">
          <span><Globe size={13} />{sourceLabel(job, languages)} → {languageName(languages, job.target_language)}</span>
          <i className="sep" />
          <span><Clock3 size={13} />{relativeTime(job.created_at)}</span>
        </div>
      </div>
      <div className="project-actions">
        {job.status === "done" && <Link href={projectHref(job)} className="btn btn-outline btn-sm">View Result</Link>}
        {inFlight && (
          <div className="row-progress" aria-label={`Progress ${percent}%`}>
            <div><span>PROGRESS</span><span>{percent}%</span></div>
            <div className="split-bar"><i style={{ width: `${percent}%` }} /></div>
          </div>
        )}
        {job.status === "failed" && <Link href="/dashboard#new-project" className="retry-link">Retry</Link>}
        <details className="row-menu">
          <summary className="icon-btn" aria-label={`More actions for ${projectFileName(job)}`}><Ellipsis size={20} /></summary>
          <div className="row-menu-list">
            <Link href={projectHref(job)}><ExternalLink size={15} />{job.status === "done" ? "Open result" : "View progress"}</Link>
            {job.output_video_download_url && <a href={job.output_video_download_url} download><Download size={15} />Download video</a>}
            {job.output_srt_download_url && <a href={job.output_srt_download_url} download><Download size={15} />Download subtitles</a>}
          </div>
        </details>
      </div>
    </li>
  );
}
