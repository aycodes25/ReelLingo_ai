"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Clapperboard, Maximize, Pause, Play } from "lucide-react";
import { clock } from "@/lib/format";

export interface VideoPlayerHandle {
  seek: (seconds: number) => void;
}

interface VideoPlayerProps {
  src: string | null;
  label: string;
  onTimeChange?: (seconds: number) => void;
  /** The original upload. When set, viewers can flip between the dub and the original audio at the same moment. */
  compareSrc?: string | null;
  compareLabel?: string;
  captionsSrc?: string | null;
  captionsLang?: string;
  audioOnly?: boolean;
}

const VideoPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>(function VideoPlayer(
  { src, label, onTimeChange, compareSrc = null, compareLabel = "Original", captionsSrc = null, captionsLang = "en", audioOnly = false },
  ref,
) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const originalRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [resolution, setResolution] = useState<string | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);

  useImperativeHandle(ref, () => ({
    seek(seconds: number) {
      const video = videoRef.current;
      if (!video) return;
      video.currentTime = seconds;
      void video.play();
    },
  }));

  // The original plays silently alongside the dub; switching just swaps which one is audible.
  useEffect(() => {
    const video = videoRef.current;
    const original = originalRef.current;
    if (!video) return;
    video.muted = showOriginal;
    if (original) {
      original.muted = !showOriginal;
      original.currentTime = video.currentTime;
      if (!video.paused) void original.play().catch(() => undefined);
    }
  }, [showOriginal]);

  function syncOriginal(action?: "play" | "pause") {
    const video = videoRef.current;
    const original = originalRef.current;
    if (!video || !original) return;
    if (Math.abs(original.currentTime - video.currentTime) > 0.25) original.currentTime = video.currentTime;
    if (action === "play") void original.play().catch(() => undefined);
    if (action === "pause") original.pause();
  }

  function toggle() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play();
    else video.pause();
  }

  if (!src) {
    return (
      <div className="player"><div className="player-empty"><Clapperboard size={32} /><span>Preview is unavailable.</span></div></div>
    );
  }

  const percent = duration ? (time / duration) * 100 : 0;

  return (
    <div className={`player ${audioOnly ? "is-audio" : ""}`}>
      <video
        ref={videoRef}
        src={src}
        playsInline
        preload="metadata"
        crossOrigin={captionsSrc ? "anonymous" : undefined}
        onClick={toggle}
        onPlay={() => { setPlaying(true); syncOriginal("play"); }}
        onPause={() => { setPlaying(false); syncOriginal("pause"); }}
        onSeeked={() => syncOriginal()}
        onTimeUpdate={(event) => { setTime(event.currentTarget.currentTime); onTimeChange?.(event.currentTarget.currentTime); syncOriginal(); }}
        onLoadedMetadata={(event) => {
          const video = event.currentTarget;
          setDuration(video.duration);
          if (video.videoHeight) setResolution(video.videoHeight >= 1080 ? `${video.videoHeight}P HD` : `${video.videoHeight}P`);
        }}
      >
        {captionsSrc && <track kind="subtitles" src={captionsSrc} srcLang={captionsLang} label="Subtitles" />}
      </video>
      {compareSrc && <video ref={originalRef} src={compareSrc} preload="auto" playsInline muted aria-hidden="true" className="visually-hidden" />}
      <span className="player-tag is-left">{showOriginal ? compareLabel : label}</span>
      {resolution && !audioOnly && <span className="player-tag is-right">{resolution}</span>}
      {compareSrc && (
        <div className="compare-toggle" role="group" aria-label="Choose which audio to hear">
          <button type="button" aria-pressed={!showOriginal} className={!showOriginal ? "is-on" : ""} onClick={() => setShowOriginal(false)}>Dub</button>
          <button type="button" aria-pressed={showOriginal} className={showOriginal ? "is-on" : ""} onClick={() => setShowOriginal(true)}>Original</button>
        </div>
      )}
      <div className="player-bar">
        <button type="button" className="play-btn" onClick={toggle} aria-label={playing ? "Pause" : "Play"}>
          {playing ? <Pause size={22} fill="currentColor" /> : <Play size={22} style={{ marginLeft: 3 }} />}
        </button>
        <div className="player-timeline">
          <div className="player-times"><span>{clock(time)}</span><span>{clock(duration)}</span></div>
          <input
            type="range"
            className="player-seek"
            min={0}
            max={duration || 0}
            step={0.1}
            value={time}
            aria-label="Seek"
            style={{ ["--pct" as string]: `${percent}%` }}
            onChange={(event) => { if (videoRef.current) videoRef.current.currentTime = Number(event.target.value); }}
          />
        </div>
        {!audioOnly && <button type="button" className="icon-btn" style={{ color: "#fff" }} aria-label="Full screen" onClick={() => void videoRef.current?.requestFullscreen?.()}><Maximize size={18} /></button>}
      </div>
    </div>
  );
});

export default VideoPlayer;
