"use client";

import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { Clapperboard, Maximize, Pause, Play } from "lucide-react";
import { clock } from "@/lib/format";

export interface VideoPlayerHandle {
  seek: (seconds: number) => void;
}

interface VideoPlayerProps {
  src: string | null;
  label: string;
  onTimeChange?: (seconds: number) => void;
}

const VideoPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>(function VideoPlayer({ src, label, onTimeChange }, ref) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [resolution, setResolution] = useState<string | null>(null);

  useImperativeHandle(ref, () => ({
    seek(seconds: number) {
      const video = videoRef.current;
      if (!video) return;
      video.currentTime = seconds;
      void video.play();
    },
  }));

  function toggle() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play();
    else video.pause();
  }

  if (!src) {
    return (
      <div className="player"><div className="player-empty"><Clapperboard size={32} /><span>Video preview is unavailable.</span></div></div>
    );
  }

  const percent = duration ? (time / duration) * 100 : 0;

  return (
    <div className="player">
      <video
        ref={videoRef}
        src={src}
        playsInline
        preload="metadata"
        onClick={toggle}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(event) => { setTime(event.currentTarget.currentTime); onTimeChange?.(event.currentTarget.currentTime); }}
        onLoadedMetadata={(event) => {
          const video = event.currentTarget;
          setDuration(video.duration);
          if (video.videoHeight) setResolution(video.videoHeight >= 1080 ? `${video.videoHeight}P HD` : `${video.videoHeight}P`);
        }}
      />
      <span className="player-tag is-left">{label}</span>
      {resolution && <span className="player-tag is-right">{resolution}</span>}
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
        <button type="button" className="icon-btn" style={{ color: "#fff" }} aria-label="Full screen" onClick={() => void videoRef.current?.requestFullscreen?.()}><Maximize size={18} /></button>
      </div>
    </div>
  );
});

export default VideoPlayer;
