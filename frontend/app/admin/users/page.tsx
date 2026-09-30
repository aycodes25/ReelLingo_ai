"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { ChevronDown, CircleAlert, CircleCheck, RefreshCw, Search, UserPlus, X } from "lucide-react";
import AdminNav from "@/components/AdminNav";
import AppShell from "@/components/AppShell";
import { adminCreateUser, getAdminPlans, getAdminUsers } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import type { AdminPlan, AdminUserRow } from "@/lib/types";

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUserRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [plan, setPlan] = useState("");
  const [status, setStatus] = useState("");
  const [plans, setPlans] = useState<AdminPlan[]>([]);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [draft, setDraft] = useState({ email: "", name: "", plan: "free", months: 1, method: "password" as "password" | "invite" | "auto", password: "" });
  const [busy, setBusy] = useState(false);

  const load = useCallback((sync = false) => {
    getAdminUsers({ q: query, plan, status, page, sync }).then((result) => {
      setUsers(result.users);
      setTotal(result.total);
    }).catch((error: unknown) => setMessage({ tone: "error", text: error instanceof Error ? error.message : "Could not load users." }));
  }, [query, plan, status, page]);

  useEffect(() => {
    const timer = setTimeout(() => load(), 250);
    return () => clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    getAdminPlans().then((result) => setPlans(result.plans)).catch(() => undefined);
    // First visit: import anyone who signed up in Supabase but never opened the studio.
    load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const result = await adminCreateUser({
        email: draft.email, name: draft.name, plan: draft.plan, months: draft.months,
        invite: draft.method === "invite", password: draft.method === "password" ? draft.password : undefined,
      });
      setMessage({
        tone: "success",
        text: result.invited ? `Invitation emailed to ${draft.email}. They set their own password from the email.`
          : result.temporary_password ? `Account created. Temporary password (shown once — share it securely): ${result.temporary_password}`
            : `Account created for ${draft.email}. They can sign in with the password you set.`,
      });
      setShowCreate(false);
      setDraft({ email: "", name: "", plan: "free", months: 1, method: "password", password: "" });
      load();
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Could not create the account." });
    } finally {
      setBusy(false);
    }
  }

  const pages = Math.max(1, Math.ceil(total / 50));

  return (
    <AppShell crumbs={[{ label: "Admin", href: "/admin" }, { label: "Users" }]}>
      <AdminNav />
      <div className="page-head">
        <div>
          <h1>Users</h1>
          <p>Every account, its plan, usage and credits. Open a user to change their plan, give custom limits or credits, suspend, email or delete them.</p>
        </div>
        <div className="page-head-actions">
          <button type="button" className="btn btn-outline" onClick={() => load(true)}><RefreshCw size={16} />Sync from Supabase</button>
          <button type="button" className="btn btn-primary" onClick={() => setShowCreate(!showCreate)}><UserPlus size={16} />Add user</button>
        </div>
      </div>

      {message && <div role={message.tone === "error" ? "alert" : "status"} className={`alert ${message.tone === "error" ? "alert-error" : "alert-success"}`} style={{ marginBottom: 20 }}>{message.tone === "error" ? <CircleAlert size={16} /> : <CircleCheck size={16} />}<span style={{ wordBreak: "break-all" }}>{message.text}</span></div>}

      {showCreate && (
        <form className="card card-pad admin-form" onSubmit={create} style={{ marginBottom: 24 }}>
          <div className="section-row" style={{ margin: 0 }}><h2>Add a user</h2><button type="button" className="icon-btn" aria-label="Close" onClick={() => setShowCreate(false)}><X size={18} /></button></div>
          <div className="form-grid">
            <label className="field"><span className="field-label">Email</span><input className="input input-plain" type="email" required value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} /></label>
            <label className="field"><span className="field-label">Name</span><input className="input input-plain" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
            <label className="field"><span className="field-label">Plan</span>
              <div className="select-wrap"><select className="select" value={draft.plan} onChange={(event) => setDraft({ ...draft, plan: event.target.value })}>{plans.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}</select><ChevronDown size={16} /></div>
            </label>
            {draft.plan !== "free" && <label className="field"><span className="field-label">For how many months</span><input className="input input-plain" type="number" min={1} max={120} value={draft.months} onChange={(event) => setDraft({ ...draft, months: Number(event.target.value) })} /></label>}
            <label className="field"><span className="field-label">How they sign in</span>
              <div className="select-wrap"><select className="select" value={draft.method} onChange={(event) => setDraft({ ...draft, method: event.target.value as typeof draft.method })}>
                <option value="password">I set a password now</option>
                <option value="auto">Generate a temporary password</option>
                <option value="invite">Email them an invite link</option>
              </select><ChevronDown size={16} /></div>
            </label>
            {draft.method === "password" && <label className="field"><span className="field-label">Password (8+ characters)</span><input className="input input-plain" type="text" minLength={8} required value={draft.password} onChange={(event) => setDraft({ ...draft, password: event.target.value })} /></label>}
          </div>
          <p className="field-hint">The account is created in Supabase Auth (already confirmed) and appears here straight away.</p>
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "Creating…" : "Create account"}</button>
        </form>
      )}

      <div className="filter-bar">
        <div className="search" style={{ display: "block", width: 320, maxWidth: "100%" }}>
          <Search size={16} />
          <input type="search" placeholder="Search email, name or ID…" aria-label="Search users" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} />
        </div>
        <div className="select-wrap" style={{ width: 180 }}><select className="select" value={plan} onChange={(event) => { setPlan(event.target.value); setPage(1); }} aria-label="Filter by plan"><option value="">All plans</option>{plans.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}</select><ChevronDown size={16} /></div>
        <div className="select-wrap" style={{ width: 170 }}><select className="select" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} aria-label="Filter by status"><option value="">Everyone</option><option value="active">Active</option><option value="suspended">Suspended</option><option value="admin">Admins</option></select><ChevronDown size={16} /></div>
        <span className="field-hint">{total} user{total === 1 ? "" : "s"}</span>
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th>User</th><th>Plan</th><th>This month</th><th>Credits</th><th>Projects</th><th>Joined</th><th>Last active</th></tr></thead>
          <tbody>
            {users === null && <tr><td colSpan={7}><div className="skeleton" style={{ height: 40 }} /></td></tr>}
            {users?.map((user) => (
              <tr key={user.user_id} className={user.disabled ? "is-muted" : ""}>
                <td>
                  <Link className="link" href={`/admin/users/${encodeURIComponent(user.user_id)}`}>{user.email || user.user_id}</Link>
                  <div className="cell-sub">{user.name}{user.is_admin && <span className="badge badge-soft">Admin</span>}{user.disabled && <span className="badge badge-failed">Suspended</span>}</div>
                </td>
                <td>{user.plan_name}{user.custom_limits && <span className="badge badge-soft">custom</span>}{user.plan_expires && <div className="cell-sub">until {new Date(user.plan_expires).toLocaleDateString()}</div>}</td>
                <td>{user.videos_this_month} videos · {user.minutes_this_month} min</td>
                <td>{user.credits}</td>
                <td>{user.total_jobs}</td>
                <td>{user.created_at ? new Date(user.created_at).toLocaleDateString() : "—"}</td>
                <td>{user.last_seen_at ? relativeTime(user.last_seen_at) : "—"}</td>
              </tr>
            ))}
            {users?.length === 0 && <tr><td colSpan={7} className="card-sub">No users match.</td></tr>}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="pager">
          <button type="button" className="btn btn-outline btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
          <span>Page {page} of {pages}</span>
          <button type="button" className="btn btn-outline btn-sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      )}
    </AppShell>
  );
}
