// Developer tool: shows, line by line, how a local dub fits the time available (run dub-local.mjs first).
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const scratch = join(resolve(dirname(fileURLToPath(import.meta.url)), "..", ".."), ".dev-dub");
Object.assign(process.env, { DATABASE_URL: `sqlite:///${join(scratch, "dev.db").replaceAll("\\", "/")}`, LOCAL_STORAGE_DIR: join(scratch, "storage"), STORAGE_PROVIDER: "local", SUPABASE_URL: "", SUPABASE_KEY: "", WORKER_MODE: "off", NODE_ENV: "development" });
const database = await import("../../src/database.js");
await database.initializeDatabase();
const job = await database.getJob(Number(process.argv[2] || 1));
const original = job.transcript_json, text = job.translated_segments_json, timeline = job.options_json.dub_timeline || [];
let chars = 0, secs = 0;
for (const [index, start, end, speed, natural] of timeline) {
  chars += text[index].text.length; secs += natural;
  const slot = original[index].end - original[index].start;
  console.log(`${String(index).padStart(3)} ${original[index].speaker||""} slot ${original[index].start.toFixed(1)}-${original[index].end.toFixed(1)} (${slot.toFixed(1)}s) -> ${start}-${end} x${speed} nat ${natural}s ${text[index].text.length}ch | ${text[index].text.slice(0,50)}`);
}
console.log(`actual chars/sec: ${(chars / secs).toFixed(1)}`);
const speakers = {};
for (const s of original) speakers[s.speaker] = (speakers[s.speaker] || 0) + s.end - s.start;
console.log(speakers);
if (process.argv[3]) (await import("node:fs")).writeFileSync(process.argv[3], JSON.stringify({ original, timeline }));
await database.closeDatabase();
