"use client";

import { useEffect, useState } from "react";
import { Check, LoaderCircle } from "lucide-react";
import Loader3D from "@/components/Loader3D";
import WaitingMusic from "@/components/WaitingMusic";
import type { WaitingMusicSettings } from "@/lib/types";

// What happens between pressing Start and the progress page. The server does these one after the other in a single
// request, so the steps below walk through them as time passes; the clock shows how long it has really been.
const STEPS = [
  "Checking your video",
  "Saving it securely",
  "Making sure you have enough minutes",
  "Getting your project ready",
];

/** Shown after the upload finishes, while the server gets the project going, so the wait never looks like a freeze. */
export default function LaunchPanel({ fromUpload, music }: { fromUpload: boolean; music?: WaitingMusicSettings }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const active = Math.min(STEPS.length - 1, Math.floor(seconds / 3));

  return (
    <div className="launch-panel" role="status" aria-live="polite">
      <Loader3D label="Getting your project ready" />
      <div className="launch-copy">
        <strong>{fromUpload ? "Upload complete. Getting your project ready…" : "Getting your project ready…"}</strong>
        <ul>
          {STEPS.map((step, index) => (
            <li key={step} className={index < active ? "is-done" : index === active ? "is-active" : ""}>
              {index < active ? <Check size={14} /> : index === active ? <LoaderCircle size={14} className="spin" /> : <i />}
              {step}
            </li>
          ))}
        </ul>
        <div className="progress-track is-indeterminate"><i /></div>
        <small>{seconds < 20 ? "This usually takes a few seconds." : `Still working (${seconds}s). Larger videos take longer. Please keep this page open.`}</small>
        <WaitingMusic settings={music} />
      </div>
    </div>
  );
}
