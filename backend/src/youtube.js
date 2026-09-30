import { createReadStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config } from "./config.js";
import { one, query } from "./db.js";
import { decrypt, encrypt, signState, verifyState } from "./secrets.js";
import { downloadFile } from "./storage.js";

const SCOPES = ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly"];

export function youtubeConfigured() {
  return Boolean(config.googleClientId && config.googleClientSecret);
}

function redirectUri() {
  return `${config.publicApiUrl}/integrations/youtube/callback`;
}

export function youtubeConnectUrl(userId) {
  if (!youtubeConfigured()) throw new Error("YouTube publishing needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in backend/.env.");
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: config.googleClientId,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state: signState({ userId, purpose: "youtube" }),
  }).toString();
  return url.toString();
}

async function tokenRequest(params) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: config.googleClientId, client_secret: config.googleClientSecret, ...params }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`Google sign-in failed: ${data.error_description || data.error || response.status}`);
  return data;
}

async function saveTokens(userId, tokens, label) {
  const payload = encrypt({ ...tokens, expires_at: Date.now() + Number(tokens.expires_in || 3600) * 1000 });
  await query(
    `INSERT INTO integrations (user_id, provider, data_encrypted, account_label, updated_at) VALUES ($1, 'youtube', $2, $3, CURRENT_TIMESTAMP)
     ON CONFLICT (user_id, provider) DO UPDATE SET data_encrypted = $2, account_label = COALESCE($3, integrations.account_label), updated_at = CURRENT_TIMESTAMP`,
    [userId, payload, label],
  );
}

export async function completeYoutubeConnect(code, state) {
  const payload = verifyState(state);
  if (!payload || payload.purpose !== "youtube") throw new Error("This YouTube sign-in link expired. Try connecting again.");
  const tokens = await tokenRequest({ code, grant_type: "authorization_code", redirect_uri: redirectUri() });
  if (!tokens.refresh_token) throw new Error("Google didn't grant offline access. Remove ReelLingo from your Google account's third-party access and connect again.");
  const channel = await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  }).then((response) => response.json()).catch(() => ({}));
  const label = channel.items?.[0]?.snippet?.title || "YouTube channel";
  await saveTokens(payload.userId, tokens, label);
  return { userId: payload.userId, label };
}

export async function youtubeStatus(userId) {
  const row = await one("SELECT account_label, updated_at FROM integrations WHERE user_id = $1 AND provider = 'youtube'", [userId]);
  return { configured: youtubeConfigured() && config.featureYoutube, connected: Boolean(row), channel: row?.account_label || null };
}

export async function disconnectYoutube(userId) {
  const row = await one("SELECT data_encrypted FROM integrations WHERE user_id = $1 AND provider = 'youtube'", [userId]);
  if (row) {
    try {
      const tokens = decrypt(row.data_encrypted);
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(tokens.refresh_token)}`, { method: "POST" });
    } catch {
      // Revocation is best-effort; the stored tokens are deleted either way.
    }
  }
  await query("DELETE FROM integrations WHERE user_id = $1 AND provider = 'youtube'", [userId]);
}

async function accessToken(userId) {
  const row = await one("SELECT data_encrypted FROM integrations WHERE user_id = $1 AND provider = 'youtube'", [userId]);
  if (!row) throw new Error("Connect your YouTube channel in Settings first.");
  const tokens = decrypt(row.data_encrypted);
  if (tokens.access_token && tokens.expires_at > Date.now() + 60_000) return tokens.access_token;
  const refreshed = await tokenRequest({ refresh_token: tokens.refresh_token, grant_type: "refresh_token" });
  await saveTokens(userId, { ...tokens, ...refreshed, refresh_token: refreshed.refresh_token || tokens.refresh_token }, null);
  return refreshed.access_token;
}

/**
 * Uploads a finished dub to the creator's channel with a resumable upload.
 * Note: YouTube's public API can't add extra audio tracks to an existing video, so each dub is its own upload.
 */
export async function publishToYoutube(userId, storagePath, { title, description, tags = [], privacy = "private", language }) {
  const token = await accessToken(userId);
  const directory = await mkdtemp(join(tmpdir(), "reellingo-youtube-"));
  try {
    const localPath = await downloadFile(storagePath, join(directory, "video.mp4"));
    const size = (await stat(localPath)).size;
    const start = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": "video/mp4",
        "X-Upload-Content-Length": String(size),
      },
      body: JSON.stringify({
        snippet: {
          title: String(title || "ReelLingo dub").slice(0, 100),
          description: String(description || "").slice(0, 4900),
          tags: tags.map((tag) => String(tag).replace(/^#/, "")).slice(0, 30),
          ...(language ? { defaultLanguage: language, defaultAudioLanguage: language } : {}),
        },
        status: { privacyStatus: ["public", "unlisted", "private"].includes(privacy) ? privacy : "private", selfDeclaredMadeForKids: false },
      }),
    });
    if (!start.ok) throw new Error(`YouTube rejected the upload (${start.status}): ${(await start.text()).slice(0, 300)}`);
    const uploadUrl = start.headers.get("location");
    const upload = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": "video/mp4", "Content-Length": String(size) },
      body: createReadStream(localPath),
      duplex: "half",
    });
    const data = await upload.json().catch(() => ({}));
    if (!upload.ok || !data.id) throw new Error(`YouTube upload failed (${upload.status}): ${data.error?.message || ""}`);
    return { videoId: data.id, url: `https://youtu.be/${data.id}` };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
