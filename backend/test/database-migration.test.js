import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import initSqlJs from "sql.js";
import test from "node:test";

const require = createRequire(import.meta.url);
const backendDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("SQLite startup migrates existing jobs tables with transcript fields", async () => {
  const directory = await mkdtemp(join(tmpdir(), "reellingo-db-migration-"));
  const databasePath = join(directory, "existing.db");
  const SQL = await initSqlJs({ wasmBinary: await readFile(require.resolve("sql.js/dist/sql-wasm.wasm")) });
  const oldDatabase = new SQL.Database();
  oldDatabase.exec(`
    CREATE TABLE jobs (
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
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await writeFile(databasePath, Buffer.from(oldDatabase.export()));
  oldDatabase.close();

  try {
    const script = `
      import { initializeDatabase, createJob, updateJob, getJob, closeDatabase } from './src/database.js';
      await initializeDatabase();
      const job = await createJob({ user_id: 'migration-test', source_language: 'auto', target_language: 'en', voice_clone: false, input_storage_path: 'uploads/test.mp4' });
      await updateJob(job.id, { transcript_json: JSON.stringify([{ start: 0, end: 1, text: 'spoken words', language: 'en' }]), detected_languages_json: JSON.stringify(['en']), duration_seconds: 10 });
      const migrated = await getJob(job.id);
      if (migrated.transcript_json?.[0]?.text !== 'spoken words' || migrated.duration_seconds !== 10) process.exitCode = 1;
      await closeDatabase();
      process.stdout.write('migration-ok');
    `;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      cwd: backendDirectory,
      encoding: "utf8",
      env: { ...process.env, DATABASE_URL: `sqlite:///${databasePath.replaceAll("\\", "/")}` },
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(result.stdout, "migration-ok");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
