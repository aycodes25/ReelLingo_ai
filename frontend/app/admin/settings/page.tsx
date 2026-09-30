"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, CircleAlert, CircleCheck, RotateCcw, Save } from "lucide-react";
import AdminNav from "@/components/AdminNav";
import AppShell from "@/components/AppShell";
import { adminUpdateSettings, getAdminSettings } from "@/lib/api";
import type { AdminSetting } from "@/lib/types";

type Value = boolean | number | string;

export default function AdminSettingsPage() {
  const [settings, setSettings] = useState<AdminSetting[] | null>(null);
  const [draft, setDraft] = useState<Record<string, Value>>({});
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  function apply(list: AdminSetting[]) {
    setSettings(list);
    setDraft(Object.fromEntries(list.map((setting) => [setting.key, setting.value])));
  }

  useEffect(() => {
    getAdminSettings().then(apply).catch((error: unknown) => setMessage({ tone: "error", text: error instanceof Error ? error.message : "Could not load settings." }));
  }, []);

  const groups = useMemo(() => Array.from(new Set((settings || []).map((setting) => setting.group))), [settings]);
  const changed = (settings || []).filter((setting) => draft[setting.key] !== setting.value);

  async function save(changes: Record<string, Value | null>, success: string) {
    setSaving(true);
    setMessage(null);
    try {
      apply(await adminUpdateSettings(changes));
      setMessage({ tone: "success", text: success });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Could not save." });
    } finally {
      setSaving(false);
    }
  }

  function input(setting: AdminSetting) {
    const value = draft[setting.key];
    const set = (next: Value) => setDraft({ ...draft, [setting.key]: next });
    if (setting.type === "bool") {
      return <label className="switch"><input type="checkbox" checked={Boolean(value)} onChange={(event) => set(event.target.checked)} /><span>{value ? "On" : "Off"}</span></label>;
    }
    if (setting.type === "select") {
      return <div className="select-wrap"><select className="select" value={String(value)} onChange={(event) => set(event.target.value)}>{setting.options?.map((option) => <option key={option} value={option}>{option}</option>)}</select><ChevronDown size={16} /></div>;
    }
    if (setting.type === "number") {
      return <input className="input input-plain" type="number" min={setting.min ?? undefined} max={setting.max ?? undefined} step={setting.step ?? 1} value={Number(value)} onChange={(event) => set(Number(event.target.value))} />;
    }
    return setting.key === "announcement" || setting.key === "maintenance_message"
      ? <textarea className="input input-plain admin-textarea" rows={2} value={String(value ?? "")} onChange={(event) => set(event.target.value)} />
      : <input className="input input-plain" value={String(value ?? "")} onChange={(event) => set(event.target.value)} />;
  }

  return (
    <AppShell crumbs={[{ label: "Admin", href: "/admin" }, { label: "App settings" }]}>
      <AdminNav />
      <div className="page-head">
        <div>
          <h1>App settings</h1>
          <p>Switch features on or off for everyone, pause the app for maintenance, post an announcement and tune limits. Changes apply within seconds — no restart. API keys stay in backend/.env.</p>
        </div>
        <button type="button" className="btn btn-primary" disabled={!changed.length || saving} onClick={() => save(Object.fromEntries(changed.map((setting) => [setting.key, draft[setting.key]])), `Saved ${changed.length} change${changed.length === 1 ? "" : "s"}.`)}>
          <Save size={16} />Save {changed.length ? `(${changed.length})` : ""}
        </button>
      </div>

      {message && <div role={message.tone === "error" ? "alert" : "status"} className={`alert ${message.tone === "error" ? "alert-error" : "alert-success"}`} style={{ marginBottom: 20 }}>{message.tone === "error" ? <CircleAlert size={16} /> : <CircleCheck size={16} />}<span>{message.text}</span></div>}
      {!settings && <div className="skeleton" style={{ height: 300 }} />}

      {groups.map((group) => (
        <section key={group} className="card card-pad settings-group">
          <h2>{group}</h2>
          <div className="settings-rows">
            {settings!.filter((setting) => setting.group === group).map((setting) => (
              <div key={setting.key} className={`settings-row ${draft[setting.key] !== setting.value ? "is-changed" : ""}`}>
                <div>
                  <strong>{setting.label}</strong>
                  {setting.help && <small>{setting.help}</small>}
                  {setting.overridden && <small className="overridden">Changed from the .env default ({String(setting.default) || "empty"})</small>}
                </div>
                <div className="settings-control">
                  {input(setting)}
                  {setting.overridden && <button type="button" className="icon-btn" title="Reset to .env default" aria-label={`Reset ${setting.label}`} onClick={() => save({ [setting.key]: null }, `${setting.label} reset.`)}><RotateCcw size={15} /></button>}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </AppShell>
  );
}
