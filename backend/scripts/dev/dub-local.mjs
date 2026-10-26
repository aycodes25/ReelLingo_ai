// Developer tool: dub one video from the command line with the REAL providers, without touching Supabase or R2.
//
//   node scripts/dev/dub-local.mjs "../video dub/Awesome_Whye- original.mp4" --source pcm --target yo --clone
//
// It reads the API keys from backend/.env, but keeps everything else on this computer: a throw-away SQLite database and
// local storage under backend/.dev-dub/ (git-ignored). Providers are billed as usual (OpenAI, ElevenLabs, Spitch), so each
// run costs a little: by default the transcript, the translation and the voice lines of the previous run are reused.
//
// Options
//   --source <code>      language spoken in the video (default: auto)
//   --target <code>      language to dub into (default: yo)
//   --clone              copy the speaker's voice (needs an ElevenLabs plan that can clone)
//   --no-background      don't keep the original music and effects
//   --captions <style>   classic | boxed | bold | karaoke
//   --fresh-transcript   transcribe again      --fresh-translation   translate again      --fresh-voice   make the voices again
//   --keep-workdir       keep the temporary folder (the separated tracks, the dub track) to listen to and measure
import { copyFile, mkdir, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const scratch = join(root, ".dev-dub");
await mkdir(scratch, { recursive: true });

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name, fallback) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback);
const input = args.find((arg, index) => !arg.startsWith("--") && !(index > 0 && args[index - 1].startsWith("--") && ["source", "target", "captions"].includes(args[index - 1].slice(2))));
if (!input) throw new Error("Give the video to dub, for example: node scripts/dev/dub-local.mjs video.mp4 --source pcm --target yo --clone");

// Everything except the paid providers stays local. These are set before the app reads its settings; .env never overrides them.
Object.assign(process.env, {
  DATABASE_URL: `sqlite:///${join(scratch, "dev.db").replaceAll("\\", "/")}`,
  LOCAL_STORAGE_DIR: join(scratch, "storage"),
  STORAGE_PROVIDER: "local",
  SUPABASE_URL: "",
  SUPABASE_KEY: "",
  WORKER_MODE: "off",
  MOCK_MODE: "false",
  RESEND_API_KEY: "",
  WHATSAPP_TOKEN: "",
  NODE_ENV: "development",
});
if (flag("keep-workdir")) process.env.REELLINGO_KEEP_WORKDIR = "1";

const database = await import("../../src/database.js");
const { runJob } = await import("../../src/pipeline.js");
const { uploadFile, downloadFile } = await import("../../src/storage.js");
const { jobCosts } = await import("../../src/costs.js");
const { query } = await import("../../src/db.js");
await database.initializeDatabase();

const source = value("source", "auto");
const target = value("target", "yo");
const options = { keep_background: !flag("no-background"), captions: value("captions", null), tone: "natural" };

// One job per video, reused between runs so the transcript, translation and voice lines don't have to be paid for again.
const storageKey = `uploads/${basename(input)}`;
await uploadFile(storageKey, resolve(input), "video/mp4");
let job = (await database.listJobs("dev", 50)).find((item) => item.input_storage_path === storageKey && item.target_language === target && item.source_language === source);
if (!job) {
  job = await database.createJob({
    user_id: "dev", source_language: source, target_language: target, voice_clone: flag("clone"), input_storage_path: storageKey,
    original_filename: basename(input), options_json: options,
  });
}
const reset = { status: "queued", current_step: "queued", error_message: null, outputs_json: null, output_video_path: null, voice_clone: flag("clone"), options_json: { ...options } };
if (flag("fresh-transcript")) Object.assign(reset, { transcript_json: null, translated_segments_json: null, speakers_json: null, clips_json: null });
if (flag("fresh-translation")) Object.assign(reset, { translated_segments_json: null, clips_json: null });
if (flag("fresh-voice")) Object.assign(reset, { clips_json: null });
await database.updateJob(job.id, reset);
await query("DELETE FROM cost_events WHERE job_id = $1", [job.id]);

const started = Date.now();
const finished = await runJob(await database.getJob(job.id));
const seconds = Math.round((Date.now() - started) / 100) / 10;
console.log(`\n=== Job ${finished.id}: ${finished.status} in ${seconds}s ===`);
if (finished.error_message) console.log("Error:", finished.error_message);
if (finished.processing_note) console.log("Notes:", finished.processing_note);
const costs = await jobCosts(finished.id);
console.log("Provider usage this run:", costs.items.map((item) => `${item.provider}/${item.operation} ${Math.round(item.units)} ${item.unit} ($${item.cost_usd})`).join(" | "), `| total $${costs.total_usd}`);

// How well does the dub fit the video? (each line: where it was meant to go, where it went, how much it was sped up)
const timeline = finished.options_json?.dub_timeline || [];
if (timeline.length) {
  const lines = timeline.map(([index, start, end, speed, natural]) => ({ index, start, end, speed, natural }));
  const slots = finished.transcript_json || [];
  const fast = lines.filter((line) => line.speed > 1.25);
  const drift = lines.map((line) => line.start - (slots[line.index]?.start ?? line.start));
  const last = lines.at(-1);
  console.log(`Dub fit: ${lines.length} lines | sped up over 1.25x: ${fast.length} | fastest ${Math.max(...lines.map((line) => line.speed)).toFixed(2)}x | average ${(lines.reduce((sum, line) => sum + line.speed, 0) / lines.length).toFixed(2)}x`);
  console.log(`Timing: latest start vs original ${Math.max(...drift).toFixed(1)}s late | dub ends ${last.end.toFixed(1)}s | video is ${finished.duration_seconds}s`);
  const total = lines.reduce((sum, line) => sum + line.natural, 0);
  console.log(`Speech: ${total.toFixed(0)}s of voice for ${slots.reduce((sum, slot) => sum + (slot.end - slot.start), 0).toFixed(0)}s of original speech`);
}

// Copy the results out of local storage so they can be opened and measured.
const out = join(scratch, "out", String(finished.id));
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
for (const output of finished.outputs_json || []) {
  const name = basename(output.path);
  await downloadFile(output.path, join(out, name)).catch(() => undefined);
  console.log(`  ${output.kind.padEnd(10)} ${output.label} -> .dev-dub/out/${finished.id}/${name}`);
}
await database.closeDatabase();
