"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Music, VolumeX } from "lucide-react";
import type { WaitingMusicSettings } from "@/lib/types";

const PREFERENCE_KEY = "reellingo_waiting_music";

function readPreference(): "on" | "off" | null {
  try {
    const value = window.localStorage.getItem(PREFERENCE_KEY);
    return value === "on" || value === "off" ? value : null;
  } catch {
    return null;
  }
}

function savePreference(value: "on" | "off") {
  try {
    window.localStorage.setItem(PREFERENCE_KEY, value);
  } catch {
    // Storage blocked: the choice lasts for this page only.
  }
}

export interface Player {
  stop: () => void;
}

// Chords as note frequencies (Hz). "calm" is a slow, warm minor progression; "uplifting" is brighter and a little quicker.
const PROGRESSIONS = {
  calm: { seconds: 9, cutoff: 900, chords: [[110, 164.81, 220, 261.63, 329.63], [87.31, 130.81, 174.61, 220, 261.63], [65.41, 130.81, 196, 261.63, 329.63], [98, 146.83, 196, 246.94, 293.66]], bells: [440, 523.25, 587.33, 659.25, 783.99] },
  uplifting: { seconds: 6, cutoff: 1800, chords: [[130.81, 196, 261.63, 329.63, 392], [98, 196, 246.94, 293.66, 392], [110, 220, 261.63, 329.63, 440], [87.31, 174.61, 220, 261.63, 349.23]], bells: [523.25, 659.25, 783.99, 880, 1046.5] },
} as const;

/**
 * Generated music: soft pads and the occasional bell, made with the browser's own audio engine. There is no file to
 * download, nothing to license, and it can't fail to load. Returns null if the browser can't play audio.
 */
export function startGeneratedMusic(style: "calm" | "uplifting", volume: number): Player | null {
  const Context = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Context) return null;
  const context = new Context();
  const { seconds, cutoff, chords, bells } = PROGRESSIONS[style] || PROGRESSIONS.calm;

  const master = context.createGain();
  master.gain.value = 0;
  master.connect(context.destination);
  const filter = context.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = cutoff;
  const echo = context.createDelay(1.5);
  echo.delayTime.value = 0.55;
  const feedback = context.createGain();
  feedback.gain.value = 0.38;
  echo.connect(feedback);
  feedback.connect(echo);
  filter.connect(master);
  filter.connect(echo);
  echo.connect(master);
  master.gain.linearRampToValueAtTime(Math.min(1, Math.max(0, volume)) * 0.5, context.currentTime + 3);

  const note = (frequency: number, start: number, length: number, level: number, type: OscillatorType) => {
    for (const detune of [-6, 6]) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = type;
      oscillator.frequency.value = frequency;
      oscillator.detune.value = detune;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(level, start + Math.min(2.5, length * 0.35));
      gain.gain.linearRampToValueAtTime(0, start + length);
      oscillator.connect(gain);
      gain.connect(filter);
      oscillator.start(start);
      oscillator.stop(start + length + 0.1);
    }
  };

  let chord = 0;
  const playChord = () => {
    const at = context.currentTime + 0.05;
    for (const frequency of chords[chord % chords.length]) note(frequency, at, seconds + 3, 0.05, "sine");
    // A few soft bells over the top, at gentle random moments.
    for (let index = 0; index < 3; index += 1) {
      const frequency = bells[Math.floor(Math.random() * bells.length)];
      note(frequency, at + 1 + Math.random() * (seconds - 2), 3.5, 0.03, "triangle");
    }
    chord += 1;
  };
  playChord();
  const timer = window.setInterval(playChord, seconds * 1000);

  return {
    stop: () => {
      window.clearInterval(timer);
      master.gain.cancelScheduledValues(context.currentTime);
      master.gain.setValueAtTime(master.gain.value, context.currentTime);
      master.gain.linearRampToValueAtTime(0, context.currentTime + 0.6);
      window.setTimeout(() => void context.close().catch(() => undefined), 800);
    },
  };
}

/** The admin's own track, looped. */
function startTrack(url: string, volume: number): Player | null {
  const audio = new Audio(url);
  audio.loop = true;
  audio.volume = Math.min(1, Math.max(0, volume));
  void audio.play().catch(() => undefined);
  return { stop: () => { audio.pause(); audio.src = ""; } };
}

/**
 * A small "play some calm music while you wait" button. The admin switches it on or off, chooses the style and volume,
 * and can set their own track (Admin → App settings). People can always turn it off, and we remember their choice.
 */
export default function WaitingMusic({ settings, className = "" }: { settings?: WaitingMusicSettings; className?: string }) {
  const [playing, setPlaying] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const player = useRef<Player | null>(null);

  const stop = useCallback(() => {
    player.current?.stop();
    player.current = null;
    setPlaying(false);
  }, []);

  const start = useCallback((fromClick: boolean) => {
    if (!settings?.enabled || player.current) return;
    // Browsers only allow sound after the person has clicked or tapped something on the site.
    const allowed = fromClick || (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive;
    if (!allowed) {
      setBlocked(true);
      return;
    }
    const started = settings.url ? startTrack(settings.url, settings.volume) : startGeneratedMusic(settings.style === "uplifting" ? "uplifting" : "calm", settings.volume);
    if (!started) return;
    player.current = started;
    setBlocked(false);
    setPlaying(true);
  }, [settings]);

  // Start by itself only when the person (or the admin's default) says so.
  useEffect(() => {
    if (!settings?.enabled) return undefined;
    const preference = readPreference();
    if (preference === "on" || (preference === null && settings.autoplay)) start(false);
    return stop;
  }, [settings, start, stop]);

  if (!settings?.enabled) return null;
  const label = playing ? "Turn the music off" : blocked ? "Tap to play calm music" : "Play calm music while you wait";
  return (
    <button
      type="button"
      className={`music-btn ${playing ? "is-playing" : ""} ${className}`}
      aria-pressed={playing}
      aria-label={label}
      onClick={() => {
        if (playing) {
          savePreference("off");
          stop();
        } else {
          savePreference("on");
          start(true);
        }
      }}
    >
      {playing ? <VolumeX size={15} /> : <Music size={15} />}
      <span>{playing ? "Music on" : blocked ? "Tap to play music" : "Play music while you wait"}</span>
      {playing && <i className="music-bars" aria-hidden="true"><b /><b /><b /></i>}
    </button>
  );
}
