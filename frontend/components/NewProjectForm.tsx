"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, ChevronDown, Link2, Lock, Upload, X } from "lucide-react";
import LanguagePicker from "@/components/LanguagePicker";
import TargetLanguages from "@/components/TargetLanguages";
import UploadDropzone from "@/components/UploadDropzone";
import UpsellDialog from "@/components/UpsellDialog";
import { ApiError, createJob, getVoices, uploadResumable } from "@/lib/api";
import { CAPTION_STYLES, FORMATS, TONES } from "@/lib/options";
import type { ApiHealth, CreateJobOptions, LanguageOption, SavedVoice, Usage } from "@/lib/types";

interface NewProjectFormProps {
  languages: LanguageOption[];
  usage: Usage | null;
  health: ApiHealth | null;
  setupProblem: string | null;
}

type Mode = "upload" | "link";

export default function NewProjectForm({ languages, usage, health, setupProblem }: NewProjectFormProps) {
  const router = useRouter();
  const plan = usage?.plan;
  const [mode, setMode] = useState<Mode>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [link, setLink] = useState("");
  const [sourceLanguage, setSourceLanguage] = useState("auto");
  const [targets, setTargets] = useState<string[]>(["en"]);
  const [voiceMode, setVoiceMode] = useState<CreateJobOptions["voiceMode"]>("clone");
  const [voiceId, setVoiceId] = useState<number | null>(null);
  const [voices, setVoices] = useState<SavedVoice[]>([]);
  const [review, setReview] = useState(false);
  const [keepBackground, setKeepBackground] = useState(true);
  const [multiSpeaker, setMultiSpeaker] = useState(false);
  const [tone, setTone] = useState("natural");
  const [captions, setCaptions] = useState("");
  const [formats, setFormats] = useState<string[]>([]);
  const [lipSync, setLipSync] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [upsell, setUpsell] = useState<ApiError | null>(null);
  const uploadedRef = useRef<{ file: File; id: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const maxTargets = plan?.max_targets || 1;

  useEffect(() => {
    getVoices().then(({ voices: saved }) => {
      setVoices(saved);
      if (saved[0]) setVoiceId(saved[0].id);
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (plan && !plan.voice_clone && voiceMode === "clone") setVoiceMode("standard");
    if (plan && targets.length > plan.max_targets) setTargets(targets.slice(0, plan.max_targets));
  }, [plan, voiceMode, targets]);

  function options(trimToFit = false): CreateJobOptions {
    return {
      sourceLanguage, targetLanguages: targets, voiceMode, voiceId, review, keepBackground, multiSpeaker, tone,
      captions: captions || null, formats, lipSync, trimToFit,
    };
  }

  async function submit(trimToFit = false) {
    setErrorMessage(null);
    if (mode === "upload" && !file) return setErrorMessage("Please select a video first.");
    if (mode === "link" && !/^https?:\/\//i.test(link.trim())) return setErrorMessage("Paste a link that starts with https://");
    if (targets.includes(sourceLanguage)) return setErrorMessage("Choose a target language different from the source.");
    if (setupProblem) return setErrorMessage(setupProblem);
    setIsSubmitting(true);
    try {
      let uploadId: string | undefined;
      if (mode === "upload" && file) {
        // Reuse a finished upload (e.g. when retrying after choosing “trim to fit”).
        if (uploadedRef.current?.file === file) {
          uploadId = uploadedRef.current.id;
        } else {
          abortRef.current = new AbortController();
          setProgress(0);
          uploadId = await uploadResumable(file, setProgress, abortRef.current.signal);
          uploadedRef.current = { file, id: uploadId };
        }
      }
      setProgress(null);
      const job = await createJob(mode === "upload" ? { uploadId } : { sourceUrl: link.trim() }, options(trimToFit));
      uploadedRef.current = null;
      router.push(`/jobs/${job.id}`);
    } catch (error) {
      setProgress(null);
      setIsSubmitting(false);
      if (error instanceof ApiError && error.status === 402) {
        setUpsell(error);
        return;
      }
      setErrorMessage(error instanceof Error ? error.message : "Upload failed");
    }
  }

  function cancelUpload() {
    abortRef.current?.abort();
    setProgress(null);
    setIsSubmitting(false);
  }

  // on(): switched on by the admin for everyone. allowed(): included in this user's plan.
  const features = health?.settings?.features || {};
  const on = (key: string) => features[key] !== false;
  const allowed = (key: string) => plan?.permissions?.[key] !== false;
  const lockHint = "Not in your plan — upgrade to use it";
  const lipSyncLocked = !plan?.lip_sync || !health?.capabilities.lipSync;
  const savedLocked = !plan?.saved_voices || !voices.length;

  return (
    <>
      <div className="mode-tabs" role="tablist" aria-label="Video source">
        <button type="button" role="tab" aria-selected={mode === "upload"} className={mode === "upload" ? "is-active" : ""} onClick={() => setMode("upload")}><Upload size={15} />Upload a file</button>
        {on("link_import") && (
          <button type="button" role="tab" aria-selected={mode === "link"} disabled={!allowed("link_import")} title={allowed("link_import") ? undefined : lockHint} className={mode === "link" ? "is-active" : ""} onClick={() => setMode("link")}><Link2 size={15} />Import from a link{!allowed("link_import") && <Lock size={12} />}</button>
        )}
      </div>

      <div className="lang-row">
        <LanguagePicker id="source-language" label="Source language" options={languages} value={sourceLanguage} onChange={setSourceLanguage} />
        <TargetLanguages options={languages} value={targets} onChange={setTargets} max={maxTargets} exclude={sourceLanguage} />
      </div>

      <fieldset className="option-group">
        <legend>Voice</legend>
        <div className="radio-cards">
          <label className={`radio-card ${!plan?.voice_clone ? "is-locked" : ""}`}>
            <input type="radio" name="voice" checked={voiceMode === "clone"} disabled={!plan?.voice_clone} onChange={() => setVoiceMode("clone")} />
            <span><strong>Clone the speaker{!plan?.voice_clone && <Lock size={12} />}</strong><small>{plan?.voice_clone ? "Sounds like the person in the video" : "Starter plan and up"}</small></span>
          </label>
          {on("saved_voices") && <label className={`radio-card ${savedLocked ? "is-locked" : ""}`}>
            <input type="radio" name="voice" checked={voiceMode === "saved"} disabled={savedLocked} onChange={() => setVoiceMode("saved")} />
            <span><strong>My saved voice{!plan?.saved_voices && <Lock size={12} />}</strong><small>{!plan?.saved_voices ? "Creator plan and up" : voices.length ? "Same voice on every video" : <Link href="/settings#voices" className="link">Save your voice first</Link>}</small></span>
          </label>}
          <label className="radio-card">
            <input type="radio" name="voice" checked={voiceMode === "standard"} onChange={() => setVoiceMode("standard")} />
            <span><strong>Standard AI voice</strong><small>A natural stock voice</small></span>
          </label>
        </div>
        {voiceMode === "saved" && voices.length > 1 && (
          <div className="select-wrap" style={{ marginTop: 10 }}>
            <select className="select" aria-label="Saved voice" value={voiceId ?? ""} onChange={(event) => setVoiceId(Number(event.target.value))}>
              {voices.map((voice) => <option key={voice.id} value={voice.id}>{voice.name}</option>)}
            </select>
            <ChevronDown size={17} />
          </div>
        )}
      </fieldset>

      <details className="advanced">
        <summary>Advanced options<ChevronDown size={16} /></summary>
        <div className="advanced-grid">
          {on("review") && <label className={`toggle-row ${allowed("review") ? "" : "is-locked"}`}><input type="checkbox" checked={review} disabled={!allowed("review")} onChange={(event) => setReview(event.target.checked)} /><span><strong>Review the translation before dubbing{!allowed("review") && <Lock size={12} />}</strong><small>{allowed("review") ? "Fix names and slang line by line, then generate the voice." : lockHint}</small></span></label>}
          {on("keep_background") && <label className={`toggle-row ${allowed("keep_background") ? "" : "is-locked"}`}><input type="checkbox" checked={keepBackground && allowed("keep_background")} disabled={!allowed("keep_background")} onChange={(event) => setKeepBackground(event.target.checked)} /><span><strong>Keep background music &amp; sound effects{!allowed("keep_background") && <Lock size={12} />}</strong><small>{allowed("keep_background") ? "Only the voices are replaced." : lockHint}</small></span></label>}
          {on("multi_speaker") && <label className={`toggle-row ${allowed("multi_speaker") ? "" : "is-locked"}`}><input type="checkbox" checked={multiSpeaker} disabled={!health?.capabilities.multiSpeaker || !allowed("multi_speaker")} onChange={(event) => setMultiSpeaker(event.target.checked)} /><span><strong>Multiple speakers{!allowed("multi_speaker") && <Lock size={12} />}</strong><small>{allowed("multi_speaker") ? "Interviews, podcasts and skits: each person gets their own voice." : lockHint}</small></span></label>}
          {on("lip_sync") && <label className={`toggle-row ${lipSyncLocked ? "is-locked" : ""}`}><input type="checkbox" checked={lipSync} disabled={lipSyncLocked} onChange={(event) => setLipSync(event.target.checked)} /><span><strong>Lip-sync {lipSyncLocked && <Lock size={12} />}</strong><small>{!plan?.lip_sync ? lockHint : !health?.capabilities.lipSync ? "Not configured on this server" : "Matches mouth movements to the new language."}</small></span></label>}

          <div className="field">
            <label className="field-label" htmlFor="tone">Translation tone</label>
            <div className="select-wrap">
              <select id="tone" className="select" value={tone} onChange={(event) => setTone(event.target.value)}>
                {TONES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
              <ChevronDown size={17} />
            </div>
          </div>
          {on("captions") && <div className="field">
            <label className="field-label" htmlFor="captions">Burned-in captions{!allowed("captions") && <Lock size={12} />}</label>
            <div className="select-wrap">
              <select id="captions" className="select" value={captions} disabled={!allowed("captions")} onChange={(event) => setCaptions(event.target.value)}>
                <option value="">{allowed("captions") ? "None (SRT/VTT files only)" : "Not in your plan"}</option>
                {CAPTION_STYLES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
              <ChevronDown size={17} />
            </div>
          </div>}
          {on("formats") && <div className="field advanced-wide">
            <span className="field-label">Extra formats{!allowed("formats") && <> <Lock size={12} /> <small className="field-hint">{lockHint}</small></>}</span>
            <div className="format-chips">
              {FORMATS.map((item) => (
                <label key={item.value} className={`format-chip ${formats.includes(item.value) ? "is-on" : ""} ${allowed("formats") ? "" : "is-locked"}`}>
                  <input type="checkbox" className="visually-hidden" disabled={!allowed("formats")} checked={formats.includes(item.value)} onChange={(event) => setFormats(event.target.checked ? [...formats, item.value] : formats.filter((value) => value !== item.value))} />
                  <b>{item.label}</b><small>{item.hint}</small>
                </label>
              ))}
            </div>
          </div>}
          <p className="advanced-note">Manage names and terms the translator must keep in your <Link href="/glossary" className="link">glossary</Link>.</p>
        </div>
      </details>

      {mode === "upload" ? (
        <UploadDropzone onFileSelected={(selected) => { setFile(selected); setErrorMessage(null); }}>
          <SubmitArea {...{ isSubmitting, progress, errorMessage, disabled: !file || !languages.length, cancelUpload, onSubmit: () => submit(), targets: targets.length }} />
        </UploadDropzone>
      ) : (
        <div className="link-import">
          <label className="field-label" htmlFor="import-link">Video link</label>
          <input id="import-link" className="input input-plain" type="url" inputMode="url" placeholder="YouTube, TikTok, Instagram, Facebook, Google Drive, Dropbox or a direct file link" value={link} onChange={(event) => setLink(event.target.value)} />
          <p className="field-hint">Only import videos you own or have permission to translate. Google Drive files must be shared as “Anyone with the link”.</p>
          <SubmitArea {...{ isSubmitting, progress, errorMessage, disabled: !link.trim() || !languages.length, cancelUpload, onSubmit: () => submit(), targets: targets.length }} />
        </div>
      )}

      <UpsellDialog error={upsell} busy={isSubmitting} onClose={() => setUpsell(null)} onTrim={() => { setUpsell(null); void submit(true); }} />
    </>
  );
}

function SubmitArea({ isSubmitting, progress, errorMessage, disabled, cancelUpload, onSubmit, targets }: {
  isSubmitting: boolean; progress: number | null; errorMessage: string | null; disabled: boolean; cancelUpload: () => void; onSubmit: () => void; targets: number;
}) {
  return (
    <>
      {progress !== null ? (
        <div className="upload-progress" role="status">
          <div><span>Uploading… {Math.round(progress * 100)}%</span><button type="button" className="link" onClick={cancelUpload}><X size={13} />Cancel</button></div>
          <div className="progress-track"><i style={{ width: `${Math.round(progress * 100)}%` }} /></div>
          <small>If your connection drops, just press Start again — the upload resumes where it stopped.</small>
        </div>
      ) : (
        <button type="button" onClick={onSubmit} disabled={isSubmitting || disabled} className="btn btn-primary">
          {isSubmitting ? "Starting…" : targets > 1 ? `Start ${targets} dubs` : "Start Processing"} <ArrowRight size={17} />
        </button>
      )}
      {errorMessage && <p role="alert" className="form-error">{errorMessage}</p>}
    </>
  );
}
