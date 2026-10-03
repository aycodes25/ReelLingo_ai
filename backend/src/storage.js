import { createHmac, timingSafeEqual } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { copyFile, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, normalize, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { config } from "./config.js";

const bucket = config.storageBucket;
const hasSupabase = Boolean(config.supabaseUrl && config.supabaseKey);

function supabaseHeaders(contentType) {
  return {
    apikey: config.supabaseKey,
    Authorization: `Bearer ${config.supabaseKey}`,
    ...(contentType ? { "Content-Type": contentType } : {}),
    "x-upsert": "true",
  };
}

function objectPath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

/** Resolves a storage key inside the local storage directory, refusing anything that escapes it. */
export function localPath(path) {
  const root = normalize(config.localStorageDir);
  const resolved = normalize(join(root, path));
  if (resolved !== root && !resolved.startsWith(root + sep)) throw new Error("Invalid storage path.");
  return resolved;
}

export async function uploadFile(path, localFilePath, contentType = "application/octet-stream") {
  if (!hasSupabase) {
    const destination = localPath(path);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(localFilePath, destination);
    return path;
  }

  const response = await fetch(`${config.supabaseUrl}/storage/v1/object/${bucket}/${objectPath(path)}`, {
    method: "POST",
    headers: { ...supabaseHeaders(contentType), "Content-Length": String((await stat(localFilePath)).size) },
    body: createReadStream(localFilePath),
    duplex: "half",
  });
  if (!response.ok) throw new Error(`Storage upload failed (${response.status}): ${await response.text()}`);
  return path;
}

export async function uploadBuffer(path, data, contentType = "application/octet-stream") {
  if (!hasSupabase) {
    const destination = localPath(path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, data);
    return path;
  }
  const response = await fetch(`${config.supabaseUrl}/storage/v1/object/${bucket}/${objectPath(path)}`, {
    method: "POST",
    headers: supabaseHeaders(contentType),
    body: data,
  });
  if (!response.ok) throw new Error(`Storage upload failed (${response.status}): ${await response.text()}`);
  return path;
}

/** Copies a stored object to a local file so the worker can process it. */
export async function downloadFile(path, destination) {
  await mkdir(dirname(destination), { recursive: true });
  if (!hasSupabase) {
    await copyFile(localPath(path), destination);
    return destination;
  }
  const response = await fetch(`${config.supabaseUrl}/storage/v1/object/${bucket}/${objectPath(path)}`, { headers: supabaseHeaders() });
  if (!response.ok || !response.body) throw new Error(`Storage download failed (${response.status}) for ${path}.`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(destination));
  return destination;
}

export async function fileExists(path) {
  if (!path) return false;
  if (!hasSupabase) {
    try {
      await stat(localPath(path));
      return true;
    } catch {
      return false;
    }
  }
  const response = await fetch(`${config.supabaseUrl}/storage/v1/object/info/${bucket}/${objectPath(path)}`, { headers: supabaseHeaders() });
  return response.ok;
}

export async function deleteFiles(paths) {
  const keys = [...new Set(paths.filter(Boolean))];
  if (!keys.length) return;
  if (!hasSupabase) {
    await Promise.all(keys.map((key) => rm(localPath(key), { force: true, recursive: true })));
    return;
  }
  const response = await fetch(`${config.supabaseUrl}/storage/v1/object/${bucket}`, {
    method: "DELETE",
    headers: supabaseHeaders("application/json"),
    body: JSON.stringify({ prefixes: keys }),
  });
  if (!response.ok) throw new Error(`Storage delete failed (${response.status}): ${await response.text()}`);
}

/** Lists object keys under a prefix (one level deep is enough for jobs/<id>/...). */
export async function listFiles(prefix) {
  if (!hasSupabase) {
    const { readdir } = await import("node:fs/promises");
    const walk = async (directory, base) => {
      let entries = [];
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch {
        return [];
      }
      const nested = await Promise.all(entries.map((entry) => (entry.isDirectory()
        ? walk(join(directory, entry.name), `${base}${entry.name}/`)
        : [`${base}${entry.name}`])));
      return nested.flat();
    };
    return walk(localPath(prefix), prefix.endsWith("/") ? prefix : `${prefix}/`);
  }
  const response = await fetch(`${config.supabaseUrl}/storage/v1/object/list/${bucket}`, {
    method: "POST",
    headers: supabaseHeaders("application/json"),
    body: JSON.stringify({ prefix, limit: 1000 }),
  });
  if (!response.ok) return [];
  const base = prefix.endsWith("/") ? prefix : `${prefix}/`;
  const items = await response.json();
  const files = [];
  for (const item of items) {
    if (item.id) files.push(`${base}${item.name}`);
    else files.push(...await listFiles(`${base}${item.name}`));
  }
  return files;
}

/** Every stored file with its size in bytes (for storage usage on the admin dashboard). */
export async function listFilesWithSizes(prefix = "") {
  if (!hasSupabase) {
    const { readdir } = await import("node:fs/promises");
    const walk = async (directory, base) => {
      let entries = [];
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch {
        return [];
      }
      const nested = await Promise.all(entries.map(async (entry) => {
        const full = join(directory, entry.name);
        if (entry.isDirectory()) return walk(full, `${base}${entry.name}/`);
        return [{ path: `${base}${entry.name}`, size: (await stat(full)).size }];
      }));
      return nested.flat();
    };
    return walk(prefix ? localPath(prefix) : config.localStorageDir, prefix ? (prefix.endsWith("/") ? prefix : `${prefix}/`) : "");
  }
  const base = prefix ? (prefix.endsWith("/") ? prefix : `${prefix}/`) : "";
  const files = [];
  for (let offset = 0; offset < 100_000; offset += 1000) {
    const response = await fetch(`${config.supabaseUrl}/storage/v1/object/list/${bucket}`, {
      method: "POST",
      headers: supabaseHeaders("application/json"),
      body: JSON.stringify({ prefix: base, limit: 1000, offset }),
    });
    if (!response.ok) break;
    const items = await response.json();
    for (const item of items) {
      if (item.id) files.push({ path: `${base}${item.name}`, size: Number(item.metadata?.size || 0) });
      else files.push(...await listFilesWithSizes(`${base}${item.name}`));
    }
    if (items.length < 1000) break;
  }
  return files;
}

function localSignature(path, expires, download) {
  return createHmac("sha256", config.appSecret).update(`${path}\n${expires}\n${download || ""}`).digest("base64url");
}

/** Checks a /files request signed by getSignedUrl in local-storage mode. */
export function verifyLocalSignature(path, expires, download, signature) {
  if (!signature || !expires || Number(expires) < Math.floor(Date.now() / 1000)) return false;
  const expected = Buffer.from(localSignature(path, expires, download));
  const given = Buffer.from(String(signature));
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export async function getSignedUrl(path, expiresIn = 3600, download = false) {
  const downloadName = download ? (typeof download === "string" ? download : basename(path)) : "";
  if (!hasSupabase) {
    const expires = Math.floor(Date.now() / 1000) + expiresIn;
    const params = new URLSearchParams({ exp: String(expires), sig: localSignature(path, expires, downloadName) });
    if (downloadName) params.set("download", downloadName);
    return `${config.publicApiUrl}/files/${objectPath(path)}?${params}`;
  }
  const response = await fetch(`${config.supabaseUrl}/storage/v1/object/sign/${bucket}/${objectPath(path)}`, {
    method: "POST",
    headers: supabaseHeaders("application/json"),
    body: JSON.stringify({ expiresIn, ...(downloadName ? { download: downloadName } : {}) }),
  });
  if (!response.ok) throw new Error(`Could not create download link (${response.status}).`);
  const data = await response.json();
  const signedPath = data.signedURL || data.signedUrl;
  const url = signedPath.startsWith("http") ? signedPath : `${config.supabaseUrl}/storage/v1${signedPath}`;
  // Supabase ignores a custom name unless it's passed as a query parameter on the signed URL.
  return downloadName && !url.includes("download=") ? `${url}&download=${encodeURIComponent(downloadName)}` : url;
}

export function hasRemoteStorage() {
  return hasSupabase;
}
