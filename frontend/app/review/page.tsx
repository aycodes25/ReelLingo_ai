"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CircleAlert, CircleCheck, ClipboardCheck, LoaderCircle, Wallet } from "lucide-react";
import AppShell from "@/components/AppShell";
import { claimReview, getReviewerHome, releaseReview } from "@/lib/api";
import { clock, formatMoney } from "@/lib/format";
import type { ReviewerHome, ReviewTask } from "@/lib/types";

const STATUS: Record<ReviewTask["status"], string> = {
  open: "Waiting", claimed: "In progress", submitted: "Done · payment due", paid: "Paid", expired: "Expired",
};

/** Native-speaker reviewers: pick up projects in your languages, correct them, and see what you've earned. */
export default function ReviewPage() {
  const router = useRouter();
  const [home, setHome] = useState<ReviewerHome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const load = useCallback(() => {
    getReviewerHome().then(setHome).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load reviews."));
  }, []);

  useEffect(() => {
    load();
    setSubmitted(new URLSearchParams(window.location.search).get("submitted") === "1");
  }, [load]);

  async function claim(task: ReviewTask) {
    setBusy(task.id);
    try {
      await claimReview(task.id);
      router.push(`/jobs/${task.job_id}/edit?task=${task.id}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not pick up this review.");
      setBusy(null);
      load();
    }
  }

  async function release(task: ReviewTask) {
    if (!window.confirm("Hand this review back so another reviewer can take it?")) return;
    setBusy(task.id);
    try {
      await releaseReview(task.id);
      load();
    } finally {
      setBusy(null);
    }
  }

  const inProgress = home?.mine.filter((task) => task.status === "claimed") || [];
  const history = home?.mine.filter((task) => task.status !== "claimed") || [];

  return (
    <AppShell crumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Reviews" }]}>
      <div className="page-head">
        <div>
          <h1><ClipboardCheck size={26} style={{ display: "inline", verticalAlign: "-4px" }} /> Reviews</h1>
          <p>Check transcripts and translations in your languages before they&apos;re voiced. You earn {home ? formatMoney(home.earnings.rate_ngn_per_minute, "NGN") : "…"} per minute of video.</p>
        </div>
      </div>

      {submitted && <div role="status" className="alert alert-success" style={{ marginBottom: 20 }}><CircleCheck size={16} /><span>Thank you! Your review was submitted and the project is continuing.</span></div>}
      {error && <div role="alert" className="alert alert-error" style={{ marginBottom: 20 }}><CircleAlert size={16} /><span>{error}</span></div>}

      {!home && !error ? <div className="skeleton" style={{ height: 240 }} /> : home && (
        <>
          <div className="stat-row">
            <div className="card card-pad"><span className="eyebrow">YOUR LANGUAGES</span><strong>{home.reviewer.languages.join(", ").toUpperCase() || "—"}</strong></div>
            <div className="card card-pad"><span className="eyebrow">REVIEWS DONE</span><strong>{home.earnings.reviews}</strong></div>
            <div className="card card-pad"><span className="eyebrow"><Wallet size={13} /> OWED TO YOU</span><strong>{formatMoney(home.earnings.owed_ngn, "NGN")}</strong></div>
            <div className="card card-pad"><span className="eyebrow">PAID SO FAR</span><strong>{formatMoney(home.earnings.paid_ngn, "NGN")}</strong></div>
          </div>

          {inProgress.length > 0 && (
            <section className="section-block">
              <h2>In progress</h2>
              <ul className="simple-list">
                {inProgress.map((task) => (
                  <li key={task.id}>
                    <span><b>{task.job?.original_filename || `Project #${task.job_id}`}</b><small> · {task.language_name} · {task.minutes} min · {formatMoney(task.payout_ngn, "NGN")}</small></span>
                    <span style={{ display: "flex", gap: 8 }}>
                      <Link className="btn btn-primary btn-sm" href={`/jobs/${task.job_id}/edit?task=${task.id}`}>Continue</Link>
                      <button type="button" className="btn btn-outline btn-sm" disabled={busy === task.id} onClick={() => release(task)}>Hand back</button>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="section-block">
            <h2>Waiting for a reviewer</h2>
            {home.open.length ? (
              <ul className="simple-list">
                {home.open.map((task) => (
                  <li key={task.id}>
                    <span>
                      <b>{task.language_name}</b>
                      <small> · {task.job?.duration_seconds ? clock(task.job.duration_seconds) : `${task.minutes} min`} · {task.job?.lines ?? 0} lines · you earn {formatMoney(task.payout_ngn, "NGN")}</small>
                    </span>
                    <button type="button" className="btn btn-primary btn-sm" disabled={busy === task.id} onClick={() => claim(task)}>
                      {busy === task.id ? <LoaderCircle size={14} className="spin" /> : null}Pick up
                    </button>
                  </li>
                ))}
              </ul>
            ) : <p className="card-sub">Nothing is waiting in your languages right now. Check back later.</p>}
          </section>

          {history.length > 0 && (
            <section className="section-block">
              <h2>History</h2>
              <div className="table-wrap">
                <table className="data-table">
                  <thead><tr><th>Submitted</th><th>Language</th><th>Minutes</th><th>Earned</th><th>Status</th></tr></thead>
                  <tbody>
                    {history.map((task) => (
                      <tr key={task.id}>
                        <td>{task.submitted_at ? new Date(task.submitted_at).toLocaleDateString() : "—"}</td>
                        <td>{task.language_name}</td>
                        <td>{task.minutes}</td>
                        <td>{formatMoney(task.payout_ngn, "NGN")}</td>
                        <td>{STATUS[task.status]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </AppShell>
  );
}
