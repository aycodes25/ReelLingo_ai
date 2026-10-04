import { createWriteStream } from "node:fs";
import { readdir, rm, stat } from "node:fs/promises";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { basename, extname, join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { config } from "./config.js";
import { commandAvailable, runCapture } from "./media.js";

// Social sites can't be imported by link: their rules forbid downloading, and creators could dub videos they don't own.
// YouTube videos are imported only from the creator's own connected channel (see youtube.js), as "youtube:<video id>".
const SOCIAL_HOSTS = [
  "youtube.com", "youtu.be", "tiktok.com", "instagram.com", "facebook.com", "fb.watch", "fb.com", "x.com", "twitter.com", "vimeo.com",
];

function hostMatches(host, domain) {
  return host === domain || host.endsWith(`.${domain}`);
}

/** Internal source for a video from the creator's own (verified) YouTube channel. */
export function ownYoutubeSource(videoId) {
  return `youtube:${videoId}`;
}

export function classifyImportUrl(raw) {
  const text = String(raw).trim();
  const own = text.match(/^youtube:([\w-]{6,20})$/);
  if (own) return { kind: "social", url: new URL(`https://www.youtube.com/watch?v=${own[1]}`), label: "your YouTube channel" };
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error("Enter a valid link starting with https://");
  }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Only http(s) links can be imported.");
  const host = url.hostname.toLowerCase();
  if (["youtube.com", "youtu.be"].some((domain) => hostMatches(host, domain))) {
    throw new Error("To import from YouTube, connect your channel (Settings → YouTube) and pick one of your own videos.");
  }
  if (SOCIAL_HOSTS.some((domain) => hostMatches(host, domain))) {
    throw new Error("Links from TikTok, Instagram, Facebook, X and Vimeo can't be imported. Download your video from the app and upload the file instead.");
  }
  if (hostMatches(host, "drive.google.com") || hostMatches(host, "docs.google.com")) {
    const id = url.pathname.match(/\/d\/([\w-]{10,})/)?.[1] || url.searchParams.get("id");
    if (!id) throw new Error("That Google Drive link doesn't include a file ID. Use the file's “Share” link.");
    return { kind: "direct", url: new URL(`https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=download&confirm=t`), label: "Google Drive" };
  }
  if (hostMatches(host, "dropbox.com")) {
    url.searchParams.set("dl", "1");
    return { kind: "direct", url, label: "Dropbox" };
  }
  return { kind: "direct", url };
}

function isPrivateAddress(address) {
  if (address.includes(":")) {
    const lower = address.toLowerCase();
    if (lower.startsWith("::ffff:")) return isPrivateAddress(lower.slice(7));
    return lower === "::1" || lower === "::" || lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe80");
  }
  const [a, b] = address.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

/** Blocks links that point at the server's own network (SSRF), e.g. cloud metadata endpoints. */
export async function assertPublicHost(url) {
  if (config.allowPrivateImportHosts) return;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error("That link points to a private network address and can't be imported.");
  }
}

function filenameFrom(response, url) {
  const disposition = response.headers.get("content-disposition") || "";
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const plain = disposition.match(/filename="?([^";]+)"?/i)?.[1];
  const name = encoded ? decodeURIComponent(encoded) : plain || basename(decodeURIComponent(url.pathname)) || "imported-video";
  return name.replace(/[\\/:*?"<>|]+/g, "_").slice(0, 120);
}

async function downloadDirect(startUrl, directory) {
  let url = startUrl;
  let response;
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    await assertPublicHost(url);
    response = await fetch(url, { redirect: "manual", headers: { "User-Agent": "ReelLingo-Importer/1.0" } });
    if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
      url = new URL(response.headers.get("location"), url);
      continue;
    }
    break;
  }
  if (!response.ok || !response.body) throw new Error(`The link could not be downloaded (HTTP ${response.status}).`);
  const type = (response.headers.get("content-type") || "").split(";")[0].trim();
  if (type.startsWith("text/html")) {
    throw new Error("That link opens a web page, not a video file. Make sure the file is shared publicly (“Anyone with the link”).");
  }
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > config.uploadLimitBytes) throw new Error("The linked file is larger than the 2GB limit.");
  const filename = filenameFrom(response, url);
  const path = join(directory, `import${extname(filename) || ".mp4"}`);
  let received = 0;
  const limiter = new Transform({
    transform(chunk, _encoding, callback) {
      received += chunk.length;
      if (received > config.uploadLimitBytes) callback(new Error("The linked file is larger than the 2GB limit."));
      else callback(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(response.body), limiter, createWriteStream(path));
  return { path, filename, mimetype: type || "application/octet-stream" };
}

async function downloadSocial(url, directory) {
  if (!(await commandAvailable(config.ytDlpPath))) {
    throw new Error("Importing from YouTube needs yt-dlp installed on the server (set YTDLP_PATH).");
  }
  const { stdout } = await runCapture(config.ytDlpPath, [
    "--no-playlist", "--no-progress", "--restrict-filenames",
    "-f", "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b",
    "--merge-output-format", "mp4",
    "--max-filesize", String(config.uploadLimitBytes),
    "-o", join(directory, "%(title).80s.%(ext)s"),
    "--print", "after_move:filepath",
    url.toString(),
  ], { timeoutMs: 60 * 60 * 1000 });
  let path = stdout.trim().split(/\r?\n/).filter(Boolean).pop();
  if (!path) {
    const files = (await readdir(directory)).filter((name) => !name.endsWith(".part"));
    if (!files.length) throw new Error("The video could not be downloaded from that link.");
    path = join(directory, files[0]);
  }
  await stat(path);
  return { path, filename: basename(path), mimetype: "video/mp4" };
}

/** Downloads a creator's video from a link into `directory`. The creator must own or have rights to the content. */
export async function importFromUrl(rawUrl, directory) {
  const target = classifyImportUrl(rawUrl);
  try {
    return target.kind === "social" ? await downloadSocial(target.url, directory) : await downloadDirect(target.url, directory);
  } catch (error) {
    await rm(join(directory, "import.mp4"), { force: true });
    throw error;
  }
}
