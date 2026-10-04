import {
  DeleteObjectsCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl as presign } from "@aws-sdk/s3-request-presigner";
import { createHmac, timingSafeEqual } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { copyFile, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, normalize, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { config } from "./config.js";

/**
 * Video and subtitle files live in one of three places, chosen by STORAGE_PROVIDER:
 *   r2       Cloudflare R2 (S3-compatible; free downloads)
 *   supabase Supabase Storage
 *   local    a folder on this computer (development and tests)
 * Every driver offers the same functions, so the rest of the app doesn't care which one is active.
 */

export const STORAGE_LABELS = { r2: "Cloudflare R2", supabase: "Supabase Storage", local: "Local folder" };

function r2Configured() {
  return Boolean(config.r2.accountId && config.r2.accessKeyId && config.r2.secretAccessKey && config.r2.bucket);
}

function supabaseConfigured() {
  return Boolean(config.supabaseUrl && config.supabaseKey);
}

/** The active storage: an explicit STORAGE_PROVIDER wins; otherwise R2 if its keys are set, then Supabase, then local. */
export function storageProvider() {
  const requested = config.storageProvider;
  if (requested === "r2" || requested === "supabase" || requested === "local") return requested;
  if (r2Configured()) return "r2";
  if (supabaseConfigured()) return "supabase";
  return "local";
}

function objectPath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

function withSlash(prefix) {
  return prefix ? (prefix.endsWith("/") ? prefix : `${prefix}/`) : "";
}

/** Resolves a storage key inside the local storage directory, refusing anything that escapes it. */
export function localPath(path) {
  const root = normalize(config.localStorageDir);
  const resolved = normalize(join(root, path));
  if (resolved !== root && !resolved.startsWith(root + sep)) throw new Error("Invalid storage path.");
  return resolved;
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

// ---------- Local folder ----------
function createLocalDriver() {
  async function walk(directory, base, withSizes) {
    let entries = [];
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return [];
    }
    const nested = await Promise.all(entries.map(async (entry) => {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) return walk(full, `${base}${entry.name}/`, withSizes);
      return [withSizes ? { path: `${base}${entry.name}`, size: (await stat(full)).size } : `${base}${entry.name}`];
    }));
    return nested.flat();
  }
  return {
    name: "local",
    async uploadFile(path, localFilePath) {
      const destination = localPath(path);
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(localFilePath, destination);
      return path;
    },
    async uploadBuffer(path, data) {
      const destination = localPath(path);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, data);
      return path;
    },
    async downloadFile(path, destination) {
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(localPath(path), destination);
      return destination;
    },
    async fileExists(path) {
      try {
        await stat(localPath(path));
        return true;
      } catch {
        return false;
      }
    },
    async deleteFiles(keys) {
      await Promise.all(keys.map((key) => rm(localPath(key), { force: true, recursive: true })));
    },
    listFiles: (prefix) => walk(localPath(prefix), withSlash(prefix), false),
    listFilesWithSizes: (prefix = "") => walk(prefix ? localPath(prefix) : config.localStorageDir, withSlash(prefix), true),
    async getSignedUrl(path, expiresIn, downloadName) {
      const expires = Math.floor(Date.now() / 1000) + expiresIn;
      const params = new URLSearchParams({ exp: String(expires), sig: localSignature(path, expires, downloadName) });
      if (downloadName) params.set("download", downloadName);
      return `${config.publicApiUrl}/files/${objectPath(path)}?${params}`;
    },
  };
}

// ---------- Supabase Storage ----------
function createSupabaseDriver() {
  const bucket = config.storageBucket;
  const headers = (contentType) => ({
    apikey: config.supabaseKey,
    Authorization: `Bearer ${config.supabaseKey}`,
    ...(contentType ? { "Content-Type": contentType } : {}),
    "x-upsert": "true",
  });
  const objectUrl = (path) => `${config.supabaseUrl}/storage/v1/object/${bucket}/${objectPath(path)}`;
  async function list(prefix, withSizes) {
    const base = withSlash(prefix);
    const files = [];
    for (let offset = 0; offset < 100_000; offset += 1000) {
      const response = await fetch(`${config.supabaseUrl}/storage/v1/object/list/${bucket}`, {
        method: "POST",
        headers: headers("application/json"),
        body: JSON.stringify({ prefix: base, limit: 1000, offset }),
      });
      if (!response.ok) break;
      const items = await response.json();
      for (const item of items) {
        if (item.id) files.push(withSizes ? { path: `${base}${item.name}`, size: Number(item.metadata?.size || 0) } : `${base}${item.name}`);
        else files.push(...await list(`${base}${item.name}`, withSizes));
      }
      if (items.length < 1000) break;
    }
    return files;
  }
  return {
    name: "supabase",
    async uploadFile(path, localFilePath, contentType) {
      const response = await fetch(objectUrl(path), {
        method: "POST",
        headers: { ...headers(contentType), "Content-Length": String((await stat(localFilePath)).size) },
        body: createReadStream(localFilePath),
        duplex: "half",
      });
      if (!response.ok) throw new Error(`Storage upload failed (${response.status}): ${await response.text()}`);
      return path;
    },
    async uploadBuffer(path, data, contentType) {
      const response = await fetch(objectUrl(path), { method: "POST", headers: headers(contentType), body: data });
      if (!response.ok) throw new Error(`Storage upload failed (${response.status}): ${await response.text()}`);
      return path;
    },
    async downloadFile(path, destination) {
      await mkdir(dirname(destination), { recursive: true });
      const response = await fetch(objectUrl(path), { headers: headers() });
      if (!response.ok || !response.body) throw new Error(`Storage download failed (${response.status}) for ${path}.`);
      await pipeline(Readable.fromWeb(response.body), createWriteStream(destination));
      return destination;
    },
    async fileExists(path) {
      const response = await fetch(`${config.supabaseUrl}/storage/v1/object/info/${bucket}/${objectPath(path)}`, { headers: headers() });
      return response.ok;
    },
    async deleteFiles(keys) {
      const response = await fetch(`${config.supabaseUrl}/storage/v1/object/${bucket}`, {
        method: "DELETE",
        headers: headers("application/json"),
        body: JSON.stringify({ prefixes: keys }),
      });
      if (!response.ok) throw new Error(`Storage delete failed (${response.status}): ${await response.text()}`);
    },
    listFiles: (prefix) => list(prefix, false),
    listFilesWithSizes: (prefix = "") => list(prefix, true),
    async getSignedUrl(path, expiresIn, downloadName) {
      const response = await fetch(`${config.supabaseUrl}/storage/v1/object/sign/${bucket}/${objectPath(path)}`, {
        method: "POST",
        headers: headers("application/json"),
        body: JSON.stringify({ expiresIn, ...(downloadName ? { download: downloadName } : {}) }),
      });
      if (!response.ok) throw new Error(`Could not create download link (${response.status}).`);
      const data = await response.json();
      const signedPath = data.signedURL || data.signedUrl;
      const url = signedPath.startsWith("http") ? signedPath : `${config.supabaseUrl}/storage/v1${signedPath}`;
      // Supabase ignores a custom name unless it's passed as a query parameter on the signed URL.
      return downloadName && !url.includes("download=") ? `${url}&download=${encodeURIComponent(downloadName)}` : url;
    },
  };
}

// ---------- Cloudflare R2 (S3-compatible) ----------
export function r2Client() {
  return new S3Client({
    region: "auto",
    endpoint: config.r2.endpoint || `https://${config.r2.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: config.r2.accessKeyId, secretAccessKey: config.r2.secretAccessKey },
  });
}

function isNotFound(error) {
  return error?.name === "NotFound" || error?.name === "NoSuchKey" || error?.$metadata?.httpStatusCode === 404;
}

function createR2Driver(client = r2Client()) {
  const Bucket = config.r2.bucket;
  async function list(prefix, withSizes) {
    const files = [];
    let ContinuationToken;
    do {
      const page = await client.send(new ListObjectsV2Command({ Bucket, Prefix: withSlash(prefix) || undefined, ContinuationToken }));
      for (const item of page.Contents || []) files.push(withSizes ? { path: item.Key, size: Number(item.Size || 0) } : item.Key);
      ContinuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (ContinuationToken);
    return files;
  }
  return {
    name: "r2",
    async uploadFile(path, localFilePath, contentType) {
      // Multipart upload: large videos go up in parts and failed parts are retried.
      await new Upload({ client, params: { Bucket, Key: path, Body: createReadStream(localFilePath), ContentType: contentType }, partSize: 16 * 1024 * 1024, queueSize: 4 }).done();
      return path;
    },
    async uploadBuffer(path, data, contentType) {
      await client.send(new PutObjectCommand({ Bucket, Key: path, Body: data, ContentType: contentType }));
      return path;
    },
    async downloadFile(path, destination) {
      await mkdir(dirname(destination), { recursive: true });
      let object;
      try {
        object = await client.send(new GetObjectCommand({ Bucket, Key: path }));
      } catch (error) {
        throw new Error(isNotFound(error) ? `Storage file not found: ${path}` : `Storage download failed for ${path}: ${error.message}`);
      }
      await pipeline(object.Body, createWriteStream(destination));
      return destination;
    },
    async fileExists(path) {
      try {
        await client.send(new HeadObjectCommand({ Bucket, Key: path }));
        return true;
      } catch (error) {
        if (isNotFound(error)) return false;
        throw error;
      }
    },
    async deleteFiles(keys) {
      for (let index = 0; index < keys.length; index += 1000) {
        const batch = keys.slice(index, index + 1000);
        const result = await client.send(new DeleteObjectsCommand({ Bucket, Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true } }));
        if (result.Errors?.length) throw new Error(`Storage delete failed: ${result.Errors[0].Message || result.Errors[0].Code}`);
      }
    },
    listFiles: (prefix) => list(prefix, false),
    listFilesWithSizes: (prefix = "") => list(prefix, true),
    async getSignedUrl(path, expiresIn, downloadName) {
      const command = new GetObjectCommand({
        Bucket,
        Key: path,
        ...(downloadName ? { ResponseContentDisposition: `attachment; filename="${downloadName.replace(/["\\]/g, "")}"` } : {}),
      });
      return presign(client, command, { expiresIn: Math.min(expiresIn, 7 * 24 * 3600) });
    },
  };
}

/** A specific driver, e.g. for copying files between providers. */
export function createStorageDriver(name, options = {}) {
  if (name === "r2") {
    if (!r2Configured() && !options.client) throw new Error("Cloudflare R2 needs R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET in backend/.env.");
    return createR2Driver(options.client);
  }
  if (name === "supabase") {
    if (!supabaseConfigured()) throw new Error("Supabase Storage needs SUPABASE_URL and SUPABASE_KEY in backend/.env.");
    return createSupabaseDriver();
  }
  return createLocalDriver();
}

let active = null;
function driver() {
  const name = storageProvider();
  if (!active || active.name !== name) active = createStorageDriver(name);
  return active;
}

/** Tests can swap in a driver (e.g. R2 backed by a mocked S3 client). */
export function useStorageDriver(replacement) {
  active = replacement;
}

// ---------- Public API (unchanged for the rest of the app) ----------
export function uploadFile(path, localFilePath, contentType = "application/octet-stream") {
  return driver().uploadFile(path, localFilePath, contentType);
}

export function uploadBuffer(path, data, contentType = "application/octet-stream") {
  return driver().uploadBuffer(path, data, contentType);
}

/** Copies a stored object to a local file so the worker can process it. */
export function downloadFile(path, destination) {
  return driver().downloadFile(path, destination);
}

export async function fileExists(path) {
  if (!path) return false;
  return driver().fileExists(path);
}

export async function deleteFiles(paths) {
  const keys = [...new Set(paths.filter(Boolean))];
  if (keys.length) await driver().deleteFiles(keys);
}

/** Lists object keys under a prefix (e.g. jobs/<id>). */
export function listFiles(prefix) {
  return driver().listFiles(prefix);
}

/** Every stored file with its size in bytes (for storage usage on the admin dashboard). */
export function listFilesWithSizes(prefix = "") {
  return driver().listFilesWithSizes(prefix);
}

export function getSignedUrl(path, expiresIn = 3600, download = false) {
  const downloadName = download ? (typeof download === "string" ? download : basename(path)) : "";
  return driver().getSignedUrl(path, expiresIn, downloadName);
}

/** True when files are reachable from the internet through signed links (needed by lip-sync). */
export function hasRemoteStorage() {
  return storageProvider() !== "local";
}
