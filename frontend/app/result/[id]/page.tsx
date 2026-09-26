"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowDownToLine, ArrowLeft, ArrowRight, AudioLines, Captions, CircleAlert, Clapperboard } from "lucide-react";
import AppHeader from "@/components/AppHeader";
import TranscriptReview from "@/components/TranscriptReview";
import { getJob } from "@/lib/api";
import type { Job } from "@/lib/types";

export default function ResultPage() {
  const params = useParams<{ id: string }>();
  const [job, setJob] = useState<Job | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    getJob(Number(params.id)).then(setJob).catch((error: unknown) => {
      setErrorMessage(error instanceof Error ? error.message : "Could not load this project.");
    });
  }, [params.id]);

  return (
    <div className="app-shell">
      <AppHeader active="studio" />
      <main className="result-main">
        <Link href="/dashboard" className="back-link"><ArrowLeft size={15} /> Back to studio</Link>
        {errorMessage ? <div className="notice notice-error"><CircleAlert size={18} /><span>{errorMessage}</span></div> : !job ? <div className="loading-line">Loading your video…</div> : job.status === "failed" ? (
          <section className="result-error"><span className="processing-icon"><CircleAlert size={22} /></span><p className="eyebrow">PROJECT {job.id}</p><h1>This dub needs another take.</h1><p>{job.error_message || "The translation could not be completed."}</p><Link className="primary-action" href="/dashboard">Start a new translation <ArrowRight size={16} /></Link></section>
        ) : job.status !== "done" ? (
          <section className="result-wait"><span className="processing-icon"><AudioLines size={22} /></span><h1>This video is still in progress.</h1><p>We’re working through the translation now.</p><Link href={`/jobs/${job.id}`} className="secondary-action">View processing status <ArrowRight size={15} /></Link></section>
        ) : (
          <>
            <section className="result-heading">
              <div><p className="eyebrow"><span className="eyebrow-dot" /> PROJECT {job.id} · READY</p><h1>Your story, <span>revoiced.</span></h1><p>{job.source_language === "auto" && job.detected_languages.length ? job.detected_languages.map((language) => language.name).join(" + ") : job.source_language.toUpperCase()} <span className="result-arrow">→</span> {job.target_language.toUpperCase()}</p></div>
              <Link href="/dashboard" className="secondary-action"><Clapperboard size={16} /> New translation</Link>
            </section>
            {job.demo_mode && <div className="notice notice-demo"><CircleAlert size={18} /><span><strong>Demo output.</strong> The audio track is a test tone, not spoken translated audio. Add an OpenAI API key to generate a real dub.</span></div>}
            <div className="result-grid">
              <section className="video-stage">
                {job.output_video_url ? <video src={job.output_video_url} controls playsInline preload="metadata" /> : <div className="video-unavailable"><Clapperboard size={28} /><span>Video preview is unavailable.</span></div>}
                <div className="video-caption"><AudioLines size={16} /><span>Translated audio track</span><span className="audio-status"><i /> {job.demo_mode ? "Demo" : "Ready"}</span></div>
              </section>
              <aside className="download-panel">
                <p className="eyebrow">YOUR EXPORTS</p>
                <h2>Ready to share.</h2>
                <p>Download your dubbed video and translated captions.</p>
                {job.output_video_download_url && <a href={job.output_video_download_url} download className="primary-action"><ArrowDownToLine size={17} /> Download video</a>}
                {job.output_srt_download_url && <a href={job.output_srt_download_url} download className="secondary-action"><Captions size={17} /> Subtitles (.srt)</a>}
                <div className="export-note">MP4 video <span>·</span> SRT captions</div>
              </aside>
            </div>
            <TranscriptReview job={job} />
          </>
        )}
      </main>
    </div>
  );
}
