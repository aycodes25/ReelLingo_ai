"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { ChevronDown, CircleAlert, CircleCheck, Mail, Plus, Trash2, Users } from "lucide-react";
import AppShell from "@/components/AppShell";
import {
  acceptTeamInvite, createTeam, getMe, getTeam, getTeams, inviteTeamMember, removeTeamMember, setTeamMemberRole, setWorkspace,
} from "@/lib/api";
import type { TeamDetail, TeamSummary } from "@/lib/types";

export default function TeamsPage() {
  const [teams, setTeams] = useState<TeamSummary[] | null>(null);
  const [selected, setSelected] = useState<TeamDetail | null>(null);
  const [myId, setMyId] = useState("");
  const [name, setName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function load(selectId?: number) {
    const list = await getTeams();
    setTeams(list);
    const active = list.filter((team) => team.status === "active");
    const target = selectId ?? selected?.id ?? active[0]?.id;
    if (target && active.some((team) => team.id === target)) setSelected(await getTeam(target));
    else setSelected(null);
  }

  useEffect(() => {
    getMe().then((me) => setMyId(me.user_id)).catch(() => undefined);
    load().catch((error: unknown) => setMessage({ tone: "error", text: error instanceof Error ? error.message : "Could not load teams." }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function run(task: () => Promise<unknown>, success?: string) {
    setBusy(true);
    setMessage(null);
    try {
      await task();
      if (success) setMessage({ tone: "success", text: success });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Something went wrong." });
    } finally {
      setBusy(false);
    }
  }

  function handleCreate(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      const team = await createTeam(name);
      setName("");
      await load(team.id);
    }, "Team created. Invite your editors and producers below.");
  }

  function handleInvite(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    void run(async () => {
      const members = await inviteTeamMember(selected.id, inviteEmail, inviteRole);
      setSelected({ ...selected, members });
      setInviteEmail("");
    }, `Invitation sent to ${inviteEmail}. They join by signing in with that email.`);
  }

  const invites = teams?.filter((team) => team.status === "invited") || [];
  const active = teams?.filter((team) => team.status === "active") || [];
  const canManage = selected && ["owner", "admin"].includes(selected.role);

  return (
    <AppShell crumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Teams" }]}>
      <div className="page-head">
        <div>
          <h1>Team workspaces</h1>
          <p>Share projects, a plan and credits with your editors, producers and agency clients.</p>
        </div>
      </div>

      {message && <div role={message.tone === "error" ? "alert" : "status"} className={`alert ${message.tone === "error" ? "alert-error" : "alert-success"}`} style={{ marginBottom: 20 }}>{message.tone === "error" ? <CircleAlert size={16} /> : <CircleCheck size={16} />}<span>{message.text}</span></div>}

      {invites.length > 0 && (
        <section className="card card-pad" style={{ marginBottom: 24 }}>
          <h2><Mail size={18} style={{ display: "inline", verticalAlign: "-3px" }} /> Invitations</h2>
          <ul className="simple-list">
            {invites.map((team) => (
              <li key={team.id}>
                <span>You&apos;re invited to <b>{team.name}</b> as {team.role}.</span>
                <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => run(async () => { await acceptTeamInvite(team.id); await load(team.id); }, `You joined ${team.name}.`)}>Accept</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="settings-grid">
        <section className="card card-pad">
          <h2>Your teams</h2>
          {teams === null ? <div className="skeleton" style={{ height: 80, marginTop: 12 }} /> : active.length ? (
            <ul className="simple-list">
              {active.map((team) => (
                <li key={team.id} className={selected?.id === team.id ? "is-selected" : ""}>
                  <button type="button" className="link" onClick={() => run(async () => setSelected(await getTeam(team.id)))}>{team.name}</button>
                  <span className="badge badge-soft" style={{ textTransform: "capitalize" }}>{team.role}</span>
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => { setWorkspace(String(team.id)); window.location.href = "/dashboard"; }}>Open workspace</button>
                </li>
              ))}
            </ul>
          ) : <p className="card-sub" style={{ marginTop: 8 }}>You&apos;re not on a team yet.</p>}
          <form className="inline-form" onSubmit={handleCreate}>
            <input className="input input-plain" placeholder="Team name, e.g. Lagos Media Co." value={name} onChange={(event) => setName(event.target.value)} aria-label="New team name" />
            <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}><Plus size={16} />Create team</button>
          </form>
        </section>

        {selected && (
          <section className="card card-pad" style={{ gridColumn: "1 / -1" }}>
            <div className="section-row" style={{ margin: 0 }}>
              <div>
                <h2><Users size={18} style={{ display: "inline", verticalAlign: "-3px" }} /> {selected.name}</h2>
                <p className="card-sub">{selected.plan.name} plan · {selected.members.length} of {selected.seats} seat{selected.seats === 1 ? "" : "s"} used</p>
              </div>
              {canManage && <Link href="/billing" className="btn btn-outline btn-sm" onClick={() => setWorkspace(String(selected.id))}>Manage team plan</Link>}
            </div>
            {selected.seats <= 1 && <div className="alert alert-info" style={{ margin: "14px 0" }}><CircleAlert size={16} /><span>Free and single-seat plans can&apos;t add members. Upgrade the team to <b>Studio</b> for 5 seats.</span></div>}
            <div className="table-wrap" style={{ marginTop: 14 }}>
              <table className="data-table">
                <thead><tr><th>Member</th><th>Role</th><th>Status</th><th /></tr></thead>
                <tbody>
                  {selected.members.map((member) => (
                    <tr key={member.id}>
                      <td>{member.email}{member.user_id === myId && " (you)"}</td>
                      <td>
                        {selected.role === "owner" && member.role !== "owner" ? (
                          <div className="select-wrap select-sm">
                            <select className="select" value={member.role} aria-label={`Role for ${member.email}`} onChange={(event) => run(async () => setSelected({ ...selected, members: await setTeamMemberRole(selected.id, member.id, event.target.value) }))}>
                              <option value="member">Member</option>
                              <option value="admin">Admin</option>
                            </select>
                            <ChevronDown size={14} />
                          </div>
                        ) : <span style={{ textTransform: "capitalize" }}>{member.role}</span>}
                      </td>
                      <td><span className={`badge ${member.status === "active" ? "badge-done" : "badge-processing"}`}>{member.status}</span></td>
                      <td>
                        {member.role !== "owner" && (canManage || member.user_id === myId) && (
                          <button type="button" className="icon-btn" aria-label={member.user_id === myId ? "Leave team" : `Remove ${member.email}`} onClick={() => {
                            if (!window.confirm(member.user_id === myId ? "Leave this team?" : `Remove ${member.email} from the team?`)) return;
                            void run(async () => {
                              const members = await removeTeamMember(selected.id, member.id);
                              if (member.user_id === myId) {
                                setWorkspace("personal");
                                await load();
                              } else {
                                setSelected({ ...selected, members });
                              }
                            });
                          }}><Trash2 size={16} /></button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {canManage && (
              <form className="inline-form" onSubmit={handleInvite}>
                <input className="input input-plain" type="email" required placeholder="editor@example.com" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} aria-label="Email to invite" />
                <div className="select-wrap" style={{ maxWidth: 140 }}>
                  <select className="select" value={inviteRole} onChange={(event) => setInviteRole(event.target.value)} aria-label="Role">
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                  </select>
                  <ChevronDown size={16} />
                </div>
                <button type="submit" className="btn btn-primary" disabled={busy || !inviteEmail}><Mail size={16} />Invite</button>
              </form>
            )}
          </section>
        )}
      </div>
    </AppShell>
  );
}
