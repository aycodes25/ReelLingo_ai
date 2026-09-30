"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronDown, CircleAlert, CircleCheck, LoaderCircle, Mail, MessageCircle, Ticket, Trash2 } from "lucide-react";
import AdminNav from "@/components/AdminNav";
import AppShell from "@/components/AppShell";
import {
  adminDeleteUser, adminEmailUser, adminGrantUserCredits, adminRevokeCredit, adminUpdateUser, getAdminPlans, getAdminUser,
} from "@/lib/api";
import { formatMoney, relativeTime } from "@/lib/format";
import type { AdminPlan, AdminUserDetail, PlanOverrides } from "@/lib/types";

const LIMIT_FIELDS: { key: keyof PlanOverrides; label: string }[] = [
  { key: "videos_per_month", label: "Videos per month" },
  { key: "max_video_minutes", label: "Max minutes per video" },
  { key: "max_targets", label: "Languages per upload" },
  { key: "team_seats", label: "Team seats" },
  { key: "saved_voices", label: "Saved voices" },
  { key: "priority", label: "Queue priority (higher = sooner)" },
];
const FLAG_FIELDS: { key: keyof PlanOverrides; label: string }[] = [
  { key: "voice_clone", label: "Voice cloning" },
  { key: "watermark", label: "Watermark on exports" },
  { key: "lip_sync", label: "Lip-sync" },
  { key: "api_access", label: "API access" },
];

type TriState = "" | "on" | "off";
const fromBool = (value: boolean | undefined): TriState => (value === true ? "on" : value === false ? "off" : "");
const toBool = (value: TriState) => (value === "on" ? true : value === "off" ? false : undefined);

function Section({ title, children, wide = false }: { title: string; children: React.ReactNode; wide?: boolean }) {
  return <section className="card card-pad" style={wide ? { gridColumn: "1 / -1" } : undefined}><h2>{title}</h2><div style={{ marginTop: 14 }}>{children}</div></section>;
}

export default function AdminUserPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const userId = decodeURIComponent(params.id);
  const [user, setUser] = useState<AdminUserDetail | null>(null);
  const [plans, setPlans] = useState<AdminPlan[]>([]);
  const [permissionLabels, setPermissionLabels] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [profile, setProfile] = useState({ name: "", phone: "", admin_notes: "" });
  const [planChoice, setPlanChoice] = useState({ plan: "free", months: 1, no_expiry: false });
  const [limits, setLimits] = useState<Record<string, string>>({});
  const [flags, setFlags] = useState<Record<string, TriState>>({});
  const [permissions, setPermissions] = useState<Record<string, TriState>>({});
  const [credit, setCredit] = useState({ minutes: 10, count: 1 });
  const [email, setEmail] = useState({ subject: "", message: "" });

  const apply = useCallback((detail: AdminUserDetail) => {
    setUser(detail);
    setProfile({ name: detail.name, phone: detail.phone, admin_notes: detail.admin_notes });
    setPlanChoice((current) => ({ ...current, plan: detail.plan.code === "custom" ? "free" : detail.subscription?.tier || "free" }));
    const overrides = detail.subscription?.overrides || {};
    setLimits(Object.fromEntries(LIMIT_FIELDS.map(({ key }) => [key, overrides[key] === undefined ? "" : String(overrides[key])])));
    setFlags(Object.fromEntries(FLAG_FIELDS.map(({ key }) => [key, fromBool(overrides[key] as boolean | undefined)])));
    setPermissions(Object.fromEntries(Object.entries(overrides.permissions || {}).map(([key, value]) => [key, fromBool(value)])));
  }, []);

  useEffect(() => {
    getAdminUser(userId).then(apply).catch((error: unknown) => setMessage({ tone: "error", text: error instanceof Error ? error.message : "Could not load the user." }));
    getAdminPlans().then((result) => { setPlans(result.plans); setPermissionLabels(result.permissions); }).catch(() => undefined);
  }, [userId, apply]);

  async function run(key: string, task: () => Promise<AdminUserDetail | void>, success: string) {
    setBusy(key);
    setMessage(null);
    try {
      const result = await task();
      if (result) apply(result);
      setMessage({ tone: "success", text: success });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Something went wrong." });
    } finally {
      setBusy(null);
    }
  }

  function saveOverrides(clear = false) {
    const overrides: PlanOverrides = {};
    if (!clear) {
      for (const { key } of LIMIT_FIELDS) if (limits[key] !== "" && limits[key] !== undefined) (overrides as Record<string, number>)[key] = Number(limits[key]);
      for (const { key } of FLAG_FIELDS) {
        const value = toBool(flags[key] || "");
        if (value !== undefined) (overrides as Record<string, boolean>)[key] = value;
      }
      const perms: Record<string, boolean> = {};
      for (const [key, value] of Object.entries(permissions)) {
        const parsed = toBool(value);
        if (parsed !== undefined) perms[key] = parsed;
      }
      if (Object.keys(perms).length) overrides.permissions = perms;
    }
    void run("limits", () => adminUpdateUser(userId, { overrides: clear || !Object.keys(overrides).length ? null : overrides }), clear ? "Custom limits removed — the plan's limits apply again." : "Custom limits saved.");
  }

  async function remove() {
    if (!user) return;
    const typed = window.prompt(`This permanently deletes ${user.email}'s account, projects, files, voices and login. Type DELETE to confirm.`);
    if (typed !== "DELETE") return;
    setBusy("delete");
    try {
      await adminDeleteUser(userId);
      router.replace("/admin/users");
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Could not delete." });
      setBusy(null);
    }
  }

  const crumbs = [{ label: "Admin", href: "/admin" }, { label: "Users", href: "/admin/users" }, { label: user?.email || userId }];
  if (!user) {
    return (
      <AppShell crumbs={crumbs}>
        <AdminNav />
        {message ? <div className="alert alert-error"><CircleAlert size={16} /><span>{message.text}</span></div> : <section className="center-state"><span><LoaderCircle size={28} className="spin" /></span><h1>Loading user…</h1></section>}
      </AppShell>
    );
  }

  const whatsapp = user.phone.replace(/\D/g, "");

  return (
    <AppShell crumbs={crumbs}>
      <AdminNav />
      <div className="page-head">
        <div>
          <h1>{user.name || user.email}</h1>
          <p>
            {user.email} · joined {user.created_at ? new Date(user.created_at).toLocaleDateString() : "—"} · last active {user.last_seen_at ? relativeTime(user.last_seen_at).toLowerCase() : "never"}
            {user.is_admin && <span className="badge badge-soft" style={{ marginLeft: 8 }}>Admin</span>}
            {user.disabled && <span className="badge badge-failed" style={{ marginLeft: 8 }}>Suspended</span>}
          </p>
        </div>
        <div className="page-head-actions">
          {whatsapp && <a className="btn btn-outline" href={`https://wa.me/${whatsapp}`} target="_blank" rel="noreferrer"><MessageCircle size={16} />WhatsApp</a>}
          <a className="btn btn-outline" href={`mailto:${user.email}`}><Mail size={16} />Email app</a>
        </div>
      </div>

      {message && <div role={message.tone === "error" ? "alert" : "status"} className={`alert ${message.tone === "error" ? "alert-error" : "alert-success"}`} style={{ marginBottom: 20 }}>{message.tone === "error" ? <CircleAlert size={16} /> : <CircleCheck size={16} />}<span>{message.text}</span></div>}

      <div className="stat-grid" style={{ marginBottom: 24 }}>
        <div className="stat-tile"><span>Plan</span><strong>{user.plan.name}</strong><small>{user.subscription?.current_period_end && user.subscription.tier !== "free" ? `until ${new Date(user.subscription.current_period_end).toLocaleDateString()}` : user.plan.custom ? "with custom limits" : "no expiry"}</small></div>
        <div className="stat-tile"><span>Videos this month</span><strong>{user.usage.videos_this_month} / {user.usage.max_videos_per_month}</strong><small>{user.usage.minutes_this_month} minutes</small></div>
        <div className="stat-tile"><span>Unused credits</span><strong>{user.credits.filter((item) => !item.used_by_job).length}</strong><small>{user.credits.filter((item) => item.used_by_job).length} used</small></div>
        <div className="stat-tile"><span>Provider cost so far</span><strong>{formatMoney(user.total_cost_usd, "USD")}</strong><small>{user.jobs.length} recent projects</small></div>
      </div>

      <div className="settings-grid">
        <Section title="Plan">
          <div className="form-stack" style={{ gap: 10 }}>
            <div className="select-wrap"><select className="select" value={planChoice.plan} onChange={(event) => setPlanChoice({ ...planChoice, plan: event.target.value })} aria-label="Plan">{plans.map((plan) => <option key={plan.code} value={plan.code}>{plan.name}{plan.public ? "" : " (hidden)"}</option>)}</select><ChevronDown size={16} /></div>
            {planChoice.plan !== "free" && (
              <>
                <label className="field"><span className="field-label">Months</span><input className="input input-plain" type="number" min={1} max={120} value={planChoice.months} disabled={planChoice.no_expiry} onChange={(event) => setPlanChoice({ ...planChoice, months: Number(event.target.value) })} /></label>
                <label className="toggle-row"><input type="checkbox" checked={planChoice.no_expiry} onChange={(event) => setPlanChoice({ ...planChoice, no_expiry: event.target.checked })} /><span><strong>Never expires</strong><small>For partners and custom deals paid outside the app.</small></span></label>
              </>
            )}
            <button type="button" className="btn btn-primary" disabled={busy === "plan"} onClick={() => run("plan", () => adminUpdateUser(userId, planChoice), `Plan set to ${plans.find((plan) => plan.code === planChoice.plan)?.name || planChoice.plan}.`)}>Apply plan</button>
            {user.subscription?.provider && user.subscription.provider !== "manual" && <p className="field-hint">They pay through {user.subscription.provider}. Changing the plan here doesn&apos;t change their card billing.</p>}
          </div>
        </Section>

        <Section title="Custom limits for this user" wide>
          <p className="card-sub" style={{ marginTop: -8 }}>Leave a box empty to use the plan&apos;s value. Use this for enterprise deals or goodwill boosts.</p>
          <div className="form-grid" style={{ marginTop: 12 }}>
            {LIMIT_FIELDS.map(({ key, label }) => (
              <label key={key} className="field"><span className="field-label">{label}</span><input className="input input-plain" type="number" min={0} placeholder={String((user.plan as unknown as Record<string, unknown>)[key] ?? "")} value={limits[key] ?? ""} onChange={(event) => setLimits({ ...limits, [key]: event.target.value })} /></label>
            ))}
            {FLAG_FIELDS.map(({ key, label }) => (
              <label key={key} className="field"><span className="field-label">{label}</span>
                <div className="select-wrap"><select className="select" value={flags[key] || ""} onChange={(event) => setFlags({ ...flags, [key]: event.target.value as TriState })}><option value="">Plan default</option><option value="on">On</option><option value="off">Off</option></select><ChevronDown size={16} /></div>
              </label>
            ))}
            {Object.entries(permissionLabels).map(([key, label]) => (
              <label key={key} className="field"><span className="field-label">{label}</span>
                <div className="select-wrap"><select className="select" value={permissions[key] || ""} onChange={(event) => setPermissions({ ...permissions, [key]: event.target.value as TriState })}><option value="">Plan default</option><option value="on">Allowed</option><option value="off">Blocked</option></select><ChevronDown size={16} /></div>
              </label>
            ))}
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
            <button type="button" className="btn btn-primary" disabled={busy === "limits"} onClick={() => saveOverrides()}>Save limits</button>
            {user.subscription?.overrides && <button type="button" className="btn btn-outline" onClick={() => saveOverrides(true)}>Clear custom limits</button>}
          </div>
        </Section>

        <Section title="Credits (one video each)">
          <div className="inline-form" style={{ marginTop: 0 }}>
            <label className="field" style={{ flex: "1 1 120px" }}><span className="field-label">Minutes each</span><input className="input input-plain" type="number" min={1} value={credit.minutes} onChange={(event) => setCredit({ ...credit, minutes: Number(event.target.value) })} /></label>
            <label className="field" style={{ flex: "1 1 90px" }}><span className="field-label">How many</span><input className="input input-plain" type="number" min={1} max={100} value={credit.count} onChange={(event) => setCredit({ ...credit, count: Number(event.target.value) })} /></label>
            <button type="button" className="btn btn-primary" style={{ alignSelf: "flex-end" }} disabled={busy === "credit"} onClick={() => run("credit", () => adminGrantUserCredits(userId, credit.minutes, credit.count), `Granted ${credit.count} credit${credit.count === 1 ? "" : "s"}.`)}><Ticket size={16} />Grant</button>
          </div>
          <ul className="simple-list">
            {user.credits.map((item) => (
              <li key={item.id}>
                <span>{item.max_minutes} min · {item.source}{item.used_by_job ? <> · used on <Link className="link" href={`/jobs/${item.used_by_job}?admin=1`}>#{item.used_by_job}</Link></> : " · unused"}</span>
                {!item.used_by_job && <button type="button" className="icon-btn" aria-label="Remove credit" onClick={() => run("credit", async () => { await adminRevokeCredit(item.id); return getAdminUser(userId); }, "Credit removed.")}><Trash2 size={15} /></button>}
              </li>
            ))}
            {!user.credits.length && <li className="card-sub">No credits.</li>}
          </ul>
        </Section>

        <Section title="Profile & notes">
          <div className="form-stack" style={{ gap: 10 }}>
            <label className="field"><span className="field-label">Name</span><input className="input input-plain" value={profile.name} onChange={(event) => setProfile({ ...profile, name: event.target.value })} /></label>
            <label className="field"><span className="field-label">Phone / WhatsApp</span><input className="input input-plain" value={profile.phone} onChange={(event) => setProfile({ ...profile, phone: event.target.value })} /></label>
            <label className="field"><span className="field-label">Private admin notes</span><textarea className="input input-plain admin-textarea" rows={4} value={profile.admin_notes} onChange={(event) => setProfile({ ...profile, admin_notes: event.target.value })} placeholder="e.g. Paid by bank transfer on 3 Oct; follow up next month" /></label>
            <button type="button" className="btn btn-primary" disabled={busy === "profile"} onClick={() => run("profile", () => adminUpdateUser(userId, profile), "Profile saved.")}>Save</button>
          </div>
        </Section>

        <Section title="Follow up by email">
          <div className="form-stack" style={{ gap: 10 }}>
            <input className="input input-plain" placeholder="Subject" value={email.subject} onChange={(event) => setEmail({ ...email, subject: event.target.value })} aria-label="Subject" />
            <textarea className="input input-plain admin-textarea" rows={5} placeholder={`Hi ${user.name || "there"},\n\n…`} value={email.message} onChange={(event) => setEmail({ ...email, message: event.target.value })} aria-label="Message" />
            <button type="button" className="btn btn-primary" disabled={busy === "email"} onClick={() => run("email", async () => { await adminEmailUser(userId, email.subject, email.message); setEmail({ subject: "", message: "" }); }, `Email sent to ${user.email}.`)}><Mail size={16} />Send email</button>
          </div>
        </Section>

        <Section title="Access">
          <div className="form-stack" style={{ gap: 12 }}>
            <label className="toggle-row"><input type="checkbox" checked={user.is_admin} disabled={user.admin_via_env || busy === "access"} onChange={(event) => run("access", () => adminUpdateUser(userId, { is_admin: event.target.checked }), event.target.checked ? "Now an admin." : "Admin access removed.")} /><span><strong>Admin</strong><small>{user.admin_via_env ? "Set in ADMIN_EMAILS in backend/.env" : "Can open this admin area and change everything."}</small></span></label>
            <label className="toggle-row"><input type="checkbox" checked={user.disabled} disabled={busy === "access"} onChange={(event) => run("access", () => adminUpdateUser(userId, { disabled: event.target.checked }), event.target.checked ? "Account suspended. They can't sign in or use the app." : "Account reactivated.")} /><span><strong>Suspended</strong><small>Blocks sign-in and all use of the app. Their data is kept.</small></span></label>
            {user.auth && !user.auth.error && <p className="field-hint">Supabase: {user.auth.email_confirmed ? "email confirmed" : "email not confirmed"} · signs in with {(user.auth.providers || []).join(", ") || "email"} · last sign-in {user.auth.last_sign_in_at ? relativeTime(user.auth.last_sign_in_at).toLowerCase() : "never"}</p>}
            {user.auth?.error && <p className="form-error">{user.auth.error}</p>}
          </div>
        </Section>
      </div>

      <h2 style={{ margin: "36px 0 12px" }}>Recent projects</h2>
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th>#</th><th>File</th><th>Languages</th><th>Status</th><th>Length</th><th>Created</th></tr></thead>
          <tbody>
            {user.jobs.map((job) => (
              <tr key={job.id} className={job.deleted ? "is-muted" : ""}>
                <td><Link className="link" href={`/jobs/${job.id}?admin=1`}>{job.id}</Link></td>
                <td>{job.original_filename || "—"}</td>
                <td>{job.source_language} → {job.target_language}</td>
                <td><span className={`badge badge-${job.status}`}>{job.status}</span>{job.deleted && <span className="badge badge-soft">deleted</span>}{job.error_message && <small className="cell-error">{job.error_message.slice(0, 80)}</small>}</td>
                <td>{job.duration_seconds ? `${(job.duration_seconds / 60).toFixed(1)} min` : "—"}</td>
                <td>{job.created_at ? relativeTime(job.created_at) : "—"}</td>
              </tr>
            ))}
            {!user.jobs.length && <tr><td colSpan={6} className="card-sub">No projects yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <h2 style={{ margin: "36px 0 12px" }}>Payments</h2>
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th>Date</th><th>Item</th><th>Amount</th><th>Method</th><th>Status</th></tr></thead>
          <tbody>
            {user.payments.map((payment) => (
              <tr key={payment.reference}>
                <td>{new Date(payment.created_at).toLocaleDateString()}</td>
                <td>{payment.kind === "payg" ? `Credit (${payment.credit_pack})` : `${payment.plan_code} ${payment.kind}`}</td>
                <td>{formatMoney(payment.amount / 100, payment.currency)}</td>
                <td>{payment.provider}</td>
                <td><span className={`badge ${payment.status === "success" ? "badge-done" : payment.status === "pending" ? "badge-processing" : "badge-failed"}`}>{payment.status}</span></td>
              </tr>
            ))}
            {!user.payments.length && <tr><td colSpan={5} className="card-sub">No payments.</td></tr>}
          </tbody>
        </table>
      </div>

      <section className="card card-pad danger-zone">
        <h2>Delete account</h2>
        <p className="card-sub">Removes their login, projects, files, saved voices, API keys and team memberships. Payment records are kept for your accounts.</p>
        <button type="button" className="btn btn-outline danger-btn" style={{ marginTop: 12 }} disabled={busy === "delete"} onClick={remove}><Trash2 size={16} />Delete this account</button>
      </section>
    </AppShell>
  );
}
