import initSqlJs from "sql.js";
import pg from "pg";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { config } from "./config.js";

const { Pool } = pg;
const require = createRequire(import.meta.url);
const isPostgres = /^postgres(?:ql)?:/i.test(config.databaseUrl);
const JSON_FIELDS = ["transcript_json", "translated_segments_json", "detected_languages_json"];
let sqlite;
let pool;
let databaseFile;

function sqliteOne(sql, values = []) {
  const statement = sqlite.prepare(sql);
  try {
    statement.bind(values);
    return statement.step() ? statement.getAsObject() : null;
  } finally {
    statement.free();
  }
}

function sqliteMany(sql, values = []) {
  const statement = sqlite.prepare(sql);
  const rows = [];
  try {
    statement.bind(values);
    while (statement.step()) rows.push(statement.getAsObject());
    return rows;
  } finally {
    statement.free();
  }
}

function sqliteRun(sql, values = []) {
  sqlite.run(sql, values);
  const result = sqlite.exec("SELECT last_insert_rowid() AS id")[0];
  writeFileSync(databaseFile, Buffer.from(sqlite.export()));
  return { id: result?.values[0]?.[0] };
}

function normalizeJob(job) {
  if (!job) return null;
  for (const field of JSON_FIELDS) {
    if (typeof job[field] === "string") {
      try {
        job[field] = JSON.parse(job[field]);
      } catch {
        job[field] = null;
      }
    }
  }
  return job;
}

export async function initializeDatabase() {
  if (isPostgres) {
    pool = new Pool({ connectionString: config.databaseUrl, ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined });
    await pool.query(`
      CREATE TABLE IF NOT EXISTS jobs (
        id BIGSERIAL PRIMARY KEY,
        user_id TEXT,
        status TEXT NOT NULL DEFAULT 'queued',
        current_step TEXT NOT NULL DEFAULT 'queued',
        source_language TEXT NOT NULL,
        target_language TEXT NOT NULL,
        voice_clone BOOLEAN NOT NULL DEFAULT FALSE,
        input_storage_path TEXT NOT NULL,
        output_video_path TEXT,
        output_srt_path TEXT,
        transcript_json TEXT,
        translated_segments_json TEXT,
        detected_languages_json TEXT,
        duration_seconds DOUBLE PRECISION,
        error_message TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS subscriptions (
        id BIGSERIAL PRIMARY KEY,
        user_id TEXT NOT NULL UNIQUE,
        tier TEXT NOT NULL DEFAULT 'free',
        videos_used_this_month INTEGER NOT NULL DEFAULT 0,
        max_video_minutes INTEGER NOT NULL DEFAULT 3,
        max_videos_per_month INTEGER NOT NULL DEFAULT 1
      );
    `);
    await pool.query(`
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS transcript_json TEXT;
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS translated_segments_json TEXT;
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS detected_languages_json TEXT;
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS duration_seconds DOUBLE PRECISION;
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS original_filename TEXT;
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS processing_note TEXT;
    `);
    return;
  }

  databaseFile = config.databaseUrl.startsWith("sqlite:///")
    ? resolve(config.databaseUrl.slice("sqlite:///".length))
    : resolve("./local.db");
  mkdirSync(dirname(databaseFile), { recursive: true });
  const wasmPath = require.resolve("sql.js/dist/sql-wasm.wasm");
  const wasmBinary = readFileSync(wasmPath);
  const SQL = await initSqlJs({ wasmBinary });
  sqlite = existsSync(databaseFile)
    ? new SQL.Database(readFileSync(databaseFile))
    : new SQL.Database();
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT,
      status TEXT NOT NULL DEFAULT 'queued',
      current_step TEXT NOT NULL DEFAULT 'queued',
      source_language TEXT NOT NULL,
      target_language TEXT NOT NULL,
      voice_clone INTEGER NOT NULL DEFAULT 0,
      input_storage_path TEXT NOT NULL,
      output_video_path TEXT,
      output_srt_path TEXT,
      transcript_json TEXT,
      translated_segments_json TEXT,
      detected_languages_json TEXT,
      duration_seconds REAL,
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL UNIQUE,
      tier TEXT NOT NULL DEFAULT 'free',
      videos_used_this_month INTEGER NOT NULL DEFAULT 0,
      max_video_minutes INTEGER NOT NULL DEFAULT 3,
      max_videos_per_month INTEGER NOT NULL DEFAULT 1
    );
  `);
  const columns = new Set(sqliteMany("PRAGMA table_info(jobs)").map((column) => column.name));
  const newColumns = [
    ["transcript_json", "TEXT"],
    ["translated_segments_json", "TEXT"],
    ["detected_languages_json", "TEXT"],
    ["duration_seconds", "REAL"],
    ["original_filename", "TEXT"],
    ["processing_note", "TEXT"],
  ];
  for (const [name, type] of newColumns) {
    if (!columns.has(name)) sqlite.exec(`ALTER TABLE jobs ADD COLUMN ${name} ${type}`);
  }
  writeFileSync(databaseFile, Buffer.from(sqlite.export()));
}

export async function getJob(id) {
  if (isPostgres) return normalizeJob((await pool.query("SELECT * FROM jobs WHERE id = $1", [id])).rows[0]);
  return normalizeJob(sqliteOne("SELECT * FROM jobs WHERE id = ?", [id]));
}

export async function createJob(job) {
  const values = [job.user_id, job.source_language, job.target_language, job.voice_clone, job.input_storage_path, job.original_filename || null];
  if (isPostgres) {
    const result = await pool.query(
      "INSERT INTO jobs (user_id, status, current_step, source_language, target_language, voice_clone, input_storage_path, original_filename) VALUES ($1, 'queued', 'queued', $2, $3, $4, $5, $6) RETURNING *",
      values,
    );
    return normalizeJob(result.rows[0]);
  }
  const result = sqliteRun(
    "INSERT INTO jobs (user_id, status, current_step, source_language, target_language, voice_clone, input_storage_path, original_filename) VALUES (?, 'queued', 'queued', ?, ?, ?, ?, ?)",
    values,
  );
  return getJob(result.id);
}

export async function updateJob(id, changes) {
  const allowedFields = new Set([
    "status", "current_step", "output_video_path", "output_srt_path", "error_message",
    "transcript_json", "translated_segments_json", "detected_languages_json", "duration_seconds",
    "voice_clone", "processing_note",
  ]);
  const entries = Object.entries(changes).filter(([key]) => allowedFields.has(key));
  if (entries.length === 0) return getJob(id);
  if (isPostgres) {
    const assignments = entries.map(([key], index) => `${key} = $${index + 1}`).join(", ");
    await pool.query(`UPDATE jobs SET ${assignments} WHERE id = $${entries.length + 1}`, [...entries.map(([, value]) => value), id]);
  } else {
    const assignments = entries.map(([key]) => `${key} = ?`).join(", ");
    sqliteRun(`UPDATE jobs SET ${assignments} WHERE id = ?`, [...entries.map(([, value]) => value), id]);
  }
  return getJob(id);
}

export async function getSubscription(userId) {
  if (isPostgres) return (await pool.query("SELECT * FROM subscriptions WHERE user_id = $1", [userId])).rows[0] || null;
  return sqliteOne("SELECT * FROM subscriptions WHERE user_id = ?", [userId]);
}

export async function listJobs(userId, limit = 10) {
  if (isPostgres) {
    return (await pool.query("SELECT * FROM jobs WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2", [userId, limit])).rows.map(normalizeJob);
  }
  return sqliteMany("SELECT * FROM jobs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?", [userId, limit]).map(normalizeJob);
}

export async function getMonthlyUsage(userId) {
  const row = isPostgres
    ? (await pool.query(
      "SELECT COUNT(*) AS videos, COALESCE(SUM(duration_seconds), 0) AS seconds FROM jobs WHERE user_id = $1 AND status <> 'failed' AND created_at >= date_trunc('month', CURRENT_TIMESTAMP)",
      [userId],
    )).rows[0]
    : sqliteOne(
      "SELECT COUNT(*) AS videos, COALESCE(SUM(duration_seconds), 0) AS seconds FROM jobs WHERE user_id = ? AND status <> 'failed' AND created_at >= date('now', 'start of month')",
      [userId],
    );
  return { videos: Number(row?.videos || 0), seconds: Number(row?.seconds || 0) };
}

// A job's pipeline runs inside the API process, so a restart leaves unfinished jobs orphaned.
export async function failInterruptedJobs() {
  const message = "Processing was interrupted because the server restarted. Please upload the video again.";
  if (isPostgres) {
    return (await pool.query("UPDATE jobs SET status = 'failed', error_message = $1 WHERE status IN ('queued', 'processing')", [message])).rowCount;
  }
  const count = Number(sqliteOne("SELECT COUNT(*) AS count FROM jobs WHERE status IN ('queued', 'processing')")?.count || 0);
  if (count) sqliteRun("UPDATE jobs SET status = 'failed', error_message = ? WHERE status IN ('queued', 'processing')", [message]);
  return count;
}

export function closeDatabase() {
  sqlite?.close();
  return pool?.end();
}