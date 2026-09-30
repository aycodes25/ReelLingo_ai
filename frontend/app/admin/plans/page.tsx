"use client";

import { useEffect, useState } from "react";
import { CircleAlert, CircleCheck, Plus, Save, Trash2 } from "lucide-react";
import AdminNav from "@/components/AdminNav";
import AppShell from "@/components/AppShell";
import { adminCreatePlan, adminDeletePlan, adminUpdatePlan, getAdminPlans } from "@/lib/api";
import type { AdminPlan, Plan } from "@/lib/types";

type Draft = Omit<Plan, "features"> & { features: string; subscribers?: number; isNew?: boolean };

const NUMBERS: { key: keyof Plan; label: string; step?: number }[] = [
  { key: "price_usd", label: "Price in US$ / month", step: 0.01 },
  { key: "price_ngn", label: "Price in ₦ / month" },
  { key: "videos_per_month", label: "Videos per month" },
  { key: "max_video_minutes", label: "Max minutes per video" },
  { key: "max_targets", label: "Languages per upload" },
  { key: "team_seats", label: "Team seats" },
  { key: "saved_voices", label: "Saved voices" },
  { key: "priority", label: "Queue priority (higher = sooner)" },
  { key: "sort", label: "Order on pricing page" },
];
const FLAGS: { key: keyof Plan; label: string; help: string }[] = [
  { key: "voice_clone", label: "Voice cloning", help: "Dub in the speaker's own voice" },
  { key: "watermark", label: "Watermark exports", help: "Adds “Made with ReelLingo”" },
  { key: "lip_sync", label: "Lip-sync", help: "Needs SYNC_API_KEY" },
  { key: "api_access", label: "API access", help: "Can create API keys" },
  { key: "featured", label: "“Most popular” badge", help: "Highlights the card" },
  { key: "public", label: "Show on pricing pages", help: "Hidden plans can still be assigned by admins" },
  { key: "contact_sales", label: "Contact sales (custom price)", help: "Shows “Contact sales” instead of a buy button" },
];

const toDraft = (plan: AdminPlan | Plan): Draft => ({ ...plan, features: plan.features.join("\n") });

const EMPTY: Draft = {
  code: "", name: "", blurb: "", price_usd: 0, price_ngn: 0, videos_per_month: 10, max_video_minutes: 10, voice_clone: true, watermark: false,
  priority: 1, max_targets: 2, lip_sync: false, api_access: false, team_seats: 1, saved_voices: 0, features: "", featured: false,
  permissions: {}, contact_sales: false, public: true, sort: 10, isNew: true,
};

export default function AdminPlansPage() {
  const [plans, setPlans] = useState<Draft[] | null>(null);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [maxMinutes, setMaxMinutes] = useState(60);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    const result = await getAdminPlans();
    setPlans(result.plans.map(toDraft));
    setLabels(result.permissions);
    setMaxMinutes(result.max_video_minutes);
  }

  useEffect(() => {
    load().catch((error: unknown) => setMessage({ tone: "error", text: error instanceof Error ? error.message : "Could not load plans." }));
  }, []);

  function edit(index: number, patch: Partial<Draft>) {
    setPlans((current) => current && current.map((plan, position) => (position === index ? { ...plan, ...patch } : plan)));
  }

  async function save(plan: Draft) {
    setBusy(plan.code || "new");
    setMessage(null);
    const payload = { ...plan, features: plan.features.split("\n").map((line) => line.trim()).filter(Boolean) };
    try {
      if (plan.isNew) await adminCreatePlan(payload);
      else await adminUpdatePlan(plan.code, payload);
      await load();
      setMessage({ tone: "success", text: `“${plan.name}” saved. Changes apply to the next upload and the pricing pages right away.` });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Could not save." });
    } finally {
      setBusy(null);
    }
  }

  async function remove(plan: Draft) {
    const others = (plans || []).filter((item) => item.code !== plan.code && !item.isNew);
    const moveTo = window.prompt(`Delete “${plan.name}”? Its ${plan.subscribers || 0} subscriber(s) will be moved to another plan.\nType the code of the plan to move them to (${others.map((item) => item.code).join(", ")}):`, "free");
    if (!moveTo) return;
    setBusy(plan.code);
    try {
      const result = await adminDeletePlan(plan.code, moveTo.trim());
      await load();
      setMessage({ tone: "success", text: `Plan deleted. ${result.moved} subscriber(s) moved to ${moveTo}.` });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Could not delete." });
    } finally {
      setBusy(null);
    }
  }

  return (
    <AppShell crumbs={[{ label: "Admin", href: "/admin" }, { label: "Plans" }]}>
      <AdminNav />
      <div className="page-head">
        <div>
          <h1>Plans</h1>
          <p>Set prices, limits and exactly which features each plan includes. The pricing page, checkout and upload limits all use these. Every plan is also capped at {maxMinutes} minutes per video (App settings).</p>
        </div>
        <button type="button" className="btn btn-primary" disabled={!plans || plans.some((plan) => plan.isNew)} onClick={() => setPlans((current) => [...(current || []), { ...EMPTY }])}><Plus size={16} />New plan</button>
      </div>

      {message && <div role={message.tone === "error" ? "alert" : "status"} className={`alert ${message.tone === "error" ? "alert-error" : "alert-success"}`} style={{ marginBottom: 20 }}>{message.tone === "error" ? <CircleAlert size={16} /> : <CircleCheck size={16} />}<span>{message.text}</span></div>}
      {!plans && <div className="skeleton" style={{ height: 300 }} />}

      <div className="plan-editor-list">
        {plans?.map((plan, index) => (
          <section key={plan.isNew ? "new" : plan.code} className="card card-pad plan-editor">
            <div className="section-row" style={{ margin: 0 }}>
              <div>
                <h2>{plan.name || "New plan"} <code>{plan.code || "code"}</code></h2>
                {!plan.isNew && <p className="card-sub">{plan.subscribers || 0} active subscriber{plan.subscribers === 1 ? "" : "s"}</p>}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                {!plan.isNew && plan.code !== "free" && <button type="button" className="btn btn-outline btn-sm danger-btn" disabled={busy === plan.code} onClick={() => remove(plan)}><Trash2 size={14} />Delete</button>}
                {plan.isNew && <button type="button" className="btn btn-outline btn-sm" onClick={() => setPlans((current) => (current || []).filter((item) => !item.isNew))}>Cancel</button>}
                <button type="button" className="btn btn-primary btn-sm" disabled={busy === (plan.code || "new")} onClick={() => save(plan)}><Save size={14} />Save</button>
              </div>
            </div>

            <div className="form-grid" style={{ marginTop: 16 }}>
              {plan.isNew && <label className="field"><span className="field-label">Code (permanent, e.g. enterprise)</span><input className="input input-plain" value={plan.code} onChange={(event) => edit(index, { code: event.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "") })} /></label>}
              <label className="field"><span className="field-label">Name</span><input className="input input-plain" value={plan.name} onChange={(event) => edit(index, { name: event.target.value })} /></label>
              <label className="field form-wide"><span className="field-label">Short description</span><input className="input input-plain" value={plan.blurb} onChange={(event) => edit(index, { blurb: event.target.value })} /></label>
              {NUMBERS.map(({ key, label, step }) => (
                <label key={key} className="field"><span className="field-label">{label}</span>
                  <input className="input input-plain" type="number" min={0} step={step || 1} disabled={plan.code === "free" && key.startsWith("price_")} value={Number(plan[key] ?? 0)} onChange={(event) => edit(index, { [key]: Number(event.target.value) } as Partial<Draft>)} />
                </label>
              ))}
            </div>

            <div className="toggle-grid">
              {FLAGS.map(({ key, label, help }) => (
                <label key={key} className="toggle-row"><input type="checkbox" checked={Boolean(plan[key])} disabled={plan.code === "free" && (key === "public" || key === "contact_sales")} onChange={(event) => edit(index, { [key]: event.target.checked } as Partial<Draft>)} /><span><strong>{label}</strong><small>{help}</small></span></label>
              ))}
            </div>

            <h3 className="subhead">Features included</h3>
            <div className="toggle-grid">
              {Object.entries(labels).map(([key, label]) => (
                <label key={key} className="toggle-row"><input type="checkbox" checked={plan.permissions?.[key] !== false} onChange={(event) => edit(index, { permissions: { ...plan.permissions, [key]: event.target.checked } })} /><span><strong>{label}</strong></span></label>
              ))}
            </div>

            <label className="field" style={{ marginTop: 16 }}>
              <span className="field-label">Extra bullet points on the pricing card (one per line)</span>
              <textarea className="input input-plain admin-textarea" rows={4} value={plan.features} onChange={(event) => edit(index, { features: event.target.value })} placeholder={"Voice cloning\nNo watermark\nPriority processing"} />
              <small className="field-hint">“X videos per month” and “Up to Y minutes per video” are added automatically from the numbers above.</small>
            </label>
          </section>
        ))}
      </div>
      <p className="field-hint" style={{ marginTop: 16 }}>Tip: to change who&apos;s on a plan, open <b>Users</b>. To switch a feature off for everyone at once, use <b>App settings</b>.</p>
    </AppShell>
  );
}
