"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  Captions, Check, CircleAlert, CircleCheck, Clock3, Download, ExternalLink, FileText, Info, Languages, LoaderCircle, Merge, Mic, Upload,
} from "lucide-react";
import AppShell, { SUPPORT_EMAIL } from "@/components/AppShell";
import { getJob, getLanguages } from "@/lib/api";
import { clock, languageName, PIPELINE_STAGES, progressPercent, projectFileName, sourceLabel, stageIndex, STEP_MESSAGES } from "@/lib/format";
import type { Job, LanguageOption } from "@/lib/types";

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
  const sawTranscriptRef = useRef(false);

  useEffect(() => {
    getLanguages().then(setLanguages).catch(() => undefined);
  }, []);

  useEffect(() => {
    const jobId = Number(params.id);
    let active = true;
    const push = (entry: Omit<LogEntry, "time">) => {
      const time = new Date().toLocaleTimeString([], { hour12: false });
      setLog((current) => [...current, { time, ...entry }]);
    };
    const refresh = async () => {
      try {
        const updated = await getJob(jobId);
        if (!active) return;
        setJob(updated);
        setLoadError(null);
        if (updated.current_step !== lastStepRef.current && updated.status !== "failed") {
          const firstLook = lastStepRef.current === null;
          lastStepRef.current = updated.current_step;
          push({ text: firstLook ? `Connected. ${STEP_MESSAGES[updated.current_step] || "Checking status."}` : STEP_MESSAGES[updated.current_step] || updated.current_step, tone: updated.current_step === "done" ? "success" : undefined });
        }
        if (!sawTranscriptRef.current && updated.transcript?.length) {
          sawTranscriptRef.current = true;
          const detected = updated.detected_languages.map((language) => language.name).join(", ");
          push({ text: `Transcribed ${updated.transcript.length} speech segment${updated.transcript.length === 1 ? "" : "s"}${detected ? ` in ${detected}` : ""}.`, tone: "success" });
        }
        if (updated.status === "failed" && lastStepRef.current !== "failed") {
          lastStepRef.current = "failed";
          push({ text: updated.error_message || "Processing stopped with an error.", tone: "error" });
        }
        if (updated.status === "done") {
          active = false;
          setTimeout(() => router.replace(`/result/${jobId}`), 1200);
        }
        if (updated.status === "failed") active = false;
      } catch (error) {
        if (active) setLoadError(error instanceof Error ? error.message : "Could not load job status.");
      }
    };
    void refresh();
    const interval = setInterval(() => { if (active) void refresh(); }, 3000);
    return () => { active = false; clearInterval(interval); };
  }, [params.id, router]);

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
  const current = job ? (job.status === "done" ? PIPELINE_STAGES.length : stageIndex(job.current_step)) : 0;
  const percent = job ? progressPercent(job) : 0;
  const stage = PIPELINE_STAGES[Math.min(current, PIPELINE_STAGES.length - 1)];

  return (
    <AppShell crumbs={crumbs}>
      <div className="page-head">
        <div>
          <h1>{failed ? "Processing Stopped" : "Processing Video"}</h1>
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
          </section>

          {failed && (
            <div className="alert alert-error"><CircleAlert size={16} /><span><strong>This translation could not be completed.</strong> {job?.error_message} <Link href="/dashboard#new-project" className="link">Start a new project</Link></span></div>
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
                <p>Dubbing uses a temporary clone of the original speaker, made from this video&apos;s own audio, and it&apos;s deleted as soon as your dub is ready.</p>
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
              {!failed && job?.status !== "done" && <div className="spinner-wrap"><span><LoaderCircle size={24} className="spin" /></span></div>}
            </div>
            <div className="source-body">
              <h3>{fileName}</h3>
              <p>{job?.duration_seconds ? `Original Duration: ${clock(job.duration_seconds)}` : "Duration available after transcription"}</p>
              <dl className="kv">
                <div><dt><Languages size={16} />Target Language</dt><dd>{job ? languageName(languages, job.target_language) : "—"}</dd></div>
                <div><dt><Captions size={16} />Subtitles</dt><dd>Enabled (.srt)</dd></div>
                <div><dt><Mic size={16} />Voice Model</dt><dd className="is-coral">{job?.voice_clone ? "Speaker Clone" : "Standard Voice"}</dd></div>
              </dl>
            </div>
          </section>

          <section className="card log-card" aria-labelledby="log-title">
            <div className="log-head">
              <h2 id="log-title"><Clock3 size={18} />Activity Log</h2>
              <span className={`live-tag ${job && !failed && job.status !== "done" ? "is-on" : ""}`}>LIVE</span>
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
