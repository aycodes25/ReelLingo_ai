"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { ChevronDown, CircleAlert, RotateCcw } from "lucide-react";
import AppShell from "@/components/AppShell";
import { adminGrantCredit, adminRetryJob, adminSetPlan, getAdminJobs, getAdminOverview } from "@/lib/api";
import { formatMoney, relativeTime } from "@/lib/format";
import type { AdminJob, AdminOverview } from "@/lib/types";

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="stat-tile">
      <span>{label}</span>
      <strong>{value}</strong>
      {hint && <small>{hint}</small>}
    </div>
  );
}

export default function AdminPage() {
  const [days, setDays] = useState(30);
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [jobs, setJobs] = useState<AdminJob[] | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [grant, setGrant] = useState({ billingId: "", minutes: "10", plan: "creator", months: "1" });

  const load = useCallback(() => {
    getAdminOverview(days).then(setOverview).catch((loadError: unknown) => setError(loadError instanceof Error ? loadError.message : "Could not load."));
    getAdminJobs(status).then(setJobs).catch(() => setJobs([]));
  }, [days, status]);

  useEffect(load, [load]);

  async function act(task: () => Promise<unknown>, success: string) {
    setError(null);
    try {
      await task();
      setNotice(success);
      load();
    } catch (taskError) {
      setError(taskError instanceof Error ? taskError.message : "Action failed.");
    }
  }

  function grantCredit(event: FormEvent) {
    event.preventDefault();
    void act(() => adminGrantCredit(grant.billingId.trim(), Number(grant.minutes)), `Granted a ${grant.minutes}-minute credit to ${grant.billingId}.`);
  }

  function setPlan(event: FormEvent) {
    event.preventDefault();
    void act(() => adminSetPlan(grant.billingId.trim(), grant.plan, Number(grant.months)), `Set ${grant.billingId} to ${grant.plan} for ${grant.months} month(s).`);
  }

  const maxCost = Math.max(...(overview?.costs.by_operation.map((row) => row.cost_usd) || [0]), 0.0001);

  return (
    <AppShell crumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Admin" }]}>
      <div className="page-head">
        <div>
          <h1>Admin overview</h1>
          <p>Volume, reliability and unit economics. Provider costs are estimates from the rates in backend config.</p>
        </div>
        <div className="select-wrap" style={{ width: 160 }}>
          <select className="select" value={days} onChange={(event) => setDays(Number(event.target.value))} aria-label="Time range">
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
          <ChevronDown size={16} />
        </div>
      </div>

      {error && <div role="alert" className="alert alert-error" style={{ marginBottom: 20 }}><CircleAlert size={16} /><span>{error}</span></div>}
      {notice && <div role="status" className="alert alert-success" style={{ marginBottom: 20 }}><span>{notice}</span></div>}

      {overview ? (
        <>
          <div className="stat-grid">
            <Stat label="Jobs" value={overview.jobs.total.toLocaleString()} hint={`${overview.jobs.minutes_processed.toLocaleString()} minutes of media`} />
            <Stat label="Failure rate" value={`${(overview.jobs.failure_rate * 100).toFixed(1)}%`} hint={`${overview.jobs.by_status.failed || 0} failed · ${overview.jobs.by_status.done || 0} done`} />
            <Stat label="Median processing" value={overview.processing_seconds ? `${Math.round(overview.processing_seconds.median / 60)} min` : "—"} hint={overview.processing_seconds ? `p90 ${Math.round(overview.processing_seconds.p90 / 60)} min` : undefined} />
            <Stat label="Provider spend" value={formatMoney(overview.costs.total_usd, "USD")} hint={overview.costs.per_done_job_usd !== null ? `${formatMoney(overview.costs.per_done_job_usd, "USD")} per finished job` : undefined} />
            <Stat label="Revenue (est.)" value={formatMoney(overview.revenue.estimated_usd, "USD")} hint={overview.revenue.by_currency.map((row) => formatMoney(row.amount, row.currency)).join(" + ") || "No payments"} />
            <Stat label="Gross margin (est.)" value={formatMoney(overview.revenue.margin_usd, "USD")} hint={overview.costs.per_minute_usd !== null ? `${formatMoney(overview.costs.per_minute_usd, "USD")} cost per media minute` : undefined} />
          </div>

          <div className="settings-grid" style={{ marginTop: 24 }}>
            <section className="card card-pad">
              <h2>Spend by operation</h2>
              <ul className="bar-list">
                {overview.costs.by_operation.map((row) => (
                  <li key={`${row.provider}-${row.operation}`}>
                    <div><span>{row.provider} · {row.operation}</span><b>{formatMoney(row.cost_usd, "USD")}</b></div>
                    <div className="bar"><i style={{ width: `${(row.cost_usd / maxCost) * 100}%` }} /></div>
                  </li>
                ))}
                {!overview.costs.by_operation.length && <li className="card-sub">No provider calls recorded yet.</li>}
              </ul>
            </section>
            <section className="card card-pad">
              <h2>Top errors</h2>
              <ul className="simple-list">
                {overview.top_errors.map((row) => <li key={row.message}><span>{row.message}</span><b>{row.count}</b></li>)}
                {!overview.top_errors.length && <li className="card-sub">No failures. 🎉</li>}
              </ul>
            </section>
            <section className="card card-pad">
              <h2>Credits &amp; plans</h2>
              <p className="card-sub">Billing ID is a user ID, or <code>team:&lt;id&gt;</code> for a team.</p>
              <form className="form-stack" style={{ gap: 10, marginTop: 12 }} onSubmit={grantCredit}>
                <input className="input input-plain" required placeholder="Billing ID" value={grant.billingId} onChange={(event) => setGrant({ ...grant, billingId: event.target.value })} aria-label="Billing ID" />
                <div className="inline-form" style={{ margin: 0 }}>
                  <input className="input input-plain" type="number" min={1} value={grant.minutes} onChange={(event) => setGrant({ ...grant, minutes: event.target.value })} aria-label="Credit minutes" />
                  <button type="submit" className="btn btn-outline">Grant credit</button>
                </div>
              </form>
              <form className="inline-form" onSubmit={setPlan}>
                <div className="select-wrap"><select className="select" value={grant.plan} onChange={(event) => setGrant({ ...grant, plan: event.target.value })} aria-label="Plan"><option value="starter">Starter</option><option value="creator">Creator</option><option value="studio">Studio</option></select><ChevronDown size={16} /></div>
                <input className="input input-plain" type="number" min={1} max={24} value={grant.months} onChange={(event) => setGrant({ ...grant, months: event.target.value })} aria-label="Months" style={{ maxWidth: 80 }} />
                <button type="submit" className="btn btn-outline" disabled={!grant.billingId}>Set plan</button>
              </form>
            </section>
          </div>
        </>
      ) : !error && <div className="skeleton" style={{ height: 200 }} />}

      <div className="section-row" style={{ marginTop: 40 }}>
        <h2>Recent jobs</h2>
        <div className="select-wrap" style={{ width: 170 }}>
          <select className="select" value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filter by status">
            <option value="">All statuses</option>
            <option value="failed">Failed</option>
            <option value="processing">Processing</option>
            <option value="queued">Queued</option>
            <option value="awaiting_review">Awaiting review</option>
            <option value="done">Done</option>
          </select>
          <ChevronDown size={16} />
        </div>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th>#</th><th>User</th><th>Languages</th><th>Status</th><th>Length</th><th>Cost</th><th>Created</th><th /></tr></thead>
          <tbody>
            {(jobs || []).map((job) => (
              <tr key={job.id}>
                <td><Link className="link" href={`/jobs/${job.id}?admin=1`}>{job.id}</Link></td>
                <td title={job.user_id}><code>{job.user_id.slice(0, 10)}</code></td>
                <td>{job.source_language} → {job.target_language}</td>
                <td><span className={`badge badge-${job.status}`}>{job.status}</span>{job.deleted && <span className="badge badge-soft">deleted</span>}{job.error_message && <small className="cell-error" title={job.error_message}>{job.error_message.slice(0, 60)}</small>}</td>
                <td>{job.duration_seconds ? `${(job.duration_seconds / 60).toFixed(1)} min` : "—"}</td>
                <td title={job.costs.items.map((item) => `${item.provider} ${item.operation}: $${item.cost_usd.toFixed(4)}`).join("\n")}>{formatMoney(job.costs.total_usd, "USD")}</td>
                <td>{relativeTime(job.created_at)}</td>
                <td>{job.status === "failed" && <button type="button" className="icon-btn" aria-label={`Retry job ${job.id}`} onClick={() => act(() => adminRetryJob(job.id), `Job ${job.id} requeued.`)}><RotateCcw size={16} /></button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
