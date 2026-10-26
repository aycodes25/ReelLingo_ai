// Developer tool: prints the quality report of a local dub (run dub-local.mjs first).
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const scratch = join(resolve(dirname(fileURLToPath(import.meta.url)), "..", ".."), ".dev-dub");
Object.assign(process.env, { DATABASE_URL: `sqlite:///${join(scratch, "dev.db").replaceAll("\\", "/")}`, LOCAL_STORAGE_DIR: join(scratch, "storage"), STORAGE_PROVIDER: "local", SUPABASE_URL: "", SUPABASE_KEY: "", WORKER_MODE: "off", NODE_ENV: "development" });
const database = await import("../../src/database.js");
await database.initializeDatabase();
const job = await database.getJob(Number(process.argv[2] || 1));
console.log(JSON.stringify(job.options_json.quality_report, null, 1));
await database.closeDatabase();
