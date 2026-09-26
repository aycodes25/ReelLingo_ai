import { createReadStream } from "node:fs";
import { mkdir, copyFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { config } from "./config.js";

const bucket = "reellingo-videos";
const hasSupabase = Boolean(config.supabaseUrl && config.supabaseKey);

function supabaseHeaders(contentType) {
  return {
    apikey: config.supabaseKey,
    Authorization: `Bearer ${config.supabaseKey}`,
    "Content-Type": contentType,
    "x-upsert": "true",
  };
}

function objectPath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

export async function uploadFile(path, localFilePath, contentType = "application/octet-stream") {
  if (!hasSupabase) {
    const destination = join(config.localStorageDir, path);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(localFilePath, destination);
    return path;
  }

  const response = await fetch(`${config.supabaseUrl}/storage/v1/object/${bucket}/${objectPath(path)}`, {
    method: "POST",
    headers: supabaseHeaders(contentType),
    body: createReadStream(localFilePath),
    duplex: "half",
  });
  if (!response.ok) throw new Error(`Storage upload failed (${response.status}): ${await response.text()}`);
  return path;
}

export async function uploadBuffer(path, data, contentType = "application/octet-stream") {
  if (!hasSupabase) {
    const destination = join(config.localStorageDir, path);
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

export async function getSignedUrl(path, expiresIn = 3600, download = false) {
  if (!hasSupabase) {
    const url = `http://localhost:${config.port}/files/${objectPath(path)}`;
    return download ? `${url}?download=${encodeURIComponent(basename(path))}` : url;
  }
  const response = await fetch(`${config.supabaseUrl}/storage/v1/object/sign/${bucket}/${objectPath(path)}`, {
    method: "POST",
    headers: supabaseHeaders("application/json"),
    body: JSON.stringify({ expiresIn, ...(download ? { download: basename(path) } : {}) }),
  });
  if (!response.ok) throw new Error(`Could not create download link (${response.status}).`);
  const data = await response.json();
  const signedPath = data.signedURL || data.signedUrl;
  return signedPath.startsWith("http") ? signedPath : `${config.supabaseUrl}/storage/v1${signedPath}`;
}

export function hasRemoteStorage() {
  return hasSupabase;
}