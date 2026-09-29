"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ChevronDown, CircleCheck, CircleAlert } from "lucide-react";
import AppShell from "@/components/AppShell";
import { getApiHealth, getSessionUser, getStoredToken, getUsage, saveProfile } from "@/lib/api";
import type { ApiHealth, SessionUser, Usage } from "@/lib/types";

const CREATOR_TYPES = ["Educational", "Lifestyle & Vlogging", "Tech & Reviews", "Entertainment & Comedy", "Music", "Food & Cooking", "Business & Finance", "News & Documentary", "Faith & Inspiration", "Other"];

export default function SettingsPage() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [name, setName] = useState("");
  const [creatorType, setCreatorType] = useState("");
  const [saved, setSaved] = useState(false);
  const [health, setHealth] = useState<ApiHealth | null>(null);
  const [healthError, setHealthError] = useState(false);
  const [usage, setUsage] = useState<Usage | null>(null);

  useEffect(() => {
    if (!getStoredToken()) return;
    const current = getSessionUser();
    setUser(current);
    setName(current.name);
    setCreatorType(current.creatorType);
    getApiHealth().then(setHealth).catch(() => setHealthError(true));
    getUsage().then(setUsage).catch(() => undefined);
  }, []);

  function handleSave(event: FormEvent) {
    event.preventDefault();
    saveProfile({ email: user?.email, name: name.trim(), creatorType });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  const services = health ? [
    { label: "API", ok: true },
    { label: "Transcription & translation", ok: health.mode === "live" },
    { label: "Voice cloning", ok: health.capabilities.voiceClone },
    { label: "Account sign-in", ok: health.capabilities.authentication },
  ] : [];

  return (
    <AppShell crumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Settings" }]}>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p>Your profile, plan and system status.</p>
        </div>
      </div>

      <div className="settings-grid">
        <form className="card card-pad" onSubmit={handleSave}>
          <h2>Profile</h2>
          <p className="card-sub">Shown in the studio sidebar on this device.</p>
          <div className="form-stack" style={{ marginTop: 20 }}>
            <div className="field">
              <label className="field-label" htmlFor="profile-name" style={{ fontSize: 12 }}>Full name</label>
              <input id="profile-name" className="input input-plain" value={name} onChange={(event) => setName(event.target.value)} />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="profile-email" style={{ fontSize: 12 }}>Email address</label>
              <input id="profile-email" className="input input-plain" value={user?.email || ""} readOnly disabled />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="profile-type" style={{ fontSize: 12 }}>Creator type</label>
              <div className="select-wrap">
                <select id="profile-type" className="select" value={creatorType} onChange={(event) => setCreatorType(event.target.value)}>
                  <option value="">Not set</option>
                  {CREATOR_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                </select>
                <ChevronDown size={17} />
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <button type="submit" className="btn btn-primary">Save changes</button>
              {saved && <span style={{ color: "var(--teal)", fontSize: 14, display: "inline-flex", gap: 6, alignItems: "center" }}><CircleCheck size={16} />Saved</span>}
            </div>
          </div>
        </form>

        <section className="card card-pad">
          <h2>Plan &amp; usage</h2>
          <dl className="kv" style={{ marginTop: 12 }}>
            <div><dt>Plan</dt><dd style={{ textTransform: "capitalize" }}>{usage?.tier ?? "—"}</dd></div>
            <div><dt>Videos this month</dt><dd>{usage ? `${usage.videos_this_month} of ${usage.max_videos_per_month}` : "—"}</dd></div>
            <div><dt>Minutes processed this month</dt><dd>{usage ? usage.minutes_this_month : "—"}</dd></div>
            <div><dt>Maximum video length</dt><dd>{usage ? `${usage.max_video_minutes} min` : "—"}</dd></div>
          </dl>
        </section>

        <section className="card card-pad" id="status">
          <h2>System status</h2>
          <dl className="kv" style={{ marginTop: 12 }}>
            {healthError && <div><dt>API</dt><dd style={{ color: "var(--red)" }}>Unreachable</dd></div>}
            {services.map((service) => (
              <div key={service.label}>
                <dt>{service.ok ? <CircleCheck size={16} color="var(--teal)" /> : <CircleAlert size={16} color="#c79100" />}{service.label}</dt>
                <dd style={{ color: service.ok ? "var(--teal)" : "#a07400" }}>{service.ok ? "Operational" : "Not configured"}</dd>
              </div>
            ))}
            {health && <div><dt>Supported languages</dt><dd>{health.capabilities.languages}</dd></div>}
          </dl>
        </section>
      </div>
    </AppShell>
  );
}
