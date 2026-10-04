"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { ChevronDown, CircleAlert, CircleCheck, Copy, Download, Gift, KeyRound, Mic, ShieldCheck, Trash2, Upload, Youtube } from "lucide-react";
import AppShell from "@/components/AppShell";
import {
  clearStoredToken, connectYoutube, createApiKeyRequest, deleteMyAccount, deleteVoice, disconnectYoutube, downloadMyData, getApiHealth, getApiKeys,
  getIntegrations, getMe, getVoices, revokeApiKey, saveVoiceFromSample, updateMe,
} from "@/lib/api";
import { formatMinutes } from "@/lib/format";
import type { ApiHealth, ApiKey, Me, SavedVoice } from "@/lib/types";

const CREATOR_TYPES = ["Educational", "Lifestyle & Vlogging", "Tech & Reviews", "Entertainment & Comedy", "Music", "Food & Cooking", "Business & Finance", "News & Documentary", "Faith & Inspiration", "Other"];

type Flash = { tone: "error" | "success"; text: string } | null;

function FlashMessage({ flash }: { flash: Flash }) {
  if (!flash) return null;
  return <p role={flash.tone === "error" ? "alert" : "status"} className={flash.tone === "error" ? "form-error" : "form-success"}>{flash.tone === "success" && <CircleCheck size={14} />}{flash.text}</p>;
}

export default function SettingsPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [name, setName] = useState("");
  const [creatorType, setCreatorType] = useState("");
  const [phone, setPhone] = useState("");
  const [notifyEmail, setNotifyEmail] = useState(true);
  const [notifyWhatsapp, setNotifyWhatsapp] = useState(false);
  const [profileFlash, setProfileFlash] = useState<Flash>(null);
  const [health, setHealth] = useState<ApiHealth | null>(null);
  const [healthError, setHealthError] = useState(false);
  const [voices, setVoices] = useState<{ voices: SavedVoice[]; limit: number; available: boolean } | null>(null);
  const [voiceName, setVoiceName] = useState("My voice");
  const [voiceConsent, setVoiceConsent] = useState(false);
  const [voiceFlash, setVoiceFlash] = useState<Flash>(null);
  const [keys, setKeys] = useState<{ keys: ApiKey[]; available: boolean } | null>(null);
  const [newKey, setNewKey] = useState<ApiKey | null>(null);
  const [keyName, setKeyName] = useState("");
  const [keyFlash, setKeyFlash] = useState<Flash>(null);
  const [youtube, setYoutube] = useState<{ configured: boolean; connected: boolean; channel: string | null } | null>(null);
  const [youtubeFlash, setYoutubeFlash] = useState<Flash>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [privacyFlash, setPrivacyFlash] = useState<Flash>(null);
  const [deleteText, setDeleteText] = useState("");
  const sampleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getMe().then((account) => {
      setMe(account);
      setName(account.name);
      setCreatorType(account.creator_type);
      setPhone(account.phone);
      setNotifyEmail(account.notify_email);
      setNotifyWhatsapp(account.notify_whatsapp);
    }).catch(() => undefined);
    getApiHealth().then(setHealth).catch(() => setHealthError(true));
    getVoices().then(setVoices).catch(() => undefined);
    getApiKeys().then(setKeys).catch(() => undefined);
    getIntegrations().then((result) => setYoutube(result.youtube)).catch(() => undefined);
    const params = new URLSearchParams(window.location.search);
    if (params.get("youtube") === "connected") setYoutubeFlash({ tone: "success", text: "YouTube channel connected." });
    if (params.get("youtube") === "error") setYoutubeFlash({ tone: "error", text: params.get("message") || "YouTube connection failed." });
  }, []);

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    setBusy("profile");
    setProfileFlash(null);
    try {
      const saved = await updateMe({ name: name.trim(), creator_type: creatorType, phone, notify_email: notifyEmail, notify_whatsapp: notifyWhatsapp });
      setMe((current) => current && { ...current, ...saved });
      setProfileFlash({ tone: "success", text: "Saved" });
    } catch (error) {
      setProfileFlash({ tone: "error", text: error instanceof Error ? error.message : "Could not save." });
    } finally {
      setBusy(null);
    }
  }

  async function uploadSample(file: File | undefined) {
    if (!file) return;
    if (!voiceConsent) {
      setVoiceFlash({ tone: "error", text: "Tick the consent box first." });
      return;
    }
    setBusy("voice");
    setVoiceFlash(null);
    try {
      const result = await saveVoiceFromSample(file, voiceName.trim() || "My voice");
      setVoices((current) => current && { ...current, voices: result.voices });
      setVoiceFlash({ tone: "success", text: "Voice saved. Pick “My saved voice” on your next project." });
    } catch (error) {
      setVoiceFlash({ tone: "error", text: error instanceof Error ? error.message : "Could not save the voice." });
    } finally {
      setBusy(null);
      if (sampleRef.current) sampleRef.current.value = "";
    }
  }

  async function createKey(event: FormEvent) {
    event.preventDefault();
    setBusy("key");
    setKeyFlash(null);
    try {
      const created = await createApiKeyRequest(keyName.trim() || "API key");
      setNewKey(created);
      setKeyName("");
      setKeys(await getApiKeys());
    } catch (error) {
      setKeyFlash({ tone: "error", text: error instanceof Error ? error.message : "Could not create the key." });
    } finally {
      setBusy(null);
    }
  }

  async function copy(text: string) {
    await navigator.clipboard.writeText(text).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  const services = health ? [
    { label: "API", ok: true },
    { label: "Transcription & translation", ok: health.mode === "live" },
    { label: "Voice cloning & multi-speaker", ok: health.capabilities.voiceClone },
    { label: "Account sign-in", ok: health.capabilities.authentication },
    { label: "Payments", ok: Boolean(health.capabilities.payments?.paystack || health.capabilities.payments?.stripe) },
    { label: "Email notifications", ok: Boolean(health.capabilities.email) },
    { label: "WhatsApp notifications", ok: Boolean(health.capabilities.whatsapp) },
    { label: "Lip-sync", ok: Boolean(health.capabilities.lipSync) },
    { label: "YouTube publishing", ok: Boolean(health.capabilities.youtube) },
    { label: "Upload virus scanning", ok: Boolean(health.capabilities.virusScan) },
  ] : [];

  return (
    <AppShell crumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Settings" }]}>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p>Your profile, notifications, voices, integrations and system status.</p>
        </div>
      </div>

      <div className="settings-grid">
        <form className="card card-pad" onSubmit={handleSave}>
          <h2>Profile &amp; notifications</h2>
          <p className="card-sub">Saved to your account, on every device.</p>
          <div className="form-stack" style={{ marginTop: 20 }}>
            <div className="field">
              <label className="field-label" htmlFor="profile-name" style={{ fontSize: 12 }}>Full name</label>
              <input id="profile-name" className="input input-plain" value={name} onChange={(event) => setName(event.target.value)} />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="profile-email" style={{ fontSize: 12 }}>Email address</label>
              <input id="profile-email" className="input input-plain" value={me?.email || ""} readOnly disabled />
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
            <label className="toggle-row"><input type="checkbox" checked={notifyEmail} onChange={(event) => setNotifyEmail(event.target.checked)} /><span><strong>Email me when a dub is ready</strong><small>{me?.channels.email ? "Also when a translation needs review or a job fails." : "Email isn't configured on this server yet."}</small></span></label>
            <label className="toggle-row"><input type="checkbox" checked={notifyWhatsapp} onChange={(event) => setNotifyWhatsapp(event.target.checked)} /><span><strong>WhatsApp me when a dub is ready</strong><small>{me?.channels.whatsapp ? "Add your number in international format." : "WhatsApp isn't configured on this server yet."}</small></span></label>
            <div className="field">
              <label className="field-label" htmlFor="profile-phone" style={{ fontSize: 12 }}>WhatsApp number</label>
              <input id="profile-phone" className="input input-plain" type="tel" inputMode="tel" placeholder="+2348012345678" value={phone} onChange={(event) => setPhone(event.target.value)} />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <button type="submit" className="btn btn-primary" disabled={busy === "profile"}>Save changes</button>
              <FlashMessage flash={profileFlash} />
            </div>
          </div>
        </form>

        <section className="card card-pad">
          <h2>Plan &amp; usage</h2>
          <dl className="kv" style={{ marginTop: 12 }}>
            <div><dt>Plan</dt><dd>{me?.plan.plan.name ?? "—"}</dd></div>
            <div><dt>Minutes left</dt><dd>{me ? formatMinutes(me.plan.minutes.available) : "—"}</dd></div>
            <div><dt>Plan minutes this month</dt><dd>{me ? `${formatMinutes(me.plan.minutes.plan_used)} of ${formatMinutes(me.plan.minutes.plan_allowance)} used` : "—"}</dd></div>
            <div><dt>Extra minutes (never expire)</dt><dd>{me ? formatMinutes(me.plan.minutes.topup_left) : "—"}</dd></div>
            <div><dt>Plan minutes renew</dt><dd>{me ? new Date(me.plan.minutes.resets_at).toLocaleDateString() : "—"}</dd></div>
            <div><dt>Maximum video length</dt><dd>{me ? `${me.plan.max_video_minutes} min` : "—"}</dd></div>
          </dl>
          <Link href="/billing" className="btn btn-outline btn-block" style={{ marginTop: 16 }}>Manage plan &amp; billing</Link>
        </section>

        <section className="card card-pad" id="referral">
          <h2><Gift size={18} style={{ display: "inline", verticalAlign: "-3px" }} /> Invite creators</h2>
          <p className="card-sub">When someone signs up with your link and buys their first plan or minutes, you get {formatMinutes(me?.referral.bonus_minutes ?? 5)} free and they get a {formatMinutes(me?.referral.new_user_minutes ?? 2)} welcome bonus. Free minutes never expire.</p>
          <div className="share-link" style={{ marginTop: 14 }}>
            <input readOnly value={me?.referral.link || ""} aria-label="Your referral link" onFocus={(event) => event.currentTarget.select()} />
            <button type="button" onClick={() => me && copy(me.referral.link)} aria-label="Copy referral link">{copied ? <CircleCheck size={16} color="var(--teal)" /> : <Copy size={16} />}</button>
          </div>
          <p className="field-hint" style={{ marginTop: 10 }}>{me ? `${me.referral.invited} signed up · ${me.referral.rewarded} rewarded` : ""}{me?.referral.link && <> · <a className="link" href={`https://wa.me/?text=${encodeURIComponent(`Dub your videos into English, French and more with your own voice: ${me.referral.link}`)}`} target="_blank" rel="noreferrer">Share on WhatsApp</a></>}</p>
        </section>

        <section className="card card-pad" id="voices">
          <h2><Mic size={18} style={{ display: "inline", verticalAlign: "-3px" }} /> Saved voices</h2>
          <p className="card-sub">{voices?.limit ? `Clone your voice once and reuse it on every video (${voices.voices.length}/${voices.limit}).` : "Saved voices are included in the Creator and Studio plans."}</p>
          {voices?.voices.length ? (
            <ul className="simple-list">
              {voices.voices.map((voice) => (
                <li key={voice.id}>
                  <span><b>{voice.name}</b><small> · saved {new Date(voice.created_at).toLocaleDateString()}</small></span>
                  <button type="button" className="icon-btn" aria-label={`Delete ${voice.name}`} onClick={async () => {
                    if (!window.confirm(`Delete "${voice.name}"? The cloned voice is removed from our voice provider.`)) return;
                    const result = await deleteVoice(voice.id).catch(() => null);
                    if (result) setVoices((current) => current && { ...current, voices: result.voices });
                  }}><Trash2 size={16} /></button>
                </li>
              ))}
            </ul>
          ) : null}
          {voices && voices.limit > voices.voices.length && voices.available && (
            <div className="form-stack" style={{ marginTop: 14, gap: 10 }}>
              <input className="input input-plain" value={voiceName} onChange={(event) => setVoiceName(event.target.value)} aria-label="Voice name" placeholder="Voice name" />
              <label className="checkbox"><input type="checkbox" checked={voiceConsent} onChange={(event) => setVoiceConsent(event.target.checked)} /><span>This is my voice, or I have the speaker&apos;s permission to clone it.</span></label>
              <input ref={sampleRef} type="file" accept="audio/*,video/*" className="visually-hidden" onChange={(event) => uploadSample(event.target.files?.[0])} />
              <button type="button" className="btn btn-outline" disabled={busy === "voice"} onClick={() => sampleRef.current?.click()}><Upload size={16} />{busy === "voice" ? "Cloning…" : "Upload a 1–3 minute sample"}</button>
              <p className="field-hint">Or save a speaker straight from any finished project&apos;s result page.</p>
            </div>
          )}
          <FlashMessage flash={voiceFlash} />
        </section>

        <section className="card card-pad" id="integrations">
          <h2><Youtube size={18} color="#ff0000" style={{ display: "inline", verticalAlign: "-3px" }} /> YouTube</h2>
          {!youtube?.configured ? (
            <p className="card-sub">YouTube publishing needs a Google OAuth client (GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET) on the server.</p>
          ) : youtube.connected ? (
            <>
              <p className="card-sub">Connected to <b>{youtube.channel}</b>. Import your own videos when you start a project, publish dubs, and add subtitles and translated titles to videos already on your channel. If adding subtitles asks for new permissions, disconnect and connect again.</p>
              <button type="button" className="btn btn-outline btn-sm" style={{ marginTop: 12 }} onClick={async () => { await disconnectYoutube(); setYoutube({ ...youtube, connected: false, channel: null }); }}>Disconnect</button>
            </>
          ) : (
            <>
              <p className="card-sub">Import videos from your own channel, upload finished dubs, and add new languages (subtitles and translated titles) to videos you&apos;ve already published.</p>
              <button type="button" className="btn btn-primary btn-sm" style={{ marginTop: 12 }} onClick={async () => {
                try {
                  window.location.href = (await connectYoutube()).url;
                } catch (error) {
                  setYoutubeFlash({ tone: "error", text: error instanceof Error ? error.message : "Could not connect." });
                }
              }}><Youtube size={15} />Connect YouTube</button>
            </>
          )}
          <FlashMessage flash={youtubeFlash} />
        </section>

        {health?.settings?.features?.api !== false && <section className="card card-pad" id="api-keys">
          <h2><KeyRound size={18} style={{ display: "inline", verticalAlign: "-3px" }} /> API keys</h2>
          <p className="card-sub">{keys?.available ? <>Automate dubbing from your own tools. See the <Link href="/docs/api" className="link">API reference</Link>.</> : "API access is included in the Studio plan."}</p>
          {newKey?.key && (
            <div className="alert alert-success" style={{ margin: "12px 0" }}>
              <CircleAlert size={16} />
              <span><strong>Copy your key now — it won&apos;t be shown again.</strong><code className="key-reveal">{newKey.key}</code><button type="button" className="link" onClick={() => copy(newKey.key!)}>Copy</button></span>
            </div>
          )}
          {keys?.keys.length ? (
            <ul className="simple-list">
              {keys.keys.map((key) => (
                <li key={key.id}>
                  <span><b>{key.name}</b> <code>{key.prefix}…</code><small>{key.last_used_at ? " · used recently" : " · never used"}</small></span>
                  <button type="button" className="icon-btn" aria-label={`Revoke ${key.name}`} onClick={async () => {
                    if (!window.confirm(`Revoke "${key.name}"? Apps using it stop working immediately.`)) return;
                    await revokeApiKey(key.id).catch(() => undefined);
                    setKeys(await getApiKeys());
                  }}><Trash2 size={16} /></button>
                </li>
              ))}
            </ul>
          ) : null}
          {keys?.available && (
            <form className="inline-form" onSubmit={createKey}>
              <input className="input input-plain" placeholder="Key name, e.g. Agency CMS" value={keyName} onChange={(event) => setKeyName(event.target.value)} aria-label="Key name" />
              <button type="submit" className="btn btn-primary" disabled={busy === "key"}>Create key</button>
            </form>
          )}
          <FlashMessage flash={keyFlash} />
        </section>}

        <section className="card card-pad" id="privacy">
          <h2><ShieldCheck size={18} style={{ display: "inline", verticalAlign: "-3px" }} /> Your data</h2>
          <p className="card-sub">
            Under Nigeria&apos;s Data Protection Act you can get a copy of everything we store about you, or have it deleted.
            Read our <Link href="/privacy" className="link">Privacy Policy</Link> and <Link href="/terms" className="link">Terms</Link>.
          </p>
          <button type="button" className="btn btn-outline btn-sm" style={{ marginTop: 12 }} disabled={busy === "export"} onClick={async () => {
            setBusy("export");
            setPrivacyFlash(null);
            try {
              await downloadMyData();
              setPrivacyFlash({ tone: "success", text: "Your data was downloaded as a JSON file." });
            } catch (error) {
              setPrivacyFlash({ tone: "error", text: error instanceof Error ? error.message : "Could not download your data." });
            } finally {
              setBusy(null);
            }
          }}><Download size={15} />{busy === "export" ? "Preparing…" : "Download my data"}</button>
          <details className="danger-zone">
            <summary>Delete my account</summary>
            <p className="field-hint">This permanently deletes your account, projects, videos, transcripts and saved voices, and cancels your plan. Unused minutes are lost. Payment records are kept for tax reasons. This can&apos;t be undone.</p>
            <input className="input input-plain" placeholder="Type DELETE to confirm" value={deleteText} onChange={(event) => setDeleteText(event.target.value)} aria-label="Type DELETE to confirm" />
            <button type="button" className="btn btn-danger btn-sm" disabled={deleteText !== "DELETE" || busy === "delete"} onClick={async () => {
              setBusy("delete");
              try {
                await deleteMyAccount();
                clearStoredToken();
                window.location.href = "/?deleted=1";
              } catch (error) {
                setPrivacyFlash({ tone: "error", text: error instanceof Error ? error.message : "Could not delete your account." });
                setBusy(null);
              }
            }}><Trash2 size={15} />{busy === "delete" ? "Deleting…" : "Delete my account permanently"}</button>
          </details>
          <FlashMessage flash={privacyFlash} />
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
