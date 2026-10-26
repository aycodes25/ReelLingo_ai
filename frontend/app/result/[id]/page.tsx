"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { QualityReport } from "@/components/QualityReport";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowRight, AudioLines, Captions, ChevronRight, CircleAlert, CircleCheck, Clapperboard, Copy, Download, Facebook, FileAudio, FileText, FileVideo, Globe, Hash,
  ImageIcon, Languages, Linkedin, LoaderCircle, Mail, MessageCircle, Mic, PencilLine, RotateCcw, Scissors, Share2, Sparkles, Trash2, Twitter, UserCheck,
  Volume2, Youtube,
} from "lucide-react";
import AppShell from "@/components/AppShell";
import VideoPlayer, { type VideoPlayerHandle } from "@/components/VideoPlayer";
import {
  addLanguageToYoutube, ApiError, deleteJob, getApiHealth, getIntegrations, getJob, getJobs, getLanguages, getVoices, getYoutubeVideos, publishToYoutube,
  requestCaptions, requestClips, saveVoiceFromJob, shareJob,
} from "@/lib/api";
import { CAPTION_STYLES } from "@/lib/options";
import {
  clock, downloadText, formatMinutes, languageName, projectFileName, projectTitle, relativeTime, segmentsToText, sourceLabel, timestamp,
} from "@/lib/format";
import type { Job, JobOutputFile, LanguageOption, MinuteWeights, YoutubeVideo } from "@/lib/types";

const PREVIEW_LINES = 3;

function outputIcon(output: JobOutputFile) {
  if (output.kind === "audio") return <FileAudio size={20} color="var(--teal)" />;
  if (output.kind === "subtitles") return <FileText size={20} color="var(--violet)" />;
  return <FileVideo size={20} />;
}

export default function ResultPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const jobId = Number(params.id);
  const [job, setJob] = useState<Job | null>(null);
  const [recent, setRecent] = useState<Job[]>([]);
  const [languages, setLanguages] = useState<LanguageOption[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [time, setTime] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [youtube, setYoutube] = useState<{ configured: boolean; connected: boolean; channel: string | null } | null>(null);
  const [ytPrivacy, setYtPrivacy] = useState("private");
  const [ytOutput, setYtOutput] = useState("video");
  const [voiceSlots, setVoiceSlots] = useState<{ used: number; limit: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [features, setFeatures] = useState<Record<string, boolean>>({});
  const [captionStyle, setCaptionStyle] = useState("classic");
  const [weights, setWeights] = useState<MinuteWeights | null>(null);
  const [ytVideos, setYtVideos] = useState<YoutubeVideo[] | null>(null);
  const [ytVideo, setYtVideo] = useState("");
  const [ytLanguageError, setYtLanguageError] = useState<string | null>(null);
  const playerRef = useRef<VideoPlayerHandle>(null);

  useEffect(() => {
    getJob(jobId).then(setJob).catch((error: unknown) => {
      setErrorMessage(error instanceof Error ? error.message : "Could not load this project.");
    });
    getLanguages().then(setLanguages).catch(() => undefined);
    getJobs(12).then((items) => setRecent(items.filter((item) => item.id !== jobId && item.status === "done").slice(0, 3))).catch(() => undefined);
    getIntegrations().then((result) => setYoutube(result.youtube)).catch(() => undefined);
    getVoices().then((result) => setVoiceSlots({ used: result.voices.length, limit: result.limit })).catch(() => undefined);
    getApiHealth().then((health) => {
      setFeatures(health.settings?.features || {});
      setWeights(health.settings?.pricing?.weights || null);
    }).catch(() => undefined);
  }, [jobId]);

  // Poll while short clips are being made, or while subtitles are being put on the video.
  const working = Boolean(job?.clips_pending || job?.captions_pending || job?.extras_pending);
  useEffect(() => {
    if (!working) return;
    const timer = setInterval(() => { getJob(jobId).then(setJob).catch(() => undefined); }, 4000);
    return () => clearInterval(timer);
  }, [working, jobId]);

  // Poll while a YouTube upload is running.
  useEffect(() => {
    if (job?.youtube?.status !== "uploading") return;
    const timer = setInterval(() => { getJob(jobId).then(setJob).catch(() => undefined); }, 4000);
    return () => clearInterval(timer);
  }, [job?.youtube?.status, jobId]);

  const segments = useMemo(() => {
    if (!job?.transcript?.length) return [];
    return job.transcript.map((segment, index) => ({ ...segment, original: segment.text, text: job.translated_segments?.[index]?.text || segment.text }));
  }, [job]);

  const activeIndex = segments.findIndex((segment) => time >= segment.start && time < segment.end);
  const crumbs = [{ label: "Dashboard", href: "/dashboard" }, { label: "Projects", href: "/projects" }, { label: job ? projectFileName(job) : `Project #${params.id}` }];

  if (errorMessage || !job || (job.status !== "done" && !job.clips_pending && !job.captions_pending && !job.extras_pending)) {
    return (
      <AppShell crumbs={crumbs}>
        {errorMessage ? (
          <section className="center-state is-error"><span><CircleAlert size={28} /></span><h1>We couldn&apos;t load this project</h1><p>{errorMessage}</p><Link href="/dashboard" className="btn btn-primary">Back to Dashboard</Link></section>
        ) : !job ? (
          <section className="center-state"><span><LoaderCircle size={28} className="spin" /></span><h1>Loading your video…</h1></section>
        ) : job.status === "failed" ? (
          <section className="center-state is-error"><span><CircleAlert size={28} /></span><h1>This dub needs another take</h1><p>{job.error_message || "The translation could not be completed."}</p><Link className="btn btn-primary" href={`/jobs/${job.id}`}>Open project to retry <ArrowRight size={16} /></Link></section>
        ) : job.review_state === "human_pending" ? (
          <section className="center-state"><span><UserCheck size={28} /></span><h1>A native speaker is checking your translation</h1><p>Your reviewer corrects names, slang and tone before {job.options.mode === "subtitles" ? "your subtitles are made" : "the voice is generated"}. We&apos;ll email you when it&apos;s done, usually within a day.</p><Link href={`/jobs/${job.id}`} className="btn btn-primary">View project <ArrowRight size={16} /></Link></section>
        ) : (
          <section className="center-state"><span><AudioLines size={28} /></span><h1>This video is still in progress</h1><p>We&apos;re working through the translation now.</p><Link href={job.status === "awaiting_review" ? `/jobs/${job.id}/edit` : `/jobs/${job.id}`} className="btn btn-primary">{job.status === "awaiting_review" ? "Review translation" : "View processing status"} <ArrowRight size={16} /></Link></section>
        )}
      </AppShell>
    );
  }

  const target = languageName(languages, job.target_language);
  const baseName = projectFileName(job).replace(/\.[^.]+$/, "");
  const translatedSegments = segments.map(({ start, end, text, language }) => ({ start, end, text, language }));
  const shareUrl = job.share_url || "";
  const visible = showAll ? segments : segments.slice(Math.max(0, Math.min(activeIndex, segments.length - PREVIEW_LINES)), Math.max(0, Math.min(activeIndex, segments.length - PREVIEW_LINES)) + PREVIEW_LINES);
  const title = job.metadata?.title || projectTitle(job);
  const shareText = encodeURIComponent(`Watch "${title}" in ${target}, dubbed with ReelLingo`);
  const vtt = job.outputs.find((output) => output.format === "vtt");
  const subtitlesOnly = job.options.mode === "subtitles";
  const videoOutputs = job.outputs.filter((output) => output.kind !== "subtitles" && output.kind !== "clip");
  const clips = job.outputs.filter((output) => output.kind === "clip");
  const burnedIn = job.outputs.find((output) => output.kind === "captioned");
  const dubbedAudio = job.outputs.find((output) => output.kind === "audio");
  const subtitleOutputs = job.outputs.filter((output) => output.kind === "subtitles");
  const redubsLeft = job.max_redubs - job.redub_count;

  async function copy(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      setCopied(null);
    }
  }

  async function toggleShare(enabled: boolean) {
    setBusy("share");
    try {
      setJob(await shareJob(job!.id, enabled));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not update sharing.");
    } finally {
      setBusy(null);
    }
  }

  async function shareVideo() {
    let url = shareUrl;
    if (!url) {
      const updated = await shareJob(job!.id, true);
      setJob(updated);
      url = updated.share_url || "";
    }
    if (navigator.share) {
      await navigator.share({ title, text: decodeURIComponent(shareText), url }).catch(() => undefined);
    } else {
      await copy(url, "share");
    }
  }

  async function publish() {
    setBusy("youtube");
    try {
      setJob(await publishToYoutube(job!.id, {
        title,
        description: `${job!.metadata?.description || ""}\n\n${(job!.metadata?.hashtags || []).join(" ")}`.trim(),
        tags: job!.metadata?.hashtags || [],
        privacy: ytPrivacy,
        output: ytOutput,
      }));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not publish.");
    } finally {
      setBusy(null);
    }
  }

  async function saveVoice(speaker?: string) {
    const name = window.prompt("Name this voice (e.g. “My voice”)", "My voice");
    if (!name) return;
    if (!window.confirm("Confirm this is your own voice, or that you have the speaker's permission to reuse it.")) return;
    setBusy("voice");
    try {
      const result = await saveVoiceFromJob(job!.id, name, speaker);
      setVoiceSlots((current) => current && { ...current, used: result.voices.length });
      setNotice(`Saved “${name}”. Choose “My saved voice” when you create your next project.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not save the voice.");
    } finally {
      setBusy(null);
    }
  }

  async function addSubtitles() {
    setBusy("captions");
    setNotice(null);
    try {
      setJob(await requestCaptions(job!.id, captionStyle)); // the banner above says it's working, and the page updates itself
    } catch (error) {
      setNotice(error instanceof ApiError && error.status === 402 ? `${error.message} You can upgrade on the Billing page.` : error instanceof Error ? error.message : "Could not add the subtitles.");
    } finally {
      setBusy(null);
    }
  }

  async function makeClips() {
    if (!window.confirm(`Make 3-5 short vertical clips with captions from this video? This uses ${formatMinutes(weights?.clips ?? 1)}.`)) return;
    setBusy("clips");
    try {
      setJob(await requestClips(job!.id));
      setNotice("Making your clips. This page updates when they're ready.");
    } catch (error) {
      setNotice(error instanceof ApiError && error.status === 402 ? `${error.message} Buy minutes or upgrade on the Billing page.` : error instanceof Error ? error.message : "Could not start the clips.");
    } finally {
      setBusy(null);
    }
  }

  async function loadYoutubeVideos() {
    setYtLanguageError(null);
    try {
      const result = await getYoutubeVideos();
      setYtVideos(result.videos);
      if (result.videos[0]) setYtVideo(result.videos[0].id);
    } catch (error) {
      setYtLanguageError(error instanceof Error ? error.message : "Could not load your videos.");
    }
  }

  async function addToExistingVideo() {
    setBusy("yt-language");
    setYtLanguageError(null);
    try {
      const result = await addLanguageToYoutube(job!.id, ytVideo);
      setJob(await getJob(job!.id));
      setNotice(`Added ${target} to “${result.title}”: ${[result.captions_id ? "subtitles" : "", result.localized ? "translated title and description" : ""].filter(Boolean).join(" and ") || "nothing new"}.`);
    } catch (error) {
      setYtLanguageError(error instanceof Error ? error.message : "Could not add this language.");
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!window.confirm("Delete this project? Its video, audio and subtitle files are removed permanently.")) return;
    setBusy("delete");
    try {
      await deleteJob(job!.id);
      router.replace("/projects");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not delete.");
      setBusy(null);
    }
  }

  return (
    <AppShell crumbs={crumbs}>
      <div className="page-head" style={{ alignItems: "flex-end" }}>
        <div>
          <div className="ready-line">
            <span className="ready-chip"><CircleCheck size={13} />{subtitlesOnly ? "Subtitles Ready" : "Translation Ready"}</span>
            {job.human_reviewed_at && <span className="ready-chip is-reviewed"><UserCheck size={13} />Checked by a native speaker</span>}
            <span>{job.duration_seconds ? `${clock(job.duration_seconds)} ${job.media_type === "audio" ? "audio" : "video"}` : "Dubbed video"} · Created {relativeTime(job.created_at).toLowerCase()}</span>
          </div>
          <h1 className="result-title">{title}</h1>
          <div className="lang-path">
            <span>{sourceLabel(job, languages)}</span><ChevronRight size={16} /><span className="to">{target}</span>
            <i className="sep" />
            <span className="voice">{subtitlesOnly ? <><FileText size={16} />Subtitles only</> : <><Volume2 size={16} />{job.options.voice_id ? "Saved voice" : job.voice_clone ? (job.speakers && job.speakers.length > 1 ? `${job.speakers.length} speaker clones` : "AI Voice Clone (Speaker Match)") : job.speakers?.some((speaker) => speaker.voice === "native") ? "Native Nigerian voice" : "AI Voice (Standard)"}</>}</span>
          </div>
        </div>
        <div className="page-head-actions">
          <Link href={`/jobs/${job.id}/edit`} className="btn btn-outline" aria-disabled={redubsLeft <= 0 || job.files_expired}><PencilLine size={16} />{subtitlesOnly ? "Edit subtitles" : "Edit & re-dub"}</Link>
          <Link href="/dashboard#new-project" className="btn btn-outline"><RotateCcw size={16} />Translate Another</Link>
          <button type="button" className="btn btn-primary" onClick={shareVideo}><Share2 size={16} />Share Video</button>
        </div>
      </div>

      {job.processing_note && (
        <div className="alert alert-warn" style={{ marginBottom: 24 }}><CircleAlert size={16} /><span><strong>Note.</strong> {job.processing_note}</span></div>
      )}
      {job.options.watermark && (
        <div className="alert alert-info" style={{ marginBottom: 24 }}><Sparkles size={16} /><span>Free-plan exports carry a small ReelLingo watermark. <Link href="/billing" className="link">Upgrade</Link> to remove it and re-dub.</span></div>
      )}
      {notice && <div role="status" className="alert alert-success" style={{ marginBottom: 24 }}><CircleCheck size={16} /><span>{notice}</span></div>}
      {job.review_note && <div className="alert alert-info" style={{ marginBottom: 24 }}><UserCheck size={16} /><span>{job.review_note}</span></div>}
      {job.extras_pending && <div role="status" className="alert alert-info" style={{ marginBottom: 24 }}><LoaderCircle size={16} className="spin" /><span><strong>Your dubbed video is ready.</strong> We&apos;re still making the extra versions you asked for (subtitled video, other sizes). They&apos;ll appear here when they&apos;re done: no need to wait.</span></div>}
      {job.captions_pending && <div role="status" className="alert alert-info" style={{ marginBottom: 24 }}><LoaderCircle size={16} className="spin" /><span>Adding the subtitles to your video… this usually takes a minute or two.</span></div>}
      {job.clips_pending && <div role="status" className="alert alert-info" style={{ marginBottom: 24 }}><LoaderCircle size={16} className="spin" /><span>Making your short clips… this usually takes a few minutes.</span></div>}
      {job.quality_report && !subtitlesOnly && <QualityReport report={job.quality_report} />}
      {job.batch && job.batch.length > 1 && (
        <div className="batch-strip" aria-label="Other languages from this upload">
          <span>Also from this upload:</span>
          {job.batch.filter((item) => item.id !== job.id).map((item) => (
            <Link key={item.id} href={item.status === "done" ? `/result/${item.id}` : `/jobs/${item.id}`} className={`batch-pill is-${item.status}`}>{languageName(languages, item.target_language)} · {item.status === "done" ? "ready" : item.status}</Link>
          ))}
        </div>
      )}

      <div className="result-grid">
        <div className="result-main-col">
          <VideoPlayer
            ref={playerRef}
            src={job.outputs.find((output) => output.kind === "lipsync")?.url || job.output_video_url || (subtitlesOnly ? job.input_video_url : null)}
            label={subtitlesOnly ? `Subtitles · ${target}` : `Dubbed · ${target}`}
            compareSrc={job.input_video_url}
            compareLabel={`Original · ${sourceLabel(job, languages)}`}
            captionsSrc={vtt?.url || null}
            captionsLang={job.target_language}
            audioOnly={job.media_type === "audio"}
            onTimeChange={setTime}
          />

          {job.metadata && (
            <section className="card card-pad metadata-card" aria-labelledby="metadata-title">
              <div className="transcript-head" style={{ padding: 0, border: 0 }}>
                <h2 id="metadata-title"><Sparkles size={18} />Ready-to-post caption ({target})</h2>
                <button type="button" onClick={() => copy(`${job.metadata!.title}\n\n${job.metadata!.description}\n\n${job.metadata!.hashtags.join(" ")}`, "meta")}>{copied === "meta" ? "Copied!" : "Copy all"}</button>
              </div>
              <dl className="meta-list">
                <div><dt>Title</dt><dd>{job.metadata.title}</dd></div>
                <div><dt>Description</dt><dd>{job.metadata.description}</dd></div>
                <div><dt><Hash size={14} />Hashtags</dt><dd className="hashtags">{job.metadata.hashtags.map((tag) => <span key={tag}>{tag}</span>)}</dd></div>
              </dl>
            </section>
          )}

          {job.media_type !== "audio" && features.captions !== false && !job.files_expired && (
            <section className="card card-pad captions-card" aria-labelledby="captions-title">
              <h2 id="captions-title"><Captions size={18} />Video with subtitles on the screen</h2>
              <p className="card-sub">Puts the words right on the picture, so they show while the video plays: on any phone, in WhatsApp, on TikTok or on a TV. No separate subtitle file needed.</p>
              {burnedIn?.download_url && !job.captions_pending && (
                <div className="captions-ready">
                  {burnedIn.url && <video src={burnedIn.url} controls preload="metadata" playsInline aria-label="Your video with subtitles on the screen" />}
                  <a className="btn btn-primary" href={burnedIn.download_url} download><Download size={16} />Download video with subtitles</a>
                </div>
              )}
              <div className="captions-controls">
                <label className="field-label" htmlFor="caption-style">Subtitle style</label>
                <select id="caption-style" className="select" value={captionStyle} onChange={(event) => setCaptionStyle(event.target.value)} disabled={Boolean(job.captions_pending)}>
                  {CAPTION_STYLES.map((style) => <option key={style.value} value={style.value}>{style.label}</option>)}
                </select>
                <button type="button" className={burnedIn ? "btn btn-outline" : "btn btn-primary"} onClick={addSubtitles} disabled={busy === "captions" || Boolean(job.captions_pending)}>
                  {job.captions_pending ? "Adding subtitles…" : burnedIn ? "Make it again in this style" : "Add subtitles to my video"}
                </button>
              </div>
              <small className="card-sub">No minutes used. {subtitlesOnly ? "The subtitles go on your original video." : "The subtitles go on your dubbed video."}</small>
            </section>
          )}

          {job.media_type !== "audio" && features.clips !== false && (
            <section className="card card-pad clips-card" aria-labelledby="clips-title">
              <div className="transcript-head" style={{ padding: 0, border: 0 }}>
                <h2 id="clips-title"><Scissors size={18} />Short clips for TikTok, Reels &amp; Shorts</h2>
                {!job.files_expired && (
                  <button type="button" onClick={makeClips} disabled={busy === "clips" || job.clips_pending}>
                    {job.clips_pending ? "Making clips…" : clips.length ? "Make new clips" : "Make clips"}
                  </button>
                )}
              </div>
              {clips.length ? (
                <div className="clip-grid">
                  {clips.map((clip) => (
                    <figure key={clip.label} className="clip-tile">
                      {clip.url && <video src={clip.url} controls preload="metadata" playsInline />}
                      <figcaption>
                        <strong>{clip.label.replace(/^Clip \d+: /, "")}</strong>
                        <small>{clip.start !== null && clip.start !== undefined ? `${clock(clip.start)}–${clock(clip.end || 0)}` : ""}</small>
                        {clip.download_url && <a href={clip.download_url} download className="link"><Download size={13} /> Download</a>}
                      </figcaption>
                    </figure>
                  ))}
                </div>
              ) : (
                <p className="card-sub">We pick the 3-5 strongest moments, make them vertical and add big captions, ready to post. Uses {formatMinutes(weights?.clips ?? 1)} per set.</p>
              )}
            </section>
          )}

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
            <p className="card-sub">{job.files_expired ? "These files have expired under the retention policy." : "High-quality files ready for distribution."}</p>
            {videoOutputs.map((output, index) => output.download_url && (
              <a key={`${output.kind}-${output.aspect}-${index}`} className={`export-btn ${index === 0 ? "is-primary" : ""}`} href={output.download_url} download>
                {outputIcon(output)}<span><strong>{output.label}</strong><small>{output.kind === "audio" ? "MP3" : "MP4"} · {target}</small></span><Download size={18} />
              </a>
            ))}
            {subtitleOutputs.length > 0 && (
              <>
                <p className="export-other">SUBTITLES &amp; TRANSCRIPT</p>
                <div className="export-pills">
                  {subtitleOutputs.map((output) => output.download_url && <a key={output.format} href={output.download_url} download>{output.label}</a>)}
                  {segments.length > 0 && <button type="button" onClick={() => downloadText(`${baseName}.${job.target_language}.txt`, segmentsToText(translatedSegments), "text/plain")}>Transcript (.txt)</button>}
                </div>
              </>
            )}
          </section>

          {features.public_share !== false && <section className="card share-card" aria-labelledby="share-title">
            <h2 id="share-title">Share with World</h2>
            <label className="toggle-row" style={{ marginBottom: 14 }}>
              <input type="checkbox" checked={Boolean(job.share_slug)} disabled={busy === "share"} onChange={(event) => void toggleShare(event.target.checked)} />
              <span><strong>Public watch page</strong><small>{job.share_slug ? "Anyone with the link can watch, and compare with the original." : "Off — only you can see this dub."}</small></span>
            </label>
            {shareUrl && (
              <>
                <div className="share-icons">
                  <a href={`https://wa.me/?text=${shareText}%20${encodeURIComponent(shareUrl)}`} target="_blank" rel="noreferrer" aria-label="Share on WhatsApp"><MessageCircle size={19} /></a>
                  <a href={`https://twitter.com/intent/tweet?text=${shareText}&url=${encodeURIComponent(shareUrl)}`} target="_blank" rel="noreferrer" aria-label="Share on X / Twitter"><Twitter size={19} /></a>
                  <a href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`} target="_blank" rel="noreferrer" aria-label="Share on Facebook"><Facebook size={19} /></a>
                  <a href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`} target="_blank" rel="noreferrer" aria-label="Share on LinkedIn"><Linkedin size={19} /></a>
                  <a href={`mailto:?subject=${shareText}&body=${encodeURIComponent(shareUrl)}`} aria-label="Share by email"><Mail size={19} /></a>
                </div>
                <label className="field-label" htmlFor="share-link" style={{ fontSize: 12, fontWeight: 600 }}>Shareable link (never expires)</label>
                <div className="share-link">
                  <input id="share-link" readOnly value={shareUrl} onFocus={(event) => event.currentTarget.select()} />
                  <button type="button" onClick={() => copy(shareUrl, "share")} aria-label="Copy link">{copied === "share" ? <CircleCheck size={16} color="var(--teal)" /> : <Copy size={16} />}</button>
                </div>
              </>
            )}
          </section>}

          {job.media_type !== "audio" && features.youtube !== false && (
            <section className="card card-pad" aria-labelledby="youtube-title">
              <h2 id="youtube-title" style={{ display: "flex", gap: 8, alignItems: "center" }}><Youtube size={20} color="#ff0000" />Publish to YouTube</h2>
              {job.youtube?.status === "published" ? (
                <p className="card-sub" style={{ marginTop: 8 }}>Published ({job.youtube.privacy}). <a className="link" href={job.youtube.url} target="_blank" rel="noreferrer">Open on YouTube</a></p>
              ) : job.youtube?.status === "uploading" ? (
                <p className="card-sub" style={{ marginTop: 8 }}><LoaderCircle size={14} className="spin" style={{ display: "inline", verticalAlign: "-2px" }} /> Uploading to your channel…</p>
              ) : !youtube?.configured ? (
                <p className="card-sub" style={{ marginTop: 8 }}>YouTube publishing isn&apos;t set up on this server yet.</p>
              ) : !youtube.connected ? (
                <p className="card-sub" style={{ marginTop: 8 }}><Link href="/settings#integrations" className="link">Connect your channel</Link> to upload dubs with their translated title and hashtags.</p>
              ) : (
                <div className="form-stack" style={{ marginTop: 12, gap: 10 }}>
                  {job.youtube?.status === "failed" && <p className="form-error">{job.youtube.error}</p>}
                  <p className="card-sub">Uploads to <b>{youtube.channel}</b> as a separate video in {target}.</p>
                  <div className="select-wrap">
                    <select className="select" aria-label="Which version" value={ytOutput} onChange={(event) => setYtOutput(event.target.value)}>
                      {job.outputs.filter((output) => ["video", "captioned", "format", "lipsync"].includes(output.kind)).map((output) => (
                        <option key={`${output.kind}-${output.aspect}`} value={output.kind === "format" ? `format:${output.aspect}` : output.kind}>{output.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="select-wrap">
                    <select className="select" aria-label="Visibility" value={ytPrivacy} onChange={(event) => setYtPrivacy(event.target.value)}>
                      <option value="private">Private</option>
                      <option value="unlisted">Unlisted</option>
                      <option value="public">Public</option>
                    </select>
                  </div>
                  <button type="button" className="btn btn-primary" onClick={publish} disabled={busy === "youtube"}><Youtube size={16} />Publish</button>
                </div>
              )}
            </section>
          )}

          {job.media_type !== "audio" && features.youtube_languages !== false && youtube?.configured && (
            <section className="card card-pad" aria-labelledby="yt-language-title">
              <h2 id="yt-language-title" style={{ display: "flex", gap: 8, alignItems: "center" }}><Clapperboard size={19} />Add {target} to a video already on YouTube</h2>
              <p className="card-sub" style={{ marginTop: 6 }}>Keep all your views on one video: we add {target} subtitles and a translated title and description to your original upload.</p>
              {!youtube.connected ? (
                <p className="card-sub" style={{ marginTop: 8 }}><Link href="/settings#integrations" className="link">Connect your channel</Link> first.</p>
              ) : ytVideos === null ? (
                <button type="button" className="btn btn-outline btn-sm" style={{ marginTop: 12 }} onClick={loadYoutubeVideos}><Youtube size={15} />Choose a video</button>
              ) : (
                <div className="form-stack" style={{ marginTop: 12, gap: 10 }}>
                  <div className="select-wrap">
                    <select className="select" aria-label="Your YouTube video" value={ytVideo} onChange={(event) => setYtVideo(event.target.value)}>
                      {ytVideos.map((video) => <option key={video.id} value={video.id}>{video.title}</option>)}
                    </select>
                  </div>
                  <button type="button" className="btn btn-primary btn-sm" disabled={!ytVideo || busy === "yt-language"} onClick={addToExistingVideo}>{busy === "yt-language" ? "Adding…" : `Add ${target} subtitles & title`}</button>
                </div>
              )}
              {ytLanguageError && <p className="form-error">{ytLanguageError}</p>}
              {job.youtube_languages.length > 0 && (
                <ul className="simple-list" style={{ marginTop: 10 }}>
                  {job.youtube_languages.map((item) => <li key={item.video_id}><span><CircleCheck size={14} color="var(--teal)" /> Added to <a className="link" href={`https://youtu.be/${item.video_id}`} target="_blank" rel="noreferrer">{item.title}</a></span></li>)}
                </ul>
              )}
              {!subtitlesOnly && dubbedAudio?.download_url && (
                <details className="yt-audio-howto">
                  <summary>Add the dubbed voice as an audio track too</summary>
                  <ol>
                    <li><a className="link" href={dubbedAudio.download_url} download>Download the dubbed audio (MP3)</a>.</li>
                    <li>Open YouTube Studio → <b>Languages</b> → your video → <b>Add language</b> → {target}.</li>
                    <li>Under <b>Dub</b>, choose <b>Add</b> and upload the MP3. YouTube lets viewers switch to it from the settings menu.</li>
                  </ol>
                  <small>YouTube only accepts audio tracks through YouTube Studio, and the feature may not be on every channel yet.</small>
                </details>
              )}
            </section>
          )}

          {!subtitlesOnly && features.saved_voices !== false && <section className="tip-card">
            <span><Mic size={15} />SAVE THIS VOICE</span>
            {voiceSlots && voiceSlots.limit > 0 ? (
              <>
                <p>Reuse this speaker&apos;s cloned voice on every future video for a consistent sound ({voiceSlots.used}/{voiceSlots.limit} saved).</p>
                {job.speakers && job.speakers.length > 1 ? (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {job.speakers.map((speaker) => <button key={speaker.id} type="button" className="btn btn-sm btn-yellow" disabled={busy === "voice" || voiceSlots.used >= voiceSlots.limit || job.files_expired} onClick={() => saveVoice(speaker.id)}>Save {speaker.label}</button>)}
                  </div>
                ) : (
                  <button type="button" className="btn btn-sm btn-yellow" disabled={busy === "voice" || voiceSlots.used >= voiceSlots.limit || job.files_expired} onClick={() => saveVoice()}>{busy === "voice" ? "Saving…" : "Save voice"}</button>
                )}
              </>
            ) : (
              <><p>Keep your cloned voice and reuse it on every video.</p><Link href="/billing">Available on Creator &amp; Studio</Link></>
            )}
          </section>}

          <section className="tip-card">
            <span><Globe size={15} />PRO TIP</span>
            <p>Reach more audiences: pick <b>several target languages</b> on your next upload and we&apos;ll transcribe once and dub them all.</p>
            <Link href="/billing">Compare plans</Link>
          </section>

          <button type="button" className="btn btn-outline danger-btn" onClick={remove} disabled={busy === "delete"}><Trash2 size={16} />Delete project</button>
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
                {item.output_video_url && item.media_type !== "audio" && <video src={`${item.output_video_url}#t=1`} preload="metadata" muted playsInline aria-hidden="true" />}
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
