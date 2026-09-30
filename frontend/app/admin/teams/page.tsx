"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CircleAlert, Trash2 } from "lucide-react";
import AdminNav from "@/components/AdminNav";
import AppShell from "@/components/AppShell";
import { adminDeleteTeam, getAdminTeams } from "@/lib/api";
import type { AdminTeam } from "@/lib/types";

export default function AdminTeamsPage() {
  const [teams, setTeams] = useState<AdminTeam[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => getAdminTeams().then(setTeams).catch((loadError: unknown) => setError(loadError instanceof Error ? loadError.message : "Could not load teams."));
  useEffect(() => { void load(); }, []);

  return (
    <AppShell crumbs={[{ label: "Admin", href: "/admin" }, { label: "Teams" }]}>
      <AdminNav />
      <div className="page-head">
        <div>
          <h1>Teams</h1>
          <p>Every team workspace. A team&apos;s plan is managed from its owner&apos;s billing page, or from Users by using billing ID <code>team:&lt;id&gt;</code> on the overview page.</p>
        </div>
      </div>
      {error && <div role="alert" className="alert alert-error" style={{ marginBottom: 20 }}><CircleAlert size={16} /><span>{error}</span></div>}
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th>#</th><th>Team</th><th>Owner</th><th>Members</th><th>Plan</th><th>Created</th><th /></tr></thead>
          <tbody>
            {teams?.map((team) => (
              <tr key={team.id}>
                <td>{team.id}</td>
                <td><b>{team.name}</b></td>
                <td><Link className="link" href={`/admin/users/${encodeURIComponent(team.owner_id)}`}>{team.owner_email || team.owner_id}</Link></td>
                <td>{team.members}</td>
                <td>{team.plan}</td>
                <td>{team.created_at ? new Date(team.created_at).toLocaleDateString() : "—"}</td>
                <td>
                  <button type="button" className="icon-btn" aria-label={`Delete ${team.name}`} onClick={async () => {
                    if (!window.confirm(`Delete team “${team.name}”? Its shared projects and files are deleted too.`)) return;
                    try {
                      await adminDeleteTeam(team.id);
                      await load();
                    } catch (deleteError) {
                      setError(deleteError instanceof Error ? deleteError.message : "Could not delete.");
                    }
                  }}><Trash2 size={16} /></button>
                </td>
              </tr>
            ))}
            {teams?.length === 0 && <tr><td colSpan={7} className="card-sub">No teams yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
