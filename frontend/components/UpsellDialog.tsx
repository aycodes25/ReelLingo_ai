"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { CreditCard, Scissors, Sparkles, X } from "lucide-react";
import type { ApiError } from "@/lib/api";
import { formatMinutes } from "@/lib/format";

interface UpsellDialogProps {
  error: ApiError | null;
  onClose: () => void;
  onTrim?: () => void;
  busy?: boolean;
}

/** Explains why an upload was refused and offers the ways forward: trim, buy minutes, or upgrade. */
export default function UpsellDialog({ error, onClose, onTrim, busy }: UpsellDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (error && !dialog.open) dialog.showModal();
    if (!error && dialog.open) dialog.close();
  }, [error]);

  const code = error?.code;
  const maxMinutes = Number(error?.data.max_video_minutes || 0);
  const affordable = Number(error?.data.affordable_seconds || 0);
  const canTrim = (code === "too_long" || code === "minutes") && Boolean(error?.data.can_trim) && onTrim;
  const title = code === "too_long" ? "This video is longer than your plan allows"
    : code === "minutes" ? "Not enough minutes left"
      : code === "free_paused" ? "Free dubbing is paused for now"
        : code === "targets" ? "Too many languages for your plan"
          : "This feature needs an upgrade";
  const trimLabel = code === "too_long"
    ? `Dub the first ${maxMinutes} minutes`
    : `Dub the first ${Math.floor(affordable / 60)}:${String(affordable % 60).padStart(2, "0")}`;

  return (
    <dialog ref={ref} className="modal" onClose={onClose} aria-labelledby="upsell-title">
      <div className="modal-head">
        <h2 id="upsell-title">{title}</h2>
        <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}><X size={18} /></button>
      </div>
      <p className="modal-text">{error?.message}</p>
      <div className="upsell-options">
        {canTrim && (
          <button type="button" className="upsell-option" onClick={onTrim} disabled={busy}>
            <Scissors size={20} />
            <span><strong>{trimLabel}</strong><small>Uses only the minutes you have. The rest of the video is skipped.</small></span>
          </button>
        )}
        {(code === "minutes" || code === "too_long" || code === "free_paused") && (
          <Link href="/billing#payg" className="upsell-option">
            <CreditCard size={20} />
            <span>
              <strong>Buy extra minutes</strong>
              <small>{code === "minutes" && error?.data.needed ? `This video needs ${formatMinutes(Number(error.data.needed))}. ` : ""}Minute packs never expire. No subscription needed.</small>
            </span>
          </Link>
        )}
        <Link href="/billing" className="upsell-option is-primary">
          <Sparkles size={20} />
          <span><strong>Upgrade your plan</strong><small>More minutes every month, longer videos, more languages and voice cloning.</small></span>
        </Link>
      </div>
    </dialog>
  );
}
