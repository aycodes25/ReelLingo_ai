"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, FileText } from "lucide-react";
import AppShell from "@/components/AppShell";
import { getJobs, getLanguages, getStoredToken } from "@/lib/api";
import { downloadText, languageName, projectFileName, relativeTime, segmentsToText, sourceLabel, timestamp } from "@/lib/format";
import type { Job, LanguageOption } from "@/lib/types";

export default function TranscriptsPage() {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [languages, setLanguages] = useState<LanguageOption[]>([]);

  useEffect(() => {
    if (!getStoredToken()) return;
    getLanguages().then(setLanguages).catch(() => undefined);
    getJobs(100).then((items) => setJobs(items.filter((job) => job.transcript?.length))).catch(() => setJobs([]));
  }, []);

  return (
    <AppShell crumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Transcripts" }]}>
      <div className="page-head">
        <div>
          <h1>Transcripts</h1>
          <p>Timestamped transcripts and translations from your videos.</p>
        </div>
      </div>

      {jobs === null ? (
        <div className="project-list">{[0, 1].map((key) => <div key={key} className="skeleton" style={{ height: 180 }} />)}</div>
      ) : jobs.length ? (
        <div style={{ display: "grid", gap: 20 }}>
          {jobs.map((job) => {
            const translations = new Map((job.translated_segments || []).map((segment) => [`${segment.start}:${segment.end}`, segment.text]));
            const preview = (job.transcript || []).slice(0, 3);
            return (
              <section key={job.id} className="card transcript-card">
                <div className="transcript-head">
                  <div>
                    <h2><FileText size={19} />{projectFileName(job)}</h2>
                    <p className="card-sub">{sourceLabel(job, languages)} → {languageName(languages, job.target_language)} · {job.transcript?.length} segments · {relativeTime(job.created_at)}</p>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {job.translated_segments?.length ? (
                      <button type="button" className="btn btn-outline btn-sm" style={{ color: "var(--ink)" }} onClick={() => downloadText(`${projectFileName(job).replace(/\.[^.]+$/, "")}.${job.target_language}.txt`, segmentsToText(job.translated_segments || []), "text/plain")}>Download .txt</button>
                    ) : null}
                    <Link href={job.status === "done" ? `/result/${job.id}` : `/jobs/${job.id}`} className="btn btn-primary btn-sm">Open <ArrowRight size={15} /></Link>
                  </div>
                </div>
                <ol className="transcript-lines">
                  {preview.map((segment, index) => (
                    <li key={`${segment.start}-${index}`}>
                      <div style={{ display: "grid", gridTemplateColumns: "80px 1fr", gap: 8, padding: "12px", fontSize: 14 }}>
                        <time>{timestamp(segment.start)}</time>
                        <span style={{ color: "var(--ink)" }}>{translations.get(`${segment.start}:${segment.end}`) || segment.text}<small>{segment.text}</small></span>
                      </div>
                    </li>
                  ))}
                </ol>
              </section>
            );
          })}
        </div>
      ) : (
        <div className="empty-state">
          <span><FileText size={24} /></span>
          <strong>No transcripts yet</strong>
          Transcripts appear here once a video has been transcribed.
          <Link href="/dashboard#new-project" className="link">Start a project</Link>
        </div>
      )}
    </AppShell>
  );
}
