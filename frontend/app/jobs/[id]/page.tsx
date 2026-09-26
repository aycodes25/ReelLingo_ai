"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, CircleAlert, Film } from "lucide-react";
import Link from "next/link";
import AppHeader from "@/components/AppHeader";
import StatusTimeline from "@/components/StatusTimeline";
import TranscriptReview from "@/components/TranscriptReview";
import { getJob } from "@/lib/api";
import type { Job } from "@/lib/types";

export default function JobStatusPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [job, setJob] = useState<Job | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const jobId = Number(params.id);
    let active = true;
    let interval: ReturnType<typeof setInterval>;
    const refresh = async () => {
      try {
        const updated = await getJob(jobId);
        if (!active) return;
        setJob(updated);
        if (updated.status === "done") router.replace(`/result/${jobId}`);
        if (updated.status === "failed") setErrorMessage(updated.error_message || "This translation could not be completed.");
      } catch (error) {
        if (active) setErrorMessage(error instanceof Error ? error.message : "Could not load job status.");
      }
    };
    void refresh();
    interval = setInterval(() => { void refresh(); }, 3000);
    return () => { active = false; clearInterval(interval); };
  }, [params.id, router]);

  return (
    <div className="app-shell">
      <AppHeader active="studio" />
      <main className="processing-main">
        <Link href="/dashboard" className="back-link"><ArrowLeft size={15} /> Back to studio</Link>
        <section className="processing-heading">
          <span className="processing-icon"><Film size={22} /></span>
          <p className="eyebrow">PROJECT {params.id}</p>
          <h1>{job?.status === "failed" ? "We hit a pause." : "Your video is on its way."}</h1>
          <p>{job ? `${job.source_language === "auto" && job.detected_languages.length ? job.detected_languages.map((language) => language.name).join(" + ") : job.source_language.toUpperCase()} → ${job.target_language.toUpperCase()}` : "Checking your project…"}</p>
        </section>
        {errorMessage ? (
          <div className="notice notice-error"><CircleAlert size={18} /><span>{errorMessage}</span></div>
        ) : job ? (
          <>
            <section className="processing-progress">
              <div className="progress-caption"><span>{job.current_step.replaceAll("_", " ")}</span><span className="live-dot" /></div>
              <StatusTimeline currentStep={job.current_step} />
            </section>
            <TranscriptReview job={job} />
          </>
        ) : <div className="loading-line">Loading project status…</div>}
      </main>
    </div>
  );
}
