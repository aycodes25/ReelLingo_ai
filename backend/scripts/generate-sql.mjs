// Writes the SQL files the owner runs by hand in the Supabase SQL Editor. Never connects to any database.
// Usage (from backend/):  npm run sql
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

process.env.DATABASE_URL = "sqlite:///:memory:";
const { postgresSchemaSql, SCHEMA } = await import("../src/db.js");
const { planSeedSql } = await import("../src/plans.js");

const directory = join(dirname(fileURLToPath(import.meta.url)), "..", "sql");
mkdirSync(directory, { recursive: true });
const tables = SCHEMA.map((table) => `'${table.name}'`).join(", ");

writeFileSync(join(directory, "schema.sql"), postgresSchemaSql(planSeedSql()));

writeFileSync(join(directory, "check.sql"), `-- Read-only check. Changes nothing.
-- Supabase dashboard → SQL Editor → New query → paste → Run.
-- Shows every table in your public schema, whether Row Level Security is on,
-- and whether it's one of ReelLingo's tables.
SELECT
  c.relname AS table_name,
  CASE WHEN c.relrowsecurity THEN 'ON' ELSE 'OFF  <-- needs fixing' END AS row_level_security,
  CASE WHEN c.relname IN (${tables}) THEN 'ReelLingo' ELSE 'other' END AS created_by,
  (SELECT count(*) FROM information_schema.columns col WHERE col.table_schema = 'public' AND col.table_name = c.relname) AS columns
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY row_level_security DESC, table_name;
`);

console.log(`Wrote ${join(directory, "schema.sql")} and check.sql (${SCHEMA.length} tables).`);
