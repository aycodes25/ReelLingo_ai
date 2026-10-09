"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  Captions, Check, CircleAlert, CircleCheck, Clock3, Download, ExternalLink, FileText, Info, Languages, LoaderCircle, Merge, Mic, PencilLine, RotateCcw, Upload,
} from "lucide-react";
import AppShell, { SUPPORT_EMAIL } from "@/components/AppShell";
import Loader3D from "@/components/Loader3D";
import WaitingMusic from "@/components/WaitingMusic";
import { getApiHealth, getJob, getLanguages, retryJob, streamJob } from "@/lib/api";
import { clock, languageName, PIPELINE_STAGES, progressPercent, projectFileName, sourceLabel, stageIndex, STEP_DETAIL, STEP_MESSAGES } from "@/lib/format";
import type { Job, LanguageOption, WaitingMusicSettings } from "@/lib/types";

const STAGE_ICONS = [Upload, FileText, Languages, Mic, Merge, Captions, Download];

interface LogEntry {
  time: string;
  text: string;
  tone?: "success" | "warn" | "error";
}

export default function JobStatusPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [job, setJob] = useState<Job | null>(null);
  const [languages, setLanguages] = useState<LanguageOption[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const lastStepRef = useRef<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const sawTranscriptRef = useRef(false);
  const lastAttemptRef = useRef(0);
  const lastStepAtRef = useRef<number | null>(null);

  const [music, setMusic] = useState<WaitingMusicSettings | undefined>(undefined);

  useEffect(() => {
    getLanguages().then(setLanguages).catch(() => undefined);
    getApiHealth().then((health) => setMusic(health.settings?.waiting_music)).catch(() => undefined);
  }, []);

  useEffect(() => {
    const jobId = Number(params.id);
    let active = true;
    const controller = new AbortController();
    let interval: ReturnType<typeof setInterval> | null = null;
    const push = (entry: Omit<LogEntry, "time">) => {
      const time = new Date().toLocaleTimeString([], { hour12: false });
      setLog((current) => [...current, { time, ...entry }]);
    };
    const apply = (updated: Job) => {
      if (!active) return;
      setJob(updated);
      setLoadError(null);
      // A new attempt means the server picked this project up again (for example after a restart): say so, so a repeated step isn't a mystery.
      if (lastAttemptRef.current && updated.attempts > lastAttemptRef.current && updated.status !== "failed") {
        push({ text: `Our server restarted this project (attempt ${updated.attempts}). Nothing is lost: it continues from the last saved step.`, tone: "warn" });
      }
      lastAttemptRef.current = Math.max(lastAttemptRef.current, updated.attempts || 0);
      if (updated.current_step !== lastStepRef.current && updated.status !== "failed") {
        const firstLook = lastStepRef.current === null;
        lastStepRef.current = updated.current_step;
        // How long the step before this one took (measured here, so it's approximate), to show where the time goes.
        const now = Date.now();
        const took = lastStepAtRef.current ? Math.round((now - lastStepAtRef.current) / 1000) : 0;
        lastStepAtRef.current = now;
        const timing = !firstLook && took >= 5 ? ` (previous step took ${clock(took)})` : "";
        push({ text: firstLook ? `Connected. ${STEP_MESSAGES[updated.current_step] || "Checking status."}` : `${STEP_MESSAGES[updated.current_step] || updated.current_step}${timing}`, tone: updated.current_step === "done" ? "success" : undefined });
      }
      if (!sawTranscriptRef.current && updated.has_transcript) {
        sawTranscriptRef.current = true;
        const detected = updated.detected_languages.map((language) => language.name).join(", ");
        push({ text: `Transcription finished${detected ? ` (${detected})` : ""}.`, tone: "success" });
      }
      if (updated.status === "failed" && lastStepRef.current !== "failed") {
        lastStepRef.current = "failed";
        push({ text: updated.error_message || "Processing stopped with an error.", tone: "error" });
      }
      if (updated.status === "done" || updated.extras_pending) {
        active = false;
        controller.abort();
        setTimeout(() => router.replace(`/result/${jobId}`), 1200);
      }
      if (updated.status === "awaiting_review" && updated.review_state === "human_pending" && lastStepRef.current !== "human-review") {
        lastStepRef.current = "human-review";
        push({ text: "A native speaker is now checking the translation.", tone: "warn" });
      } else if (updated.status === "awaiting_review" && updated.review_state !== "human_pending" && lastStepRef.current !== "review-ready") {
        lastStepRef.current = "review-ready";
        push({ text: "The translation is ready for your review.", tone: "warn" });
      }
    };
    const refresh = async () => {
      try {
        apply(await getJob(jobId));
      } catch (error) {
        if (active) setLoadError(error instanceof Error ? error.message : "Could not load job status.");
      }
    };
    void refresh();
    // Live updates over server-sent events; if the stream can't be opened or drops, fall back to polling.
    streamJob(jobId, apply, controller.signal).catch(() => undefined).finally(() => {
      if (active && !interval) interval = setInterval(() => { if (active) void refresh(); }, 3000);
    });
    return () => {
      active = false;
      controller.abort();
      if (interval) clearInterval(interval);
    };
  }, [params.id, router, retryKey]);

  async function handleRetry() {
    if (!job) return;
    setRetrying(true);
    setRetryError(null);
    try {
      await retryJob(job.id);
      lastStepRef.current = null;
      setLog([]);
      setRetryKey((key) => key + 1);
    } catch (error) {
      setRetryError(error instanceof Error ? error.message : "Retry failed.");
    } finally {
      setRetrying(false);
    }
  }

  const fileName = job ? projectFileName(job) : `Project #${params.id}`;
  const crumbs = [{ label: "Dashboard", href: "/dashboard" }, { label: "Projects", href: "/projects" }, { label: fileName }];

  if (loadError && !job) {
    return (
      <AppShell crumbs={crumbs}>
        <section className="center-state is-error">
          <span><CircleAlert size={28} /></span>
          <h1>We couldn&apos;t load this project</h1>
          <p>{loadError}</p>
          <Link href="/dashboard" className="btn btn-primary">Back to Dashboard</Link>
        </section>
      </AppShell>
    );
  }

  const failed = job?.status === "failed";
  const withReviewer = job?.status === "awaiting_review" && job.review_state === "human_pending";
  const reviewing = job?.status === "awaiting_review" && !withReviewer;
  const current = job ? (job.status === "done" ? PIPELINE_STAGES.length : stageIndex(job.current_step)) : 0;
  const percent = job ? progressPercent(job) : 0;
  const stage = PIPELINE_STAGES[Math.min(current, PIPELINE_STAGES.length - 1)];

  return (
    <AppShell crumbs={crumbs}>
      <div className="page-head">
        <div>
          <h1>{failed ? "Processing Stopped" : withReviewer ? "With a Native-Speaker Reviewer" : reviewing ? "Ready for Your Review" : "Processing Video"}</h1>
          <div className="proc-head-title">Project: <strong>{fileName}</strong>{job?.voice_clone && <span className="badge-soft badge">VOICE CLONE</span>}</div>
        </div>
        <div className="page-head-actions">
          <Link href="/dashboard" className="btn btn-outline">Back to Dashboard</Link>
          <Link href="/projects" className="btn btn-primary">View Queue</Link>
        </div>
      </div>

      <div className="proc-grid">
        <div className="proc-main">
          <section className={`progress-card ${failed ? "is-failed" : ""}`} aria-label="Total progress">
            <div className="progress-top">
              <div>
                <span>{failed ? "Stopped at" : "Total progress"}</span>
                <strong>{failed ? stage.label : `${percent}%`}<small>{failed ? "" : "Complete"}</small></strong>
              </div>
              <div>Current stage<b>{job ? (failed ? "Failed" : job.status === "done" ? "Finished" : stage.label) : "Loading…"}</b></div>
            </div>
            <div className="progress-track" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${failed ? 100 : percent}%` }} /></div>
            <div className="progress-labels"><span>Uploading &amp; Processing</span><span>Merging &amp; Finalizing</span></div>
            {job && job.status === "processing" && STEP_DETAIL[job.current_step] && (
              <p className="step-now" role="status"><LoaderCircle size={14} className="spin" /><span><strong>Right now:</strong> {STEP_DETAIL[job.current_step]} Nothing is stuck: the bar moves when this step finishes.</span></p>
            )}
            {job && (job.status === "queued" || job.status === "processing") && (
              <div className="wait-row">
                <Loader3D label="Working on your video" />
                <p>We&apos;re working on it. You can leave this page open and relax: we&apos;ll email you when it&apos;s ready.</p>
                <WaitingMusic settings={music} />
              </div>
            )}
          </section>

          {failed && (
            <div className="alert alert-error"><CircleAlert size={16} /><span><strong>This translation could not be completed.</strong> {job?.error_message}{" "}
              {job?.files_expired ? <Link href="/dashboard#new-project" className="link">Start a new project</Link> : (
                <button type="button" className="link" onClick={handleRetry} disabled={retrying}><RotateCcw size={13} style={{ display: "inline", verticalAlign: "-2px" }} /> {retrying ? "Retrying…" : "Retry from where it stopped"}</button>
              )}
              {retryError && <><br /><strong>{retryError}</strong></>}
            </span></div>
          )}
          {withReviewer && (
            <div className="alert alert-info"><PencilLine size={16} /><span><strong>A native speaker is checking your transcript and translation.</strong> They fix names, slang and tone before {job?.options.mode === "subtitles" ? "your subtitles are made" : "the voice is generated"}. This usually takes less than a day; we&apos;ll email you when your project continues.</span></div>
          )}
          {reviewing && (
            <div className="alert alert-success"><PencilLine size={16} /><span><strong>Your translation is ready.</strong> Check names, slang and phrasing line by line, then generate the voice. <Link href={`/jobs/${params.id}/edit`} className="link">Review translation →</Link></span></div>
          )}
          {job?.processing_note && !failed && (
            <div className="alert alert-warn"><Info size={16} /><span>{job.processing_note}</span></div>
          )}
          {job?.batch && job.batch.length > 1 && (
            <div className="batch-strip" aria-label="Other languages from this upload">
              <span>This upload:</span>
              {job.batch.map((item) => (
                <Link key={item.id} href={item.status === "done" ? `/result/${item.id}` : `/jobs/${item.id}`} className={`batch-pill ${item.id === job.id ? "is-current" : ""} is-${item.status}`}>
                  {languageName(languages, item.target_language)} · {item.status === "done" ? "ready" : item.status === "awaiting_review" ? "review" : item.status}
                </Link>
              ))}
            </div>
          )}

          <section className="card pipeline-card" aria-labelledby="pipeline-title">
            <h2 id="pipeline-title">Processing Pipeline</h2>
            <p className="card-sub">Real-time status of your video localization stages.</p>
            <ol className="pipeline">
              {PIPELINE_STAGES.map((item, index) => {
                const Icon = STAGE_ICONS[index];
                const state = index < current ? "is-done" : index === current ? (failed ? "is-failed" : "is-active") : "";
                return (
                  <li key={item.key} className={`pipe-step ${state}`} aria-current={state === "is-active" ? "step" : undefined}>
                    <span className="pipe-dot">
                      {state === "is-done" ? <Check size={20} strokeWidth={2.4} /> : state === "is-active" ? <LoaderCircle size={22} className="spin" /> : state === "is-failed" ? <CircleAlert size={20} /> : <Icon size={20} strokeWidth={1.8} />}
                    </span>
                    <small>STEP {index + 1}</small>
                    <b>{item.label}</b>
                    {state === "is-active" && <><span className="pipe-sub" aria-hidden="true"><i /></span><span className="pipe-sub-label">In progress</span></>}
                  </li>
                );
              })}
            </ol>
          </section>

          <div className="info-cards">
            <article className="info-card is-warm">
              <span><Info size={20} /></span>
              <div>
                <h3>Did you know?</h3>
                <p>ReelLingo translates each speech segment with the context around it, so slang and regional expressions in Yoruba, Swahili, Zulu and more keep their meaning.</p>
                <Link href="/#features">Learn more about our engines <ExternalLink size={13} /></Link>
              </div>
            </article>
            <article className="info-card is-cool">
              <span><CircleCheck size={20} /></span>
              <div>
                <h3>Your voice, preserved</h3>
                <p>Dubbing uses a temporary clone of each speaker, made from this video&apos;s own audio, and it&apos;s deleted as soon as your dub is ready. Background music and sound effects are kept.</p>
                <Link href="/#features">How voice cloning works <Mic size={13} /></Link>
              </div>
            </article>
          </div>
        </div>

        <aside className="proc-side">
          <section className="card source-card">
            <div className="source-media">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/images/creator-studio.png" alt="" />
              <span className="chip">Source: {job ? sourceLabel(job, languages) : "…"}</span>
              {!failed && !reviewing && !withReviewer && job?.status !== "done" && <div className="spinner-wrap"><span><LoaderCircle size={24} className="spin" /></span></div>}
            </div>
            <div className="source-body">
              <h3>{fileName}</h3>
              <p>{job?.duration_seconds ? `Original Duration: ${clock(job.duration_seconds)}` : "Duration available after transcription"}</p>
              <dl className="kv">
                <div><dt><Languages size={16} />Target Language</dt><dd>{job ? languageName(languages, job.target_language) : "—"}</dd></div>
                <div><dt><Captions size={16} />Subtitles</dt><dd>{job?.options.captions ? `SRT, VTT + burned-in (${job.options.captions})` : "SRT & VTT"}</dd></div>
                <div><dt><Mic size={16} />Voice Model</dt><dd className="is-coral">{job?.options.voice_id ? "Saved Voice" : job?.voice_clone ? (job.options.multi_speaker ? "Speaker Clones" : "Speaker Clone") : "Standard Voice"}</dd></div>
                {job?.options.formats.length ? <div><dt><Download size={16} />Formats</dt><dd>{job.options.formats.join(", ")}</dd></div> : null}
                {job?.options.keep_background ? <div><dt><Info size={16} />Background audio</dt><dd>Kept</dd></div> : null}
              </dl>
            </div>
          </section>

          <section className="card log-card" aria-labelledby="log-title">
            <div className="log-head">
              <h2 id="log-title"><Clock3 size={18} />Activity Log</h2>
              <span className={`live-tag ${job && !failed && !reviewing && job.status !== "done" ? "is-on" : ""}`}>LIVE</span>
            </div>
            <ol className="log-list" aria-live="polite">
              {log.length ? log.map((entry, index) => (
                <li key={`${entry.time}-${index}`}><time>{entry.time}</time><span className={entry.tone ? `is-${entry.tone}` : ""}>{entry.text}</span></li>
              )) : <li><time>--:--:--</time><span style={{ color: "var(--muted)" }}>Connecting to your job…</span></li>}
            </ol>
          </section>

          <section className="help-card">
            <span><CircleAlert size={22} /></span>
            <h3>Need help with this job?</h3>
            <p>Our support team can look into it with you. Include the project number in your message.</p>
            <a href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`Help with project #${params.id}`)}`} className="btn btn-outline btn-block">Contact Support</a>
          </section>
        </aside>
      </div>
    </AppShell>
  );
}
