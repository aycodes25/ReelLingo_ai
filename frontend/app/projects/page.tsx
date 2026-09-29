"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, Search, Video } from "lucide-react";
import AppShell from "@/components/AppShell";
import ProjectRow from "@/components/ProjectRow";
import { ApiError, clearStoredToken, getJobs, getLanguages, getStoredToken } from "@/lib/api";
import { languageName, projectFileName, sourceLabel } from "@/lib/format";
import type { Job, JobStatus, LanguageOption } from "@/lib/types";

const FILTERS: { value: JobStatus | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "done", label: "Completed" },
  { value: "processing", label: "Processing" },
  { value: "failed", label: "Failed" },
];

export default function ProjectsPage() {
  const router = useRouter();
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [languages, setLanguages] = useState<LanguageOption[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<JobStatus | "all">("all");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    setQuery(new URLSearchParams(window.location.search).get("q") || "");
  }, []);

  useEffect(() => {
    if (!getStoredToken()) return;
    getLanguages().then(setLanguages).catch(() => undefined);
    getJobs(100).then(setJobs).catch((error: unknown) => {
      if (error instanceof ApiError && error.status === 401) {
        clearStoredToken();
        router.replace("/login");
        return;
      }
      setJobs([]);
      setErrorMessage(error instanceof Error ? error.message : "Could not load projects.");
    });
  }, [router]);

  const needle = query.trim().toLowerCase();
  const visible = (jobs || []).filter((job) => {
    const statusMatches = filter === "all" || job.status === filter || (filter === "processing" && job.status === "queued");
    const text = `${projectFileName(job)} ${sourceLabel(job, languages)} ${languageName(languages, job.target_language)}`.toLowerCase();
    return statusMatches && (!needle || text.includes(needle));
  });

  return (
    <AppShell crumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Projects" }]}>
      <div className="page-head">
        <div>
          <h1>Projects</h1>
          <p>Every translation you&apos;ve started, newest first.</p>
        </div>
        <Link href="/dashboard#new-project" className="btn btn-primary"><Plus size={17} />New Project</Link>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", marginBottom: 20 }}>
        <div className="search" style={{ display: "block", width: 320, maxWidth: "100%" }}>
          <Search size={16} />
          <input type="search" placeholder="Search by file or language…" aria-label="Filter projects" value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
        <div style={{ display: "flex", gap: 8 }} role="group" aria-label="Filter by status">
          {FILTERS.map((item) => (
            <button key={item.value} type="button" className={`btn btn-sm ${filter === item.value ? "btn-primary" : "btn-outline"}`} aria-pressed={filter === item.value} onClick={() => setFilter(item.value)}>{item.label}</button>
          ))}
        </div>
      </div>

      {errorMessage && <p role="alert" className="form-error" style={{ marginBottom: 16 }}>{errorMessage}</p>}
      {jobs === null ? (
        <div className="project-list">{[0, 1, 2, 3].map((key) => <div key={key} className="skeleton" style={{ height: 82 }} />)}</div>
      ) : visible.length ? (
        <ul className="project-list">{visible.map((job) => <ProjectRow key={job.id} job={job} languages={languages} />)}</ul>
      ) : (
        <div className="empty-state">
          <span><Video size={24} /></span>
          <strong>{jobs.length ? "No projects match" : "No projects yet"}</strong>
          {jobs.length ? "Try a different search or status filter." : <Link href="/dashboard#new-project" className="link">Upload your first video</Link>}
        </div>
      )}
    </AppShell>
  );
}
