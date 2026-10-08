"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Captions, ChevronDown, CircleAlert, Info, Link2, Lock, Mic, Upload, X, Youtube } from "lucide-react";
import LanguagePicker from "@/components/LanguagePicker";
import TargetLanguages from "@/components/TargetLanguages";
import UploadDropzone from "@/components/UploadDropzone";
import UpsellDialog from "@/components/UpsellDialog";
import LaunchPanel from "@/components/LaunchPanel";
import { ApiError, createJob, getIntegrations, getVoices, getYoutubeVideos, preflightJob, uploadResumable } from "@/lib/api";
import { clock, estimateMinutes, formatMinutes } from "@/lib/format";
import { CAPTION_STYLES, FORMATS, NIGERIAN_VOICES, TONES } from "@/lib/options";
import type { ApiHealth, CreateJobOptions, LanguageOption, PreflightResult, SavedVoice, Usage, WaitingMusicSettings, YoutubeVideo } from "@/lib/types";

interface NewProjectFormProps {
  languages: LanguageOption[];
  usage: Usage | null;
  health: ApiHealth | null;
  setupProblem: string | null;
}

type Source = "upload" | "youtube" | "link";

/** Reads a local video's length in the browser, so the minutes it will use can be shown before uploading. */
function readDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const media = document.createElement(file.type.startsWith("audio/") ? "audio" : "video");
    media.preload = "metadata";
    media.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(media.duration) ? media.duration : null);
    };
    media.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    media.src = url;
  });
}

export default function NewProjectForm({ languages, usage, health, setupProblem }: NewProjectFormProps) {
  const router = useRouter();
  const plan = usage?.plan;
  const [source, setSource] = useState<Source>("upload");
  const [mode, setMode] = useState<"dub" | "subtitles">("dub");
  const [file, setFile] = useState<File | null>(null);
  const [fileSeconds, setFileSeconds] = useState<number | null>(null);
  const [link, setLink] = useState("");
  const [youtubeConnected, setYoutubeConnected] = useState(false);
  const [youtubeVideos, setYoutubeVideos] = useState<YoutubeVideo[] | null>(null);
  const [youtubeNext, setYoutubeNext] = useState<string | null>(null);
  const [youtubeError, setYoutubeError] = useState<string | null>(null);
  const [youtubeVideo, setYoutubeVideo] = useState<YoutubeVideo | null>(null);
  const [sourceLanguage, setSourceLanguage] = useState("auto");
  const [targets, setTargets] = useState<string[]>(["en"]);
  const [voiceMode, setVoiceMode] = useState<CreateJobOptions["voiceMode"]>("clone");
  const [voiceId, setVoiceId] = useState<number | null>(null);
  const [voices, setVoices] = useState<SavedVoice[]>([]);
  const [nigerianVoice, setNigerianVoice] = useState("");
  const [review, setReview] = useState(false);
  const [humanReview, setHumanReview] = useState(false);
  const [keepBackground, setKeepBackground] = useState(true);
  const [multiSpeaker, setMultiSpeaker] = useState(false);
  const [tone, setTone] = useState("natural");
  const [captions, setCaptions] = useState("");
  const [formats, setFormats] = useState<string[]>([]);
  const [lipSync, setLipSync] = useState(false);
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [voiceConsent, setVoiceConsent] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [upsell, setUpsell] = useState<ApiError | null>(null);
  const [check, setCheck] = useState<PreflightResult | null>(null);
  const [uploadedFirst, setUploadedFirst] = useState(false);
  const uploadedRef = useRef<{ file: File; id: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const maxTargets = plan?.max_targets || 1;

  useEffect(() => {
    getVoices().then(({ voices: saved }) => {
      setVoices(saved);
      if (saved[0]) setVoiceId(saved[0].id);
    }).catch(() => undefined);
    getIntegrations().then((result) => setYoutubeConnected(result.youtube.connected)).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (plan && !plan.voice_clone && voiceMode === "clone") setVoiceMode("standard");
    if (plan && targets.length > plan.max_targets) setTargets(targets.slice(0, plan.max_targets));
  }, [plan, voiceMode, targets]);

  useEffect(() => {
    setFileSeconds(null);
    if (file) void readDuration(file).then(setFileSeconds);
  }, [file]);

  function loadYoutube(page = "") {
    setYoutubeError(null);
    getYoutubeVideos(page).then((result) => {
      setYoutubeVideos((current) => (page && current ? [...current, ...result.videos] : result.videos));
      setYoutubeNext(result.next_page);
    }).catch((error: unknown) => setYoutubeError(error instanceof Error ? error.message : "Could not load your videos."));
  }

  useEffect(() => {
    if (source === "youtube" && youtubeConnected && youtubeVideos === null) loadYoutube();
  }, [source, youtubeConnected, youtubeVideos]);

  // on(): switched on by the admin for everyone. allowed(): included in this user's plan.
  const features = health?.settings?.features || {};
  const on = (key: string) => features[key] !== false;
  const allowed = (key: string) => plan?.permissions?.[key] !== false;
  const weights = usage?.weights || health?.settings?.pricing?.weights || { subtitles: 0.1, lipSync: 12, humanReview: 1, clips: 1 };
  const lockHint = "Not in your plan — upgrade to use it";
  const lipSyncLocked = !plan?.lip_sync || !health?.capabilities.lipSync;
  const savedLocked = !plan?.saved_voices || !voices.length;
  const dubbing = mode === "dub";
  const cloning = dubbing && voiceMode === "clone" && Boolean(plan?.voice_clone);
  const nigerianTarget = targets.find((code) => NIGERIAN_VOICES[code]);
  const showNigerianVoices = dubbing && voiceMode === "standard" && Boolean(nigerianTarget) && Boolean(health?.capabilities.nativeVoices);

  const seconds = source === "upload" ? fileSeconds : source === "youtube" ? youtubeVideo?.duration_seconds ?? null : null;
  const estimate = useMemo(() => (seconds ? estimateMinutes(seconds, targets.length, weights, { mode, lipSync: dubbing && lipSync, humanReview }) : null), [seconds, targets.length, weights, mode, lipSync, dubbing, humanReview]);
  // Ask whether this video can get all the way through as soon as the choices are made, not after a long upload.
  useEffect(() => {
    if (!targets.length) return undefined;
    let current = true;
    const timer = window.setTimeout(() => {
      preflightJob({ mode, targetLanguages: targets, durationSeconds: seconds, voiceMode: dubbing ? voiceMode || "clone" : "standard", lipSync: dubbing && lipSync })
        .then((result) => { if (current) setCheck(result); })
        .catch(() => { if (current) setCheck(null); });
    }, 500);
    return () => { current = false; window.clearTimeout(timer); };
  }, [mode, targets, seconds, voiceMode, lipSync, dubbing]);
  const available = usage?.minutes.available ?? null;
  const shortOfMinutes = estimate !== null && available !== null && estimate > available;

  function options(trimToFit = false): CreateJobOptions {
    return {
      sourceLanguage, targetLanguages: targets, voiceMode: dubbing ? voiceMode : "standard", voiceId, review, keepBackground: dubbing && keepBackground,
      multiSpeaker: dubbing && multiSpeaker, tone, captions: captions || null, formats, lipSync: dubbing && lipSync, trimToFit, mode, humanReview,
      nigerianVoice: showNigerianVoices ? nigerianVoice || null : null, rightsConfirmed, voiceConsent: cloning && voiceConsent,
    };
  }

  async function submit(trimToFit = false) {
    setErrorMessage(null);
    if (source === "upload" && !file) return setErrorMessage("Please select a video first.");
    if (source === "youtube" && !youtubeVideo) return setErrorMessage("Pick one of your YouTube videos.");
    if (source === "link" && !/^https?:\/\//i.test(link.trim())) return setErrorMessage("Paste a link that starts with https://");
    if (targets.includes(sourceLanguage)) return setErrorMessage("Choose a target language different from the source.");
    if (!rightsConfirmed) return setErrorMessage("Please confirm you own this video or have permission to translate it.");
    if (cloning && !voiceConsent) return setErrorMessage("Please confirm you have permission to clone the voices in this video, or choose a standard voice.");
    if (setupProblem) return setErrorMessage(setupProblem);
    setIsSubmitting(true);
    try {
      let uploadId: string | undefined;
      if (source === "upload" && file) {
        // Reuse a finished upload (e.g. when retrying after choosing “trim to fit”).
        if (uploadedRef.current?.file === file) {
          uploadId = uploadedRef.current.id;
        } else {
          abortRef.current = new AbortController();
          setProgress(0);
          uploadId = await uploadResumable(file, setProgress, abortRef.current.signal);
          uploadedRef.current = { file, id: uploadId };
        }
        setUploadedFirst(true);
      }
      setProgress(null);
      const job = await createJob(
        source === "upload" ? { uploadId } : source === "youtube" ? { youtubeVideoId: youtubeVideo?.id } : { sourceUrl: link.trim() },
        options(trimToFit),
      );
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

  const submitArea = (disabled: boolean) => (
    <SubmitArea {...{
      isSubmitting, progress, errorMessage, cancelUpload, onSubmit: () => submit(), targets: targets.length, mode, check,
      fromUpload: uploadedFirst, music: health?.settings?.waiting_music,
      disabled: disabled || !languages.length || !rightsConfirmed || (cloning && !voiceConsent) || Boolean(check && !check.ok),
    }} />
  );

  return (
    <>
      <div className="mode-tabs" role="tablist" aria-label="Video source">
        <button type="button" role="tab" aria-selected={source === "upload"} className={source === "upload" ? "is-active" : ""} onClick={() => setSource("upload")}><Upload size={15} />Upload a file</button>
        {on("link_import") && (
          <>
            <button type="button" role="tab" aria-selected={source === "youtube"} disabled={!allowed("link_import")} title={allowed("link_import") ? undefined : lockHint} className={source === "youtube" ? "is-active" : ""} onClick={() => setSource("youtube")}><Youtube size={15} />My YouTube{!allowed("link_import") && <Lock size={12} />}</button>
            <button type="button" role="tab" aria-selected={source === "link"} disabled={!allowed("link_import")} title={allowed("link_import") ? undefined : lockHint} className={source === "link" ? "is-active" : ""} onClick={() => setSource("link")}><Link2 size={15} />Drive or Dropbox link{!allowed("link_import") && <Lock size={12} />}</button>
          </>
        )}
      </div>

      {on("subtitles_only") && (
        <div className="segmented project-mode" role="group" aria-label="What to make">
          <button type="button" aria-pressed={mode === "dub"} className={mode === "dub" ? "is-on" : ""} onClick={() => setMode("dub")}><Mic size={15} />Dub the voice</button>
          <button type="button" aria-pressed={mode === "subtitles"} disabled={!allowed("subtitles_only")} className={mode === "subtitles" ? "is-on" : ""} onClick={() => setMode("subtitles")}>
            <Captions size={15} />Subtitles only<small>uses {Math.round(weights.subtitles * 100)}% of the minutes</small>
          </button>
        </div>
      )}

      <div className="lang-row">
        <LanguagePicker id="source-language" label="Source language" options={languages} value={sourceLanguage} onChange={setSourceLanguage} />
        <TargetLanguages options={languages} value={targets} onChange={setTargets} max={maxTargets} exclude={sourceLanguage} />
      </div>

      {dubbing && (
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
              <span><strong>{health?.capabilities.nativeVoices ? "Standard or native voice" : "Standard AI voice"}</strong><small>{health?.capabilities.nativeVoices ? "Native speakers' voices for Yoruba, Hausa, Igbo & Pidgin" : "A natural stock voice"}</small></span>
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
          {showNigerianVoices && nigerianTarget && (
            <div className="field" style={{ marginTop: 12 }}>
              <label className="field-label" htmlFor="nigerian-voice">Native {languages.find((language) => language.code === nigerianTarget)?.name || ""} voice for the main speaker</label>
              <div className="select-wrap">
                <select id="nigerian-voice" className="select" value={nigerianVoice} onChange={(event) => setNigerianVoice(event.target.value)}>
                  <option value="">Choose for me</option>
                  {NIGERIAN_VOICES[nigerianTarget].map((voice) => <option key={voice.value} value={voice.value}>{voice.label}</option>)}
                </select>
                <ChevronDown size={17} />
              </div>
            </div>
          )}
        </fieldset>
      )}

      <details className="advanced">
        <summary>Advanced options<ChevronDown size={16} /></summary>
        <div className="advanced-grid">
          {on("human_review") && <label className={`toggle-row ${allowed("human_review") ? "" : "is-locked"}`}><input type="checkbox" checked={humanReview} disabled={!allowed("human_review")} onChange={(event) => setHumanReview(event.target.checked)} /><span><strong>Human review by a native speaker{!allowed("human_review") && <Lock size={12} />}</strong><small>{allowed("human_review") ? `A native speaker checks the transcript and translation before ${dubbing ? "the voice is made" : "your subtitles are ready"}. Uses ${weights.humanReview} extra minute per minute of video; usually ready within a day.` : lockHint}</small></span></label>}
          {on("review") && <label className={`toggle-row ${allowed("review") ? "" : "is-locked"}`}><input type="checkbox" checked={review} disabled={!allowed("review")} onChange={(event) => setReview(event.target.checked)} /><span><strong>Let me review the translation{!allowed("review") && <Lock size={12} />}</strong><small>{allowed("review") ? `Fix names and slang line by line before ${dubbing ? "the voice is generated" : "the subtitles are made"}.` : lockHint}</small></span></label>}
          {dubbing && on("keep_background") && <label className={`toggle-row ${allowed("keep_background") ? "" : "is-locked"}`}><input type="checkbox" checked={keepBackground && allowed("keep_background")} disabled={!allowed("keep_background")} onChange={(event) => setKeepBackground(event.target.checked)} /><span><strong>Keep background music &amp; sound effects{!allowed("keep_background") && <Lock size={12} />}</strong><small>{allowed("keep_background") ? "Only the voices are replaced." : lockHint}</small></span></label>}
          {dubbing && on("multi_speaker") && <label className={`toggle-row ${allowed("multi_speaker") ? "" : "is-locked"}`}><input type="checkbox" checked={multiSpeaker} disabled={!health?.capabilities.multiSpeaker || !allowed("multi_speaker")} onChange={(event) => setMultiSpeaker(event.target.checked)} /><span><strong>Multiple speakers{!allowed("multi_speaker") && <Lock size={12} />}</strong><small>{allowed("multi_speaker") ? "Interviews, podcasts and skits: each person gets their own voice." : lockHint}</small></span></label>}
          {dubbing && on("lip_sync") && <label className={`toggle-row ${lipSyncLocked ? "is-locked" : ""}`}><input type="checkbox" checked={lipSync} disabled={lipSyncLocked} onChange={(event) => setLipSync(event.target.checked)} /><span><strong>Lip-sync {lipSyncLocked && <Lock size={12} />}</strong><small>{!plan?.lip_sync ? lockHint : !health?.capabilities.lipSync ? "Not configured on this server" : `Matches mouth movements to the new language. Premium add-on: uses ${weights.lipSync} extra minutes per minute of video.`}</small></span></label>}

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
                <option value="">{allowed("captions") ? "None for now (subtitle files only)" : "Not in your plan"}</option>
                {CAPTION_STYLES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
              <ChevronDown size={17} />
            </div>
            <small className="field-hint">Not sure? Skip it: when your video is ready you can add subtitles to it with one click.</small>
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

      <div className="consent-box">
        <label className="consent-row">
          <input type="checkbox" checked={rightsConfirmed} onChange={(event) => setRightsConfirmed(event.target.checked)} />
          <span>I own this video, or I have permission to translate and publish it.</span>
        </label>
        {cloning && (
          <label className="consent-row">
            <input type="checkbox" checked={voiceConsent} onChange={(event) => setVoiceConsent(event.target.checked)} />
            <span>The voices in this video are mine, or every speaker has agreed to have their voice cloned. <Link href="/privacy#voice" className="link" target="_blank">How we use voices</Link></span>
          </label>
        )}
      </div>

      {estimate !== null && (
        <p className={`minutes-estimate ${shortOfMinutes ? "is-short" : ""}`} role="status">
          {seconds ? <>This {clock(seconds)} video will use about <b>{formatMinutes(estimate)}</b>{targets.length > 1 ? ` (${targets.length} languages)` : ""}. </> : null}
          {available !== null && <>You have <b>{formatMinutes(available)}</b> left.</>}
          {shortOfMinutes && <> <Link href="/billing#payg" className="link">Buy minutes</Link> or turn on “trim to fit” when asked.</>}
        </p>
      )}

      {source === "upload" && (
        <UploadDropzone onFileSelected={(selected) => { setFile(selected); setErrorMessage(null); }}>
          {submitArea(!file)}
        </UploadDropzone>
      )}
      {source === "youtube" && (
        <div className="link-import">
          {!youtubeConnected ? (
            <p className="field-hint">Connect your YouTube channel in <Link href="/settings#integrations" className="link">Settings</Link> to pick one of your own videos. Only videos from your own channel can be imported.</p>
          ) : (
            <>
              <span className="field-label">Pick one of your videos</span>
              {youtubeError && <p className="form-error">{youtubeError}</p>}
              {youtubeVideos === null && !youtubeError && <div className="skeleton" style={{ height: 120 }} />}
              {youtubeVideos?.length === 0 && <p className="field-hint">No videos were found on your channel.</p>}
              <div className="yt-grid">
                {youtubeVideos?.map((video) => (
                  <button key={video.id} type="button" className={`yt-card ${youtubeVideo?.id === video.id ? "is-on" : ""}`} onClick={() => setYoutubeVideo(video)} aria-pressed={youtubeVideo?.id === video.id}>
                    {video.thumbnail ? <img src={video.thumbnail} alt="" /> : <span className="yt-thumb" />}
                    <strong>{video.title}</strong>
                    <small>{video.duration_seconds ? clock(video.duration_seconds) : ""}{video.privacy ? ` · ${video.privacy}` : ""}</small>
                  </button>
                ))}
              </div>
              {youtubeNext && <button type="button" className="btn btn-outline btn-sm" onClick={() => loadYoutube(youtubeNext)}>Show more</button>}
            </>
          )}
          {submitArea(!youtubeVideo)}
        </div>
      )}
      {source === "link" && (
        <div className="link-import">
          <label className="field-label" htmlFor="import-link">Video link</label>
          <input id="import-link" className="input input-plain" type="url" inputMode="url" placeholder="Google Drive, Dropbox or a direct link to a video file" value={link} onChange={(event) => setLink(event.target.value)} />
          <p className="field-hint">Google Drive files must be shared as “Anyone with the link”. Links from TikTok, Instagram and Facebook can’t be imported: download your video from the app and upload the file.</p>
          {submitArea(!link.trim())}
        </div>
      )}

      <UpsellDialog error={upsell} busy={isSubmitting} onClose={() => setUpsell(null)} onTrim={() => { setUpsell(null); void submit(true); }} />
    </>
  );
}

function SubmitArea({ isSubmitting, progress, errorMessage, disabled, cancelUpload, onSubmit, targets, mode, check, fromUpload, music }: {
  isSubmitting: boolean; progress: number | null; errorMessage: string | null; disabled: boolean; cancelUpload: () => void; onSubmit: () => void; targets: number; mode: "dub" | "subtitles";
  check: PreflightResult | null; fromUpload: boolean; music?: WaitingMusicSettings;
}) {
  const noun = mode === "subtitles" ? "subtitle" : "dub";
  const launching = isSubmitting && progress === null;
  return (
    <>
      {check && !check.ok && (
        <div role="alert" className="preflight-block"><CircleAlert size={18} /><div><strong>This can&apos;t be started right now</strong>{check.blockers.map((blocker) => <p key={blocker.message}>{blocker.message}</p>)}</div></div>
      )}
      {check?.ok && check.warnings.length > 0 && (
        <div className="preflight-warn" role="status">
          <Info size={16} />
          <div>{check.warnings.map((warning) => <p key={warning.message}>{/^(provider_credit|setup)$/.test(warning.code) ? "Admin note: " : ""}{warning.message}</p>)}</div>
        </div>
      )}
      {launching ? (
        <LaunchPanel fromUpload={fromUpload} music={music} />
      ) : progress !== null ? (
        <div className="upload-progress" role="status">
          <div><span>Uploading… {Math.round(progress * 100)}%</span><button type="button" className="link" onClick={cancelUpload}><X size={13} />Cancel</button></div>
          <div className="progress-track"><i style={{ width: `${Math.round(progress * 100)}%` }} /></div>
          <small>If your connection drops, just press Start again — the upload resumes where it stopped.</small>
        </div>
      ) : (
        <button type="button" onClick={onSubmit} disabled={isSubmitting || disabled} className="btn btn-primary">
          {isSubmitting ? "Starting…" : targets > 1 ? `Start ${targets} ${noun}s` : mode === "subtitles" ? "Make subtitles" : "Start Processing"} <ArrowRight size={17} />
        </button>
      )}
      {errorMessage && <p role="alert" className="form-error">{errorMessage}</p>}
    </>
  );
}
