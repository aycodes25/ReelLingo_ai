"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowRight, AudioLines, ChevronRight, CircleAlert, CircleCheck, Copy, Download, Facebook, FileText, FileVideo, ImageIcon, Languages, Linkedin,
  LoaderCircle, Mail, RotateCcw, Share2, Sparkles, Twitter, Volume2,
} from "lucide-react";
import AppShell from "@/components/AppShell";
import VideoPlayer, { type VideoPlayerHandle } from "@/components/VideoPlayer";
import { getJob, getJobs, getLanguages } from "@/lib/api";
import {
  clock, downloadText, languageName, projectFileName, projectTitle, relativeTime, segmentsToText, segmentsToVtt, sourceLabel, timestamp,
} from "@/lib/format";
import type { Job, LanguageOption } from "@/lib/types";

const PREVIEW_LINES = 3;

export default function ResultPage() {
  const params = useParams<{ id: string }>();
  const [job, setJob] = useState<Job | null>(null);
  const [recent, setRecent] = useState<Job[]>([]);
  const [languages, setLanguages] = useState<LanguageOption[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [time, setTime] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const [copied, setCopied] = useState(false);
  const playerRef = useRef<VideoPlayerHandle>(null);

  useEffect(() => {
    const jobId = Number(params.id);
    getJob(jobId).then(setJob).catch((error: unknown) => {
      setErrorMessage(error instanceof Error ? error.message : "Could not load this project.");
    });
    getLanguages().then(setLanguages).catch(() => undefined);
    getJobs(12).then((items) => setRecent(items.filter((item) => item.id !== jobId && item.status === "done").slice(0, 3))).catch(() => undefined);
  }, [params.id]);

  const segments = useMemo(() => {
    if (!job?.transcript?.length) return [];
    const translations = new Map((job.translated_segments || []).map((segment) => [`${segment.start}:${segment.end}`, segment.text]));
    return job.transcript.map((segment) => ({ ...segment, original: segment.text, text: translations.get(`${segment.start}:${segment.end}`) || segment.text }));
  }, [job]);

  const activeIndex = segments.findIndex((segment) => time >= segment.start && time < segment.end);
  const crumbs = [{ label: "Dashboard", href: "/dashboard" }, { label: "Projects", href: "/projects" }, { label: job ? projectFileName(job) : `Project #${params.id}` }];

  if (errorMessage || !job || job.status !== "done") {
    return (
      <AppShell crumbs={crumbs}>
        {errorMessage ? (
          <section className="center-state is-error"><span><CircleAlert size={28} /></span><h1>We couldn&apos;t load this project</h1><p>{errorMessage}</p><Link href="/dashboard" className="btn btn-primary">Back to Dashboard</Link></section>
        ) : !job ? (
          <section className="center-state"><span><LoaderCircle size={28} className="spin" /></span><h1>Loading your video…</h1></section>
        ) : job.status === "failed" ? (
          <section className="center-state is-error"><span><CircleAlert size={28} /></span><h1>This dub needs another take</h1><p>{job.error_message || "The translation could not be completed."}</p><Link className="btn btn-primary" href="/dashboard#new-project">Start a new translation <ArrowRight size={16} /></Link></section>
        ) : (
          <section className="center-state"><span><AudioLines size={28} /></span><h1>This video is still in progress</h1><p>We&apos;re working through the translation now.</p><Link href={`/jobs/${job.id}`} className="btn btn-primary">View processing status <ArrowRight size={16} /></Link></section>
        )}
      </AppShell>
    );
  }

  const target = languageName(languages, job.target_language);
  const baseName = projectFileName(job).replace(/\.[^.]+$/, "");
  const translatedSegments = segments.map(({ start, end, text, language }) => ({ start, end, text, language }));
  const shareUrl = job.output_video_url || "";
  const visible = showAll ? segments : segments.slice(Math.max(0, Math.min(activeIndex, segments.length - PREVIEW_LINES)), Math.max(0, Math.min(activeIndex, segments.length - PREVIEW_LINES)) + PREVIEW_LINES);
  const shareText = encodeURIComponent(`Watch "${projectTitle(job)}" in ${target}, dubbed with ReelLingo`);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  async function shareVideo() {
    if (navigator.share) {
      await navigator.share({ title: projectTitle(job!), text: decodeURIComponent(shareText), url: shareUrl }).catch(() => undefined);
    } else {
      await copyLink();
    }
  }

  return (
    <AppShell crumbs={crumbs}>
      <div className="page-head" style={{ alignItems: "flex-end" }}>
        <div>
          <div className="ready-line">
            <span className="ready-chip"><CircleCheck size={13} />Translation Ready</span>
            <span>{job.duration_seconds ? `${clock(job.duration_seconds)} video` : "Dubbed video"} · Created {relativeTime(job.created_at).toLowerCase()}</span>
          </div>
          <h1 className="result-title">{projectTitle(job)}</h1>
          <div className="lang-path">
            <span>{sourceLabel(job, languages)}</span><ChevronRight size={16} /><span className="to">{target}</span>
            <i className="sep" />
            <span className="voice"><Volume2 size={16} />{job.voice_clone ? "AI Voice Clone (Speaker Match)" : "AI Voice (Standard)"}</span>
          </div>
        </div>
        <div className="page-head-actions">
          <Link href="/dashboard#new-project" className="btn btn-outline"><RotateCcw size={16} />Translate Another</Link>
          <button type="button" className="btn btn-primary" onClick={shareVideo} disabled={!shareUrl}><Share2 size={16} />Share Video</button>
        </div>
      </div>

      {job.demo_mode && (
        <div className="alert alert-warn" style={{ marginBottom: 24 }}><CircleAlert size={16} /><span><strong>Demo output.</strong> The audio track is a test tone, not spoken translated audio. Add an OpenAI API key to generate a real dub.</span></div>
      )}
      {job.processing_note && (
        <div className="alert alert-warn" style={{ marginBottom: 24 }}><CircleAlert size={16} /><span><strong>Voice note.</strong> {job.processing_note}</span></div>
      )}

      <div className="result-grid">
        <div className="result-main-col">
          <VideoPlayer ref={playerRef} src={job.output_video_url} label={`Dubbed · ${target}`} onTimeChange={setTime} />

          {segments.length > 0 && (
            <section className="card transcript-card" aria-labelledby="transcript-title">
              <div className="transcript-head">
                <h2 id="transcript-title"><FileText size={19} />Transcript Preview ({target})</h2>
                <button type="button" onClick={() => setShowAll(!showAll)} aria-expanded={showAll}>{showAll ? "Show preview" : `View full transcript (${segments.length})`}</button>
              </div>
              <ol className="transcript-lines">
                {visible.map((segment) => {
                  const index = segments.indexOf(segment);
                  return (
                    <li key={`${segment.start}-${index}`} className={index === activeIndex ? "is-active" : ""}>
                      <button type="button" onClick={() => playerRef.current?.seek(segment.start)} aria-label={`Play from ${timestamp(segment.start)}`}>
                        <time>{timestamp(segment.start)}</time>
                        <span>{segment.text}{showAll && segment.original !== segment.text && <small>{segment.original}</small>}</span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </section>
          )}
        </div>

        <aside className="result-side" style={{ display: "grid", gap: 24 }}>
          <section className="card export-card" aria-labelledby="export-title">
            <h2 id="export-title">Export Assets</h2>
            <p className="card-sub">High-quality files ready for distribution.</p>
            {job.output_video_download_url && (
              <a className="export-btn is-primary" href={job.output_video_download_url} download>
                <FileVideo size={20} /><span><strong>Download Video</strong><small>MP4 · Dubbed in {target}</small></span><Download size={18} />
              </a>
            )}
            {job.output_srt_download_url && (
              <a className="export-btn" href={job.output_srt_download_url} download>
                <FileText size={20} color="var(--violet)" /><span><strong>Download Subtitles</strong><small>SRT · {segments.length} cues</small></span><Download size={18} />
              </a>
            )}
            {segments.length > 0 && (
              <>
                <p className="export-other">OTHER FORMATS</p>
                <div className="export-pills">
                  <button type="button" onClick={() => downloadText(`${baseName}.${job.target_language}.vtt`, segmentsToVtt(translatedSegments), "text/vtt")}>Subtitles (.vtt)</button>
                  <button type="button" onClick={() => downloadText(`${baseName}.${job.target_language}.txt`, segmentsToText(translatedSegments), "text/plain")}>Transcript (.txt)</button>
                </div>
              </>
            )}
          </section>

          <section className="card share-card" aria-labelledby="share-title">
            <h2 id="share-title">Share with World</h2>
            <div className="share-icons">
              <a href={`https://twitter.com/intent/tweet?text=${shareText}&url=${encodeURIComponent(shareUrl)}`} target="_blank" rel="noreferrer" aria-label="Share on X / Twitter"><Twitter size={19} /></a>
              <a href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`} target="_blank" rel="noreferrer" aria-label="Share on LinkedIn"><Linkedin size={19} /></a>
              <a href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`} target="_blank" rel="noreferrer" aria-label="Share on Facebook"><Facebook size={19} /></a>
              <a href={`mailto:?subject=${shareText}&body=${encodeURIComponent(shareUrl)}`} aria-label="Share by email"><Mail size={19} /></a>
            </div>
            <label className="field-label" htmlFor="share-link" style={{ fontSize: 12, fontWeight: 600 }}>Shareable link</label>
            <div className="share-link">
              <input id="share-link" readOnly value={shareUrl} onFocus={(event) => event.currentTarget.select()} />
              <button type="button" onClick={copyLink} aria-label="Copy link">{copied ? <CircleCheck size={16} color="var(--teal)" /> : <Copy size={16} />}</button>
            </div>
          </section>

          <section className="tip-card">
            <span><Sparkles size={15} />PRO TIP</span>
            <p>Translate this video into <b>more languages</b> to reach new audiences. Start a new project with the same video and pick another target language.</p>
            <Link href="/#pricing">Upgrade to Creator Pro</Link>
          </section>
        </aside>
      </div>

      <div className="section-row" style={{ marginTop: 56 }}>
        <h2>Recent Generations</h2>
        <Link href="/projects" className="link" style={{ fontWeight: 500 }}>View All History</Link>
      </div>
      {recent.length ? (
        <div className="gen-grid">
          {recent.map((item) => (
            <Link key={item.id} href={`/result/${item.id}`} className="gen-card">
              <div className="gen-thumb">
                <ImageIcon size={56} strokeWidth={1.2} />
                {item.output_video_url && <video src={`${item.output_video_url}#t=1`} preload="metadata" muted playsInline aria-hidden="true" />}
                {item.duration_seconds ? <span className="duration">{clock(item.duration_seconds)}</span> : null}
              </div>
              <div className="gen-body">
                <strong>{projectTitle(item)}</strong>
                <div><span>{sourceLabel(item, languages)} <ChevronRight size={10} style={{ display: "inline" }} /> {languageName(languages, item.target_language)}</span><span>{relativeTime(item.created_at)}</span></div>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="empty-state"><span><Languages size={24} /></span><strong>Your other dubs will appear here</strong>Finished translations show up as you create them.</div>
      )}
    </AppShell>
  );
}
