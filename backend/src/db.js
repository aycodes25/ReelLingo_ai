import initSqlJs from "sql.js";
import pg from "pg";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { config } from "./config.js";

const { Pool } = pg;
const require = createRequire(import.meta.url);
export let isPostgres = /^postgres(?:ql)?:/i.test(config.databaseUrl);
let sqlite;
let pool;
let databaseFile;

// Column types written once and rendered for each engine.
const TYPES = {
  id: (pg) => (pg ? "BIGSERIAL PRIMARY KEY" : "INTEGER PRIMARY KEY AUTOINCREMENT"),
  text: () => "TEXT",
  int: (pg) => (pg ? "BIGINT" : "INTEGER"),
  real: (pg) => (pg ? "DOUBLE PRECISION" : "REAL"),
  bool: (pg) => (pg ? "BOOLEAN" : "INTEGER"),
  time: (pg) => (pg ? "TIMESTAMPTZ" : "TEXT"),
};

function column([name, type, extra = ""], pg = isPostgres) {
  let rendered = TYPES[type](pg);
  if (type === "bool") rendered += ` NOT NULL DEFAULT ${/true/.test(extra) ? (pg ? "TRUE" : "1") : (pg ? "FALSE" : "0")}`;
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
      ["created_at", "time", NOW], ["updated_at", "time"], ["plan_code", "text"],
    ],
    indexes: [
      "CREATE INDEX IF NOT EXISTS jobs_user_created ON jobs (user_id, created_at)",
      "CREATE INDEX IF NOT EXISTS jobs_status ON jobs (status)",
      "CREATE INDEX IF NOT EXISTS jobs_team ON jobs (team_id)",
      "CREATE INDEX IF NOT EXISTS jobs_batch ON jobs (batch_id)",
      "CREATE UNIQUE INDEX IF NOT EXISTS jobs_share_slug ON jobs (share_slug)",
      "CREATE INDEX IF NOT EXISTS jobs_plan_code ON jobs (plan_code, created_at)",
    ],
  },
  {
    name: "plans",
    columns: [
      ["id", "id"], ["code", "text", "NOT NULL UNIQUE"], ["name", "text", "NOT NULL"], ["blurb", "text"],
      ["price_usd", "real", "NOT NULL DEFAULT 0"], ["price_ngn", "int", "NOT NULL DEFAULT 0"],
      ["max_video_minutes", "int", "NOT NULL DEFAULT 3"],
      ["voice_clone", "bool"], ["watermark", "bool"], ["priority", "int", "NOT NULL DEFAULT 0"], ["max_targets", "int", "NOT NULL DEFAULT 1"],
      ["lip_sync", "bool"], ["api_access", "bool"], ["team_seats", "int", "NOT NULL DEFAULT 1"], ["saved_voices", "int", "NOT NULL DEFAULT 0"],
      ["features_json", "text"], ["sort", "int", "NOT NULL DEFAULT 0"], ["public", "bool", "true"],
      ["permissions_json", "text"], ["contact_sales", "bool"],
      ["minutes_per_month", "int", "NOT NULL DEFAULT 0"], ["price_usd_yearly", "real", "NOT NULL DEFAULT 0"], ["price_ngn_yearly", "int", "NOT NULL DEFAULT 0"],
    ],
  },
  {
    name: "subscriptions",
    columns: [
      ["id", "id"], ["user_id", "text", "NOT NULL UNIQUE"], ["tier", "text", "NOT NULL DEFAULT 'free'"],
      ["max_video_minutes", "int", "NOT NULL DEFAULT 3"],
      ["status", "text", "NOT NULL DEFAULT 'active'"],
      ["provider", "text"], ["provider_ref", "text"], ["provider_customer", "text"], ["current_period_end", "time"],
      ["cancel_at_period_end", "bool"], ["updated_at", "time"], ["overrides_json", "text"], ["billing_cycle", "text"],
    ],
  },
  {
    name: "payments",
    columns: [
      ["id", "id"], ["user_id", "text", "NOT NULL"], ["billing_id", "text", "NOT NULL"], ["provider", "text", "NOT NULL"],
      ["reference", "text", "NOT NULL UNIQUE"], ["kind", "text", "NOT NULL"], ["plan_code", "text"], ["credit_pack", "text"],
      ["amount", "int", "NOT NULL DEFAULT 0"], ["currency", "text", "NOT NULL"], ["status", "text", "NOT NULL DEFAULT 'pending'"],
      ["raw_json", "text"], ["created_at", "time", NOW], ["updated_at", "time"], ["billing_cycle", "text"],
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
      ["is_admin", "bool"], ["disabled", "bool"], ["admin_notes", "text"], ["last_seen_at", "time"],
      ["is_reviewer", "bool"], ["reviewer_languages", "text"], ["terms_accepted_at", "time"], ["terms_version", "text"],
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
    // What the owner bought from each paid provider (when the provider can't report it), for the usage dashboard.
    name: "provider_budgets",
    columns: [
      ["provider", "text", "PRIMARY KEY"], ["kind", "text", "NOT NULL DEFAULT 'usd'"], ["amount", "real", "NOT NULL DEFAULT 0"],
      ["unit", "text"], ["period", "text", "NOT NULL DEFAULT 'monthly'"], ["started_at", "time"], ["alert_percent", "int", "NOT NULL DEFAULT 80"],
      ["notes", "text"], ["last_alert_at", "time"], ["updated_at", "time"],
    ],
  },
  {
    // Optional monthly spending caps for individual users.
    name: "user_budgets",
    columns: [
      ["user_id", "text", "PRIMARY KEY"], ["monthly_usd_cap", "real"], ["monthly_characters_cap", "int"], ["notes", "text"], ["updated_at", "time"],
    ],
  },
  {
    // Every change to an account's minutes: plan spending, packs, refunds, referral rewards, admin grants.
    name: "minute_ledger",
    columns: [
      ["id", "id"], ["billing_id", "text", "NOT NULL"], ["delta", "real", "NOT NULL"], ["bucket", "text", "NOT NULL"],
      ["kind", "text", "NOT NULL"], ["job_id", "int"], ["reference", "text"], ["note", "text"], ["created_by", "text"],
      ["created_at", "time", NOW],
    ],
    indexes: [
      "CREATE INDEX IF NOT EXISTS minute_ledger_billing ON minute_ledger (billing_id, created_at)",
      "CREATE INDEX IF NOT EXISTS minute_ledger_job ON minute_ledger (job_id, reference)",
    ],
  },
  {
    // Human review: a native speaker checks the transcript and translation before the voice is generated.
    name: "review_tasks",
    columns: [
      ["id", "id"], ["job_id", "int", "NOT NULL"], ["language", "text", "NOT NULL"], ["status", "text", "NOT NULL DEFAULT 'open'"],
      ["reviewer_id", "text"], ["minutes", "real", "NOT NULL DEFAULT 0"], ["payout_ngn", "int", "NOT NULL DEFAULT 0"],
      ["claimed_at", "time"], ["submitted_at", "time"], ["paid_at", "time"], ["notes", "text"], ["created_at", "time", NOW],
    ],
    indexes: [
      "CREATE INDEX IF NOT EXISTS review_tasks_status ON review_tasks (status, language)",
      "CREATE INDEX IF NOT EXISTS review_tasks_job ON review_tasks (job_id)",
    ],
  },
  {
    // Voice Lab: samples generated by the admin and rated by native speakers.
    name: "voice_tests",
    columns: [
      ["id", "id"], ["language", "text", "NOT NULL"], ["engine", "text", "NOT NULL"], ["voice", "text"], ["text", "text", "NOT NULL"],
      ["audio_path", "text"], ["rating", "int"], ["notes", "text"], ["created_by", "text"], ["created_at", "time", NOW],
    ],
  },
  {
    // Who changed what in the admin area. Optional: the app runs without it, but changes then go unrecorded.
    name: "admin_audit",
    optional: true,
    columns: [
      ["id", "id"], ["admin_id", "text"], ["admin_email", "text"], ["action", "text", "NOT NULL"], ["target", "text"], ["details", "text"],
      ["created_at", "time", NOW],
    ],
    indexes: ["CREATE INDEX IF NOT EXISTS admin_audit_created ON admin_audit (created_at)"],
  },
  {
    name: "app_settings",
    columns: [["key", "text", "PRIMARY KEY"], ["value", "text"], ["updated_at", "time"], ["updated_by", "text"]],
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

let lockPool;

/**
 * Runs `task` while holding a lock that is shared by every server and worker connected to the same database.
 * Postgres uses an advisory lock (no tables or schema changes needed); the lock is held on its own small pool so
 * waiting for locks can never use up the connections the task itself needs. SQLite is a single process, so callers
 * only need their in-process lock there.
 */
export async function withDbLock(key, task, { timeoutMs = 30_000 } = {}) {
  if (!isPostgres) return task();
  lockPool ||= new Pool({ connectionString: config.databaseUrl, application_name: "reellingo-api", ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined, max: 5 });
  const client = await lockPool.connect();
  let locked = false;
  try {
    await client.query(`SET lock_timeout = ${Math.round(timeoutMs)}`);
    await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [String(key)]);
    locked = true;
    return await task();
  } finally {
    // A connection that failed to unlock must not go back to the pool still holding the lock.
    let broken = false;
    if (locked) {
      try {
        await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [String(key)]);
      } catch {
        broken = true;
      }
    }
    client.release(broken);
  }
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

/**
 * The full Postgres schema as SQL, for the owner to run themselves in the Supabase SQL Editor.
 * Safe to run repeatedly. Every table gets Row Level Security and is closed to Supabase's public API roles:
 * the backend connects as the database owner (DATABASE_URL), which isn't affected by either.
 */
export function postgresSchemaSql(seedStatements = []) {
  const lines = [
    "-- ReelLingo database schema for Supabase (Postgres).",
    "-- Generated from backend/src/db.js by `npm run sql` — do not edit by hand.",
    "-- Run it yourself: Supabase dashboard → SQL Editor → New query → paste this file → Run.",
    "-- Safe to run more than once: it only adds what's missing and never deletes data.",
    "",
    "BEGIN;",
    "",
  ];
  for (const table of SCHEMA) {
    lines.push(`-- ${table.name}`);
    lines.push(`CREATE TABLE IF NOT EXISTS public.${table.name} (\n  ${table.columns.map((definition) => column(definition, true)).join(",\n  ")}\n);`);
    for (const definition of table.columns) {
      if (definition[1] === "id" || /PRIMARY KEY/.test(definition[2] || "")) continue;
      // Adding a NOT NULL column without a default fails on a table that already has rows, so those stay nullable.
      const rendered = column(definition, true);
      lines.push(`ALTER TABLE public.${table.name} ADD COLUMN IF NOT EXISTS ${/DEFAULT/.test(rendered) ? rendered : rendered.replace(/ NOT NULL/, "")};`);
    }
    for (const statement of table.indexes || []) lines.push(`${statement.replace(/ ON (\w+) /, " ON public.$1 ")};`);
    lines.push(`ALTER TABLE public.${table.name} ENABLE ROW LEVEL SECURITY;`);
    lines.push(`REVOKE ALL ON public.${table.name} FROM anon, authenticated;`);
    lines.push("");
  }
  if (seedStatements.length) {
    lines.push("-- Default plans (from .docs/monetization.md). Existing plans are left untouched.");
    lines.push(...seedStatements, "");
  }
  lines.push("COMMIT;", "");
  return lines.join("\n");
}

/** Postgres: read-only check that the tables the app needs exist, with clear instructions if not. */
async function verifyPostgresSchema() {
  const missing = [];
  for (const table of SCHEMA) {
    const present = await existingColumns(table.name);
    if (!present.size) {
      if (table.optional) {
        const { logger } = await import("./logger.js");
        logger.warn(`The optional table ${table.name} doesn't exist yet. Run backend/sql/schema.sql in the Supabase SQL Editor to switch it on.`);
      } else {
        missing.push(`table ${table.name}`);
      }
      continue;
    }
    for (const [name] of table.columns) if (!present.has(name)) missing.push(`column ${table.name}.${name}`);
  }
  if (missing.length) {
    const error = new Error(
      `Your database is missing ${missing.length} item(s) the app needs (${missing.slice(0, 6).join(", ")}${missing.length > 6 ? ", …" : ""}).\n`
      + "ReelLingo never changes your Supabase database by itself. To fix this, open Supabase → SQL Editor → New query,\n"
      + "paste the contents of backend/sql/schema.sql, and click Run. Then start the backend again.",
    );
    error.code = "SCHEMA_MISSING";
    throw error;
  }
  const unprotected = (await many(
    "SELECT relname FROM pg_class JOIN pg_namespace ON pg_namespace.oid = relnamespace WHERE nspname = current_schema() AND relkind = 'r' AND relname = ANY($1) AND NOT relrowsecurity",
    [SCHEMA.map((table) => table.name)],
  )).map((row) => row.relname);
  return { unprotected };
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
    try {
      pool = new Pool({
        connectionString: config.databaseUrl,
        application_name: "reellingo-api",
        ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
        connectionTimeoutMillis: 5000,
      });
      await pool.query("SELECT 1");
      // Never alter a hosted database automatically: the owner applies backend/sql/schema.sql themselves.
      const { unprotected } = await verifyPostgresSchema();
      if (unprotected.length) {
        const { logger } = await import("./logger.js");
        logger.warn({ tables: unprotected }, "Row Level Security is OFF on these tables. Run backend/sql/schema.sql in the Supabase SQL Editor to switch it on.");
      }
    } catch (err) {
      const { logger } = await import("./logger.js");
      logger.warn({ err: err.message }, "Hosted PostgreSQL (Supabase) unreachable. Falling back to local SQLite database.");
      await pool?.end().catch(() => {});
      pool = null;
      isPostgres = false;
    }
  }
  if (!isPostgres) {
    databaseFile = config.databaseUrl.startsWith("sqlite:///")
      ? resolve(config.databaseUrl.slice("sqlite:///".length))
      : resolve("./local.db");
    mkdirSync(dirname(databaseFile), { recursive: true });
    const SQL = await initSqlJs({ wasmBinary: readFileSync(require.resolve("sql.js/dist/sql-wasm.wasm")) });
    sqlite = existsSync(databaseFile) ? new SQL.Database(readFileSync(databaseFile)) : new SQL.Database();
    await migrate();
    const { seedPlans } = await import("./plans.js");
    await seedPlans();
  }
  const { loadSettings } = await import("./settings.js");
  await loadSettings();
  persist();
}

export async function closeDatabase() {
  sqlite?.close();
  sqlite = null;
  const closing = [pool?.end(), lockPool?.end()];
  pool = null;
  lockPool = null;
  await Promise.all(closing);
}
