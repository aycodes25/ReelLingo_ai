import { createReadStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config } from "./config.js";
import { one, query } from "./db.js";
import { decrypt, encrypt, signState, verifyState } from "./secrets.js";
import { downloadFile } from "./storage.js";

// upload: publish dubs. readonly: list the creator's own videos to import. force-ssl: add subtitles and translated
// titles to videos already on the channel.
const SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/youtube.force-ssl",
];

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

// ---------- The creator's own videos ----------

async function youtubeApi(userId, path, { method = "GET", body, headers = {} } = {}) {
  const token = await accessToken(userId);
  const response = await fetch(`https://www.googleapis.com/youtube/v3${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...headers },
    body,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const reason = data.error?.errors?.[0]?.reason || "";
    if (response.status === 403 && /insufficient|forbidden/i.test(`${reason} ${data.error?.message || ""}`)) {
      throw Object.assign(new Error("ReelLingo needs new YouTube permissions. Go to Settings → YouTube, disconnect and connect again."), { status: 403 });
    }
    throw Object.assign(new Error(`YouTube: ${data.error?.message || response.status}`), { status: response.status });
  }
  return data;
}

/** "PT1H2M3S" → 3723 */
export function parseIsoDuration(value) {
  const match = String(value || "").match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/);
  if (!match) return null;
  const [, days, hours, minutes, seconds] = match.map((part) => Number(part || 0));
  return days * 86400 + hours * 3600 + minutes * 60 + seconds;
}

async function myChannel(userId) {
  const data = await youtubeApi(userId, "/channels?part=id,contentDetails,snippet&mine=true");
  const channel = data.items?.[0];
  if (!channel) throw new Error("No YouTube channel was found on the connected Google account.");
  return { id: channel.id, title: channel.snippet?.title || "", uploads: channel.contentDetails?.relatedPlaylists?.uploads || null };
}

function videoSummary(item) {
  return {
    id: item.id,
    title: item.snippet?.title || "Untitled video",
    thumbnail: item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.default?.url || null,
    published_at: item.snippet?.publishedAt || null,
    duration_seconds: parseIsoDuration(item.contentDetails?.duration),
    privacy: item.status?.privacyStatus || null,
    default_language: item.snippet?.defaultLanguage || item.snippet?.defaultAudioLanguage || null,
  };
}

/** The creator's latest uploads (25 per page), newest first. */
export async function listOwnVideos(userId, pageToken = "") {
  const channel = await myChannel(userId);
  if (!channel.uploads) return { videos: [], next_page: null, channel: channel.title };
  const playlist = await youtubeApi(userId, `/playlistItems?part=contentDetails&maxResults=25&playlistId=${encodeURIComponent(channel.uploads)}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`);
  const ids = (playlist.items || []).map((item) => item.contentDetails?.videoId).filter(Boolean);
  if (!ids.length) return { videos: [], next_page: null, channel: channel.title };
  const details = await youtubeApi(userId, `/videos?part=snippet,contentDetails,status&id=${ids.join(",")}`);
  const byId = new Map((details.items || []).map((item) => [item.id, videoSummary(item)]));
  return { videos: ids.map((id) => byId.get(id)).filter(Boolean), next_page: playlist.nextPageToken || null, channel: channel.title };
}

/** A video from the creator's own channel. Throws if the video belongs to someone else. */
export async function getOwnVideo(userId, videoId) {
  if (!/^[\w-]{6,20}$/.test(String(videoId || ""))) throw new Error("That isn't a YouTube video ID.");
  const [channel, details] = await Promise.all([
    myChannel(userId),
    youtubeApi(userId, `/videos?part=snippet,contentDetails,status&id=${encodeURIComponent(videoId)}`),
  ]);
  const item = details.items?.[0];
  if (!item) throw new Error("That video wasn't found on YouTube.");
  if (item.snippet?.channelId !== channel.id) throw new Error("You can only import videos from your own connected YouTube channel.");
  return videoSummary(item);
}

// YouTube's language codes differ from ours for a few languages.
const YOUTUBE_LANGUAGE = { pcm: "en", fil: "fil", zh: "zh-Hans", no: "no", he: "iw" };

function multipartRelated(metadata, file, contentType) {
  const boundary = `reellingo${Date.now().toString(36)}`;
  const head = Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`);
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { body: Buffer.concat([head, file, tail]), type: `multipart/related; boundary=${boundary}` };
}

/**
 * Adds a dubbed language to one of the creator's existing YouTube videos: subtitles in that language plus a
 * translated title and description, so viewers who speak it find and follow the video.
 * (YouTube's public API can't upload extra audio tracks; creators add the dubbed audio in YouTube Studio.)
 */
export async function addLanguageToVideo(userId, videoId, { language, languageName, subtitles, title, description, sourceLanguage = "en" }) {
  const video = await getOwnVideo(userId, videoId);
  const code = YOUTUBE_LANGUAGE[language] || language;
  const current = await youtubeApi(userId, `/videos?part=snippet,localizations&id=${encodeURIComponent(videoId)}`);
  const item = current.items?.[0];
  const snippet = item.snippet;
  const defaultLanguage = snippet.defaultLanguage || (sourceLanguage && sourceLanguage !== "auto" ? YOUTUBE_LANGUAGE[sourceLanguage] || sourceLanguage : "en");
  const result = { video_id: videoId, title: video.title, language: code, localized: false, captions_id: null, notes: [] };

  if (title && code !== defaultLanguage) {
    await youtubeApi(userId, "/videos?part=snippet,localizations", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: videoId,
        snippet: { title: snippet.title, description: snippet.description, categoryId: snippet.categoryId, tags: snippet.tags, defaultLanguage },
        localizations: { ...(item.localizations || {}), [code]: { title: String(title).slice(0, 100), description: String(description || "").slice(0, 4900) } },
      }),
    });
    result.localized = true;
  } else if (code === defaultLanguage) {
    result.notes.push("The video's own language is the same as this dub, so its title was left unchanged.");
  }

  if (subtitles) {
    const upload = multipartRelated({ snippet: { videoId, language: code, name: `${languageName || code} (ReelLingo)`, isDraft: false } }, Buffer.from(subtitles), "application/octet-stream");
    const token = await accessToken(userId);
    const response = await fetch("https://www.googleapis.com/upload/youtube/v3/captions?part=snippet&uploadType=multipart", {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": upload.type }, body: upload.body,
    });
    const captions = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 403) throw new Error("ReelLingo needs new YouTube permissions to add subtitles. Go to Settings, disconnect YouTube and connect again.");
      throw new Error(`YouTube subtitles: ${captions.error?.message || response.status}`);
    }
    result.captions_id = captions.id || null;
  }
  return result;
}
