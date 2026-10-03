import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import {
  DeleteObjectsCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client,
} from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";

process.env.STORAGE_PROVIDER = "";
const { config } = await import("../src/config.js");
const storage = await import("../src/storage.js");

/** An in-memory stand-in for an R2 bucket, so the driver can be tested without a Cloudflare account. */
function fakeR2() {
  const objects = new Map();
  const client = new S3Client({ region: "auto", endpoint: "https://test-account.r2.cloudflarestorage.com", credentials: { accessKeyId: "key", secretAccessKey: "secret" } });
  const mock = mockClient(client);
  const bodyToBuffer = async (body) => (Buffer.isBuffer(body) || body instanceof Uint8Array ? Buffer.from(body) : Buffer.concat(await body.toArray()));
  mock.on(PutObjectCommand).callsFake(async (input) => {
    objects.set(input.Key, { body: await bodyToBuffer(input.Body), type: input.ContentType });
    return {};
  });
  mock.on(HeadObjectCommand).callsFake((input) => {
    if (!objects.has(input.Key)) throw Object.assign(new Error("NotFound"), { name: "NotFound", $metadata: { httpStatusCode: 404 } });
    return { ContentLength: objects.get(input.Key).body.length };
  });
  mock.on(GetObjectCommand).callsFake((input) => {
    if (!objects.has(input.Key)) throw Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey", $metadata: { httpStatusCode: 404 } });
    return { Body: Readable.from(objects.get(input.Key).body) };
  });
  mock.on(ListObjectsV2Command).callsFake((input) => {
    const keys = [...objects.keys()].filter((key) => !input.Prefix || key.startsWith(input.Prefix)).sort();
    const start = input.ContinuationToken ? Number(input.ContinuationToken) : 0;
    const page = keys.slice(start, start + 2); // tiny pages so pagination is exercised
    return {
      Contents: page.map((Key) => ({ Key, Size: objects.get(Key).body.length })),
      IsTruncated: start + 2 < keys.length,
      NextContinuationToken: start + 2 < keys.length ? String(start + 2) : undefined,
    };
  });
  mock.on(DeleteObjectsCommand).callsFake((input) => {
    for (const { Key } of input.Delete.Objects) objects.delete(Key);
    return {};
  });
  return { client, objects, mock };
}

test("Cloudflare R2 storage: upload, download, list, delete and private links", async () => {
  const dir = await mkdtemp(join(tmpdir(), "reellingo-r2-"));
  const { client, objects } = fakeR2();
  Object.assign(config.r2, { accountId: "test-account", accessKeyId: "key", secretAccessKey: "secret", bucket: "reellingo-videos" });
  storage.useStorageDriver(storage.createStorageDriver("r2", { client }));
  try {
    const video = join(dir, "clip.mp4");
    await writeFile(video, Buffer.alloc(3000, 7));
    await storage.uploadFile("uploads/clip.mp4", video, "video/mp4");
    await storage.uploadBuffer("jobs/1/subtitles.srt", Buffer.from("1\n00:00:00,000 --> 00:00:01,000\nHello\n"), "text/plain");
    await storage.uploadBuffer("jobs/1/output.mp4", Buffer.alloc(1000), "video/mp4");
    await storage.uploadBuffer("jobs/2/output.mp4", Buffer.alloc(500), "video/mp4");
    assert.equal(objects.get("uploads/clip.mp4").type, "video/mp4");
    assert.equal(objects.get("uploads/clip.mp4").body.length, 3000);

    assert.equal(await storage.fileExists("uploads/clip.mp4"), true);
    assert.equal(await storage.fileExists("uploads/missing.mp4"), false);

    const copy = join(dir, "copy.mp4");
    await storage.downloadFile("uploads/clip.mp4", copy);
    assert.deepEqual(await readFile(copy), Buffer.alloc(3000, 7));
    await assert.rejects(storage.downloadFile("uploads/missing.mp4", join(dir, "x")), /not found/);

    assert.deepEqual((await storage.listFiles("jobs/1")).sort(), ["jobs/1/output.mp4", "jobs/1/subtitles.srt"]);
    const sizes = await storage.listFilesWithSizes("");
    assert.equal(sizes.length, 4, "every page of the listing is read");
    assert.equal(sizes.reduce((sum, file) => sum + file.size, 0), 3000 + 1000 + 500 + objects.get("jobs/1/subtitles.srt").body.length);

    const link = new URL(await storage.getSignedUrl("jobs/1/output.mp4", 3600));
    assert.equal(link.hostname, "reellingo-videos.test-account.r2.cloudflarestorage.com");
    assert.equal(link.pathname, "/jobs/1/output.mp4");
    assert.ok(link.searchParams.get("X-Amz-Signature"), "the link is signed");
    assert.equal(link.searchParams.get("X-Amz-Expires"), "3600");
    const download = new URL(await storage.getSignedUrl("jobs/1/output.mp4", 3600, "Lagos.en.mp4"));
    assert.equal(download.searchParams.get("response-content-disposition"), 'attachment; filename="Lagos.en.mp4"');
    assert.equal(new URL(await storage.getSignedUrl("jobs/1/output.mp4", 30 * 24 * 3600)).searchParams.get("X-Amz-Expires"), String(7 * 24 * 3600), "links are capped at R2's 7-day maximum");

    await storage.deleteFiles(["jobs/1/output.mp4", "jobs/1/subtitles.srt"]);
    assert.deepEqual(await storage.listFiles("jobs/1"), []);
    assert.equal(objects.size, 2);
  } finally {
    storage.useStorageDriver(null);
    await rm(dir, { recursive: true, force: true });
  }
});

test("the storage provider is chosen from settings, with clear errors when keys are missing", () => {
  const saved = { provider: config.storageProvider, r2: { ...config.r2 }, supabaseUrl: config.supabaseUrl, supabaseKey: config.supabaseKey };
  try {
    Object.assign(config, { storageProvider: "", supabaseUrl: "", supabaseKey: "" });
    Object.assign(config.r2, { accountId: "", accessKeyId: "", secretAccessKey: "" });
    assert.equal(storage.storageProvider(), "local");
    Object.assign(config, { supabaseUrl: "https://x.supabase.co", supabaseKey: "k" });
    assert.equal(storage.storageProvider(), "supabase");
    Object.assign(config.r2, { accountId: "a", accessKeyId: "b", secretAccessKey: "c" });
    assert.equal(storage.storageProvider(), "r2", "R2 is used automatically once its keys are set");
    config.storageProvider = "supabase";
    assert.equal(storage.storageProvider(), "supabase", "an explicit STORAGE_PROVIDER wins");
    Object.assign(config.r2, { accountId: "" });
    assert.throws(() => storage.createStorageDriver("r2"), /R2_ACCOUNT_ID/);
  } finally {
    Object.assign(config, { storageProvider: saved.provider, supabaseUrl: saved.supabaseUrl, supabaseKey: saved.supabaseKey });
    Object.assign(config.r2, saved.r2);
  }
});
