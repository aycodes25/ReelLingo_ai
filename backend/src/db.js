import initSqlJs from "sql.js";
import pg from "pg";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { config } from "./config.js";

const { Pool } = pg;
const require = createRequire(import.meta.url);
export const isPostgres = /^postgres(?:ql)?:/i.test(config.databaseUrl);
let sqlite;
let pool;
let databaseFile;

// Column types written once and rendered for each engine.
const TYPES = {
  id: () => (isPostgres ? "BIGSERIAL PRIMARY KEY" : "INTEGER PRIMARY KEY AUTOINCREMENT"),
  text: () => "TEXT",
  int: () => (isPostgres ? "BIGINT" : "INTEGER"),
  real: () => (isPostgres ? "DOUBLE PRECISION" : "REAL"),
  bool: () => (isPostgres ? "BOOLEAN" : "INTEGER"),
  time: () => (isPostgres ? "TIMESTAMPTZ" : "TEXT"),
};

function column([name, type, extra = ""]) {
  let rendered = TYPES[type]();
  if (type === "bool") rendered += ` NOT NULL DEFAULT ${/true/.test(extra) ? (isPostgres ? "TRUE" : "1") : (isPostgres ? "FALSE" : "0")}`;
  else if (extra) rendered += ` ${extra}`;
  return `${name} ${rendered}`;
}

const NOW = "NOT NULL DEFAULT CURRENT_TIMESTAMP";

export const SCHEMA = [
  {
    name: "jobs",
    columns: [
      ["id", "id"], ["user_id", "text"], ["team_id", "int"], ["batch_id", "text"], ["depends_on", "int"],
      ["status", "text", "NOT NULL DEFAULT 'queued'"], ["current_step", "text", "NOT NULL DEFAULT 'queued'"],
      ["source_language", "text", "NOT NULL"], ["target_language", "text", "NOT NULL"], ["voice_clone", "bool"],
      ["input_storage_path", "text", "NOT NULL DEFAULT ''"], ["source_url", "text"], ["media_type", "text", "NOT NULL DEFAULT 'video'"],
      ["options_json", "text"], ["output_video_path", "text"], ["output_srt_path", "text"], ["outputs_json", "text"],
      ["transcript_json", "text"], ["translated_segments_json", "text"], ["detected_languages_json", "text"],
      ["metadata_json", "text"], ["speakers_json", "text"], ["clips_json", "text"],
      ["duration_seconds", "real"], ["error_message", "text"], ["original_filename", "text"], ["processing_note", "text"],
      ["priority", "int", "NOT NULL DEFAULT 0"], ["attempts", "int", "NOT NULL DEFAULT 0"], ["heartbeat_at", "time"],
      ["started_at", "time"], ["completed_at", "time"], ["review_state", "text"], ["redub_count", "int", "NOT NULL DEFAULT 0"],
      ["share_slug", "text"], ["share_original", "bool"], ["deleted_at", "time"], ["files_expired_at", "time"], ["credit_id", "int"],
      ["created_at", "time", NOW], ["updated_at", "time"],
    ],
    indexes: [
      "CREATE INDEX IF NOT EXISTS jobs_user_created ON jobs (user_id, created_at)",
      "CREATE INDEX IF NOT EXISTS jobs_status ON jobs (status)",
      "CREATE INDEX IF NOT EXISTS jobs_team ON jobs (team_id)",
      "CREATE INDEX IF NOT EXISTS jobs_batch ON jobs (batch_id)",
      "CREATE UNIQUE INDEX IF NOT EXISTS jobs_share_slug ON jobs (share_slug)",
    ],
  },
  {
    name: "plans",
    columns: [
      ["id", "id"], ["code", "text", "NOT NULL UNIQUE"], ["name", "text", "NOT NULL"], ["blurb", "text"],
      ["price_usd", "real", "NOT NULL DEFAULT 0"], ["price_ngn", "int", "NOT NULL DEFAULT 0"],
      ["videos_per_month", "int", "NOT NULL DEFAULT 1"], ["max_video_minutes", "int", "NOT NULL DEFAULT 3"],
      ["voice_clone", "bool"], ["watermark", "bool"], ["priority", "int", "NOT NULL DEFAULT 0"], ["max_targets", "int", "NOT NULL DEFAULT 1"],
      ["lip_sync", "bool"], ["api_access", "bool"], ["team_seats", "int", "NOT NULL DEFAULT 1"], ["saved_voices", "int", "NOT NULL DEFAULT 0"],
      ["features_json", "text"], ["sort", "int", "NOT NULL DEFAULT 0"], ["public", "bool", "true"],
    ],
  },
  {
    name: "subscriptions",
    columns: [
      ["id", "id"], ["user_id", "text", "NOT NULL UNIQUE"], ["tier", "text", "NOT NULL DEFAULT 'free'"],
      ["videos_used_this_month", "int", "NOT NULL DEFAULT 0"], ["max_video_minutes", "int", "NOT NULL DEFAULT 3"],
      ["max_videos_per_month", "int", "NOT NULL DEFAULT 1"], ["status", "text", "NOT NULL DEFAULT 'active'"],
      ["provider", "text"], ["provider_ref", "text"], ["provider_customer", "text"], ["current_period_end", "time"],
      ["cancel_at_period_end", "bool"], ["updated_at", "time"],
    ],
  },
  {
    name: "payments",
    columns: [
      ["id", "id"], ["user_id", "text", "NOT NULL"], ["billing_id", "text", "NOT NULL"], ["provider", "text", "NOT NULL"],
      ["reference", "text", "NOT NULL UNIQUE"], ["kind", "text", "NOT NULL"], ["plan_code", "text"], ["credit_pack", "text"],
      ["amount", "int", "NOT NULL DEFAULT 0"], ["currency", "text", "NOT NULL"], ["status", "text", "NOT NULL DEFAULT 'pending'"],
      ["raw_json", "text"], ["created_at", "time", NOW], ["updated_at", "time"],
    ],
    indexes: ["CREATE INDEX IF NOT EXISTS payments_billing ON payments (billing_id, created_at)"],
  },
  {
    name: "credits",
    columns: [
      ["id", "id"], ["billing_id", "text", "NOT NULL"], ["max_minutes", "int", "NOT NULL"], ["source", "text", "NOT NULL"],
      ["reference", "text"], ["job_id", "int"], ["created_at", "time", NOW], ["expires_at", "time"],
    ],
    indexes: ["CREATE INDEX IF NOT EXISTS credits_billing ON credits (billing_id, job_id)"],
  },
  {
    name: "profiles",
    columns: [
      ["user_id", "text", "PRIMARY KEY"], ["email", "text"], ["name", "text"], ["creator_type", "text"], ["phone", "text"],
      ["notify_email", "bool", "true"], ["notify_whatsapp", "bool"], ["referral_code", "text"], ["referred_by", "text"],
      ["referral_rewarded", "bool"], ["created_at", "time", NOW], ["updated_at", "time"],
    ],
    indexes: ["CREATE UNIQUE INDEX IF NOT EXISTS profiles_referral_code ON profiles (referral_code)"],
  },
  {
    name: "voices",
    columns: [
      ["id", "id"], ["user_id", "text", "NOT NULL"], ["name", "text", "NOT NULL"], ["provider", "text", "NOT NULL DEFAULT 'elevenlabs'"],
      ["provider_voice_id", "text", "NOT NULL"], ["consent_at", "time", NOW], ["created_at", "time", NOW], ["last_used_at", "time"],
    ],
  },
  {
    name: "glossary_terms",
    columns: [
      ["id", "id"], ["user_id", "text", "NOT NULL"], ["term", "text", "NOT NULL"], ["translation", "text"],
      ["target_language", "text"], ["note", "text"], ["created_at", "time", NOW],
    ],
  },
  {
    name: "teams",
    columns: [["id", "id"], ["name", "text", "NOT NULL"], ["owner_id", "text", "NOT NULL"], ["created_at", "time", NOW]],
  },
  {
    name: "team_members",
    columns: [
      ["id", "id"], ["team_id", "int", "NOT NULL"], ["user_id", "text"], ["email", "text", "NOT NULL"],
      ["role", "text", "NOT NULL DEFAULT 'member'"], ["status", "text", "NOT NULL DEFAULT 'invited'"], ["created_at", "time", NOW],
    ],
    indexes: ["CREATE UNIQUE INDEX IF NOT EXISTS team_members_email ON team_members (team_id, email)"],
  },
  {
    name: "api_keys",
    columns: [
      ["id", "id"], ["user_id", "text", "NOT NULL"], ["name", "text", "NOT NULL"], ["prefix", "text", "NOT NULL"],
      ["key_hash", "text", "NOT NULL UNIQUE"], ["created_at", "time", NOW], ["last_used_at", "time"], ["revoked_at", "time"],
    ],
  },
  {
    name: "cost_events",
    columns: [
      ["id", "id"], ["job_id", "int"], ["user_id", "text"], ["provider", "text", "NOT NULL"], ["operation", "text", "NOT NULL"],
      ["units", "real", "NOT NULL DEFAULT 0"], ["unit", "text"], ["cost_usd", "real", "NOT NULL DEFAULT 0"], ["created_at", "time", NOW],
    ],
    indexes: ["CREATE INDEX IF NOT EXISTS cost_events_job ON cost_events (job_id)", "CREATE INDEX IF NOT EXISTS cost_events_created ON cost_events (created_at)"],
  },
  {
    name: "integrations",
    columns: [
      ["id", "id"], ["user_id", "text", "NOT NULL"], ["provider", "text", "NOT NULL"], ["data_encrypted", "text", "NOT NULL"],
      ["account_label", "text"], ["created_at", "time", NOW], ["updated_at", "time"],
    ],
    indexes: ["CREATE UNIQUE INDEX IF NOT EXISTS integrations_user_provider ON integrations (user_id, provider)"],
  },
];

function persist() {
  if (sqlite && databaseFile) writeFileSync(databaseFile, Buffer.from(sqlite.export()));
}

// Queries are written with Postgres placeholders ($1, $2…); SQLite accepts the same numbering as ?1, ?2….
function sqliteQuery(sql, params) {
  const statement = sqlite.prepare(sql.replace(/\$(\d+)/g, "?$1"));
  const rows = [];
  try {
    statement.bind(params.map((value) => (typeof value === "boolean" ? Number(value) : value === undefined ? null : value)));
    while (statement.step()) rows.push(statement.getAsObject());
  } finally {
    statement.free();
  }
  const changes = sqlite.getRowsModified();
  if (!/^\s*(SELECT|PRAGMA|WITH)\b/i.test(sql)) persist();
  return { rows, rowCount: changes || rows.length };
}

export async function query(sql, params = []) {
  if (isPostgres) {
    const result = await pool.query(sql, params);
    return { rows: result.rows, rowCount: result.rowCount };
  }
  return sqliteQuery(sql, params);
}

export async function many(sql, params = []) {
  return (await query(sql, params)).rows;
}

export async function one(sql, params = []) {
  return (await query(sql, params)).rows[0] || null;
}

/** Formats a Date the way each engine compares timestamps (SQLite stores "YYYY-MM-DD HH:MM:SS" UTC text). */
export function dbTime(date = new Date()) {
  const iso = new Date(date).toISOString();
  return isPostgres ? iso : iso.slice(0, 19).replace("T", " ");
}

export function toBool(value) {
  return value === true || value === 1 || value === "1" || value === "t" || value === "true";
}

async function existingColumns(table) {
  if (isPostgres) {
    const rows = await many("SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1", [table]);
    return new Set(rows.map((row) => row.column_name));
  }
  return new Set(sqliteQuery(`PRAGMA table_info(${table})`, []).rows.map((row) => row.name));
}

async function migrate() {
  for (const table of SCHEMA) {
    await query(`CREATE TABLE IF NOT EXISTS ${table.name} (${table.columns.map(column).join(", ")})`);
    const present = await existingColumns(table.name);
    for (const definition of table.columns) {
      if (present.has(definition[0])) continue;
      // Added columns cannot be NOT NULL without a default, and SQLite rejects non-constant defaults.
      const rendered = column(definition).replace(/\s*NOT NULL DEFAULT CURRENT_TIMESTAMP/, "").replace(/\s*(PRIMARY KEY|UNIQUE)/g, "");
      await query(`ALTER TABLE ${table.name} ADD COLUMN ${rendered}`);
    }
    for (const statement of table.indexes || []) await query(statement);
  }
}

export async function initializeDatabase() {
  if (isPostgres) {
    pool = new Pool({ connectionString: config.databaseUrl, ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined });
  } else {
    databaseFile = config.databaseUrl.startsWith("sqlite:///")
      ? resolve(config.databaseUrl.slice("sqlite:///".length))
      : resolve("./local.db");
    mkdirSync(dirname(databaseFile), { recursive: true });
    const SQL = await initSqlJs({ wasmBinary: readFileSync(require.resolve("sql.js/dist/sql-wasm.wasm")) });
    sqlite = existsSync(databaseFile) ? new SQL.Database(readFileSync(databaseFile)) : new SQL.Database();
  }
  await migrate();
  const { seedPlans } = await import("./plans.js");
  await seedPlans();
  persist();
}

export async function closeDatabase() {
  sqlite?.close();
  sqlite = null;
  const closing = pool?.end();
  pool = null;
  await closing;
}
