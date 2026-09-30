"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { CreditCard, Scissors, Sparkles, X } from "lucide-react";
import type { ApiError } from "@/lib/api";

interface UpsellDialogProps {
  error: ApiError | null;
  onClose: () => void;
  onTrim?: () => void;
  busy?: boolean;
}

/** Explains why an upload was refused by the plan and offers the ways forward: trim, buy a credit, or upgrade. */
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
  const canTrim = code === "too_long" && Boolean(error?.data.can_trim) && onTrim;
  const title = code === "too_long" ? "This video is longer than your plan allows"
    : code === "quota" ? "You've used this month's videos"
      : code === "targets" ? "Too many languages for your plan"
        : "This feature needs an upgrade";

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
            <span><strong>Dub the first {maxMinutes} minutes</strong><small>Uses one video from your plan. The rest of the video is skipped.</small></span>
          </button>
        )}
        {(code === "too_long" || code === "quota") && (
          <Link href="/billing#payg" className="upsell-option">
            <CreditCard size={20} />
            <span><strong>Buy a pay-as-you-go credit</strong><small>One video up to 5, 15, 30 or 60 minutes. No subscription needed.</small></span>
          </Link>
        )}
        <Link href="/billing" className="upsell-option is-primary">
          <Sparkles size={20} />
          <span><strong>Upgrade your plan</strong><small>More videos, longer videos, more languages and voice cloning.</small></span>
        </Link>
      </div>
    </dialog>
  );
}
