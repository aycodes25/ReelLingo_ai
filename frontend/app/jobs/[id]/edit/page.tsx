"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, CircleAlert, CircleCheck, LoaderCircle, Mic, Play, RefreshCw, Save, Search } from "lucide-react";
import AppShell from "@/components/AppShell";
import { approveJob, getJob, getLanguages, redubJob, retranslateSegment, updateSegments } from "@/lib/api";
import { languageName, projectFileName, sourceLabel, timestamp } from "@/lib/format";
import type { Job, LanguageOption } from "@/lib/types";

interface Draft {
  source: string;
  text: string;
}

/**
 * Line-by-line editor for the transcript and translation. Used before the first dub (review mode)
 * and afterwards to fix lines and re-dub; unchanged lines keep their existing audio.
 */
export default function EditTranslationPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const jobId = Number(params.id);
  const [job, setJob] = useState<Job | null>(null);
  const [languages, setLanguages] = useState<LanguageOption[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [filter, setFilter] = useState("");
  const [busyLine, setBusyLine] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const audioRef = useRef<HTMLVideoElement>(null);
  const stopAt = useRef<number | null>(null);

  useEffect(() => {
    getLanguages().then(setLanguages).catch(() => undefined);
    getJob(jobId).then((loaded) => {
      setJob(loaded);
      setDrafts((loaded.transcript || []).map((segment, index) => ({ source: segment.text, text: loaded.translated_segments?.[index]?.text || "" })));
    }).catch((error: unknown) => setMessage({ tone: "error", text: error instanceof Error ? error.message : "Could not load this project." }));
  }, [jobId]);

  const changed = useMemo(() => drafts.map((draft, index) => (
    draft.text !== (job?.translated_segments?.[index]?.text || "") || draft.source !== (job?.transcript?.[index]?.text || "")
  )), [drafts, job]);
  const changedCount = changed.filter(Boolean).length;
  const needle = filter.trim().toLowerCase();
  const reviewing = job?.status === "awaiting_review";
  const target = job ? languageName(languages, job.target_language) : "";
  const speakerLabel = (speaker?: string) => job?.speakers?.find((item) => item.id === speaker)?.label || null;
  const previewUrl = job?.input_video_url || job?.output_video_url || null;

  function setDraft(index: number, patch: Partial<Draft>) {
    setDrafts((current) => current.map((draft, position) => (position === index ? { ...draft, ...patch } : draft)));
  }

  async function save(): Promise<boolean> {
    if (!job) return false;
    const edits = drafts.map((draft, index) => ({ index, text: draft.text, source_text: draft.source })).filter((_, index) => changed[index]);
    if (!edits.length) return true;
    if (edits.some((edit) => !edit.text.trim())) {
      setMessage({ tone: "error", text: "Every line needs a translation. Empty lines can't be dubbed." });
      return false;
    }
    setSaving(true);
    try {
      const updated = await updateSegments(job.id, edits);
      setJob(updated);
      setMessage({ tone: "success", text: `Saved ${edits.length} line${edits.length === 1 ? "" : "s"}.` });
      return true;
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Could not save." });
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function retranslate(index: number) {
    if (!job) return;
    setBusyLine(index);
    try {
      if (changed[index]) {
        const updated = await updateSegments(job.id, [{ index, source_text: drafts[index].source }]);
        setJob(updated);
      }
      const { text } = await retranslateSegment(job.id, index);
      setDraft(index, { text });
      setJob((current) => current && { ...current, translated_segments: (current.translated_segments || []).map((segment, position) => (position === index ? { ...segment, text } : segment)), transcript: (current.transcript || []).map((segment, position) => (position === index ? { ...segment, text: drafts[index].source } : segment)) });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Could not retranslate." });
    } finally {
      setBusyLine(null);
    }
  }

  async function finish() {
    if (!job || !(await save())) return;
    setSaving(true);
    try {
      if (reviewing) await approveJob(job.id);
      else await redubJob(job.id);
      router.push(`/jobs/${job.id}`);
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Could not start dubbing." });
      setSaving(false);
    }
  }

  function preview(start: number, end: number) {
    const media = audioRef.current;
    if (!media) return;
    media.currentTime = start;
    stopAt.current = end;
    void media.play();
  }

  const crumbs = [{ label: "Dashboard", href: "/dashboard" }, { label: "Projects", href: "/projects" }, { label: job ? projectFileName(job) : `Project #${jobId}`, href: job ? `/jobs/${jobId}` : undefined }, { label: "Edit translation" }];

  if (!job) {
    return (
      <AppShell crumbs={crumbs}>
        {message ? (
          <section className="center-state is-error"><span><CircleAlert size={28} /></span><h1>We couldn&apos;t load this project</h1><p>{message.text}</p><Link href="/projects" className="btn btn-primary">Back to projects</Link></section>
        ) : (
          <section className="center-state"><span><LoaderCircle size={28} className="spin" /></span><h1>Loading the translation…</h1></section>
        )}
      </AppShell>
    );
  }

  const editableNow = ["awaiting_review", "done", "failed"].includes(job.status) && !job.files_expired;
  const redubsLeft = job.max_redubs - job.redub_count;

  return (
    <AppShell crumbs={crumbs}>
      <div className="page-head">
        <div>
          <h1>{reviewing ? "Review the translation" : "Edit & re-dub"}</h1>
          <p>{sourceLabel(job, languages)} → {target} · {drafts.length} lines. {reviewing ? "Nothing has been voiced yet, so edits are free." : "Only the lines you change get a new voice recording."}</p>
        </div>
        <div className="page-head-actions">
          <button type="button" className="btn btn-outline" onClick={() => void save()} disabled={!changedCount || saving || !editableNow}><Save size={16} />Save{changedCount ? ` (${changedCount})` : ""}</button>
          <button type="button" className="btn btn-primary" onClick={finish} disabled={saving || !editableNow || (!reviewing && (job.status !== "done" || redubsLeft <= 0))}>
            <Mic size={16} />{reviewing ? "Approve & generate voice" : `Re-dub${redubsLeft > 0 ? ` (${redubsLeft} left)` : ""}`}<ArrowRight size={16} />
          </button>
        </div>
      </div>

      {!editableNow && <div className="alert alert-warn" style={{ marginBottom: 20 }}><CircleAlert size={16} /><span>{job.files_expired ? "This project's files have expired, so it can't be re-dubbed." : "Wait for processing to finish before editing."}</span></div>}
      {message && <div role={message.tone === "error" ? "alert" : "status"} className={`alert ${message.tone === "error" ? "alert-error" : "alert-success"}`} style={{ marginBottom: 20 }}>{message.tone === "error" ? <CircleAlert size={16} /> : <CircleCheck size={16} />}<span>{message.text}</span></div>}

      <div className="editor-layout">
        <div>
          <div className="search" style={{ display: "block", maxWidth: 360, marginBottom: 16 }}>
            <Search size={16} />
            <input type="search" placeholder="Find a word in either language…" aria-label="Filter lines" value={filter} onChange={(event) => setFilter(event.target.value)} />
          </div>
          <ol className="editor-lines">
            {drafts.map((draft, index) => {
              const segment = job.transcript?.[index];
              if (!segment) return null;
              if (needle && !`${draft.source} ${draft.text}`.toLowerCase().includes(needle)) return null;
              const speaker = speakerLabel(segment.speaker);
              return (
                <li key={`${segment.start}-${index}`} className={`editor-line ${changed[index] ? "is-changed" : ""}`}>
                  <div className="editor-line-meta">
                    <button type="button" className="icon-btn" onClick={() => preview(segment.start, segment.end)} aria-label={`Play original line ${index + 1}`} disabled={!previewUrl}><Play size={15} /></button>
                    <time>{timestamp(segment.start)}</time>
                    {speaker && <span className="speaker-tag">{speaker}</span>}
                    {changed[index] && <span className="badge badge-soft">Edited</span>}
                  </div>
                  <label className="editor-field">
                    <span>Original ({languageName(languages, segment.language)})</span>
                    <textarea rows={2} value={draft.source} disabled={!editableNow} onChange={(event) => setDraft(index, { source: event.target.value })} />
                  </label>
                  <label className="editor-field">
                    <span>{target}</span>
                    <textarea rows={2} value={draft.text} disabled={!editableNow} onChange={(event) => setDraft(index, { text: event.target.value })} />
                  </label>
                  <button type="button" className="btn btn-outline btn-sm editor-retranslate" onClick={() => retranslate(index)} disabled={busyLine !== null || !editableNow}>
                    {busyLine === index ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />}Retranslate from original
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
        <aside className="editor-side">
          <section className="card card-pad">
            <h2>Preview</h2>
            <p className="card-sub">Play the original speech for any line.</p>
            {previewUrl ? (
              <video
                ref={audioRef}
                src={previewUrl}
                controls
                playsInline
                className="editor-preview"
                onTimeUpdate={(event) => {
                  if (stopAt.current !== null && event.currentTarget.currentTime >= stopAt.current) {
                    event.currentTarget.pause();
                    stopAt.current = null;
                  }
                }}
              />
            ) : <p className="field-hint" style={{ marginTop: 12 }}>A preview appears once the project has finished at least once.</p>}
          </section>
          <section className="card card-pad">
            <h2>Tips</h2>
            <ul className="tip-list">
              <li>Fix a misheard word in the <b>original</b>, then press <b>Retranslate</b>.</li>
              <li>Keep lines short — long translations are sped up to fit the timing.</li>
              <li>Add names and slang you always want kept to your <Link href="/glossary" className="link">glossary</Link>.</li>
            </ul>
          </section>
        </aside>
      </div>
    </AppShell>
  );
}
