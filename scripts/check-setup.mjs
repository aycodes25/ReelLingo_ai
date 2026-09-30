// Checks that this computer has everything ReelLingo needs, and which optional services are switched on.
// Run from the project folder:  npm run check      (never prints secret values)
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const green = (text) => `\x1b[32m${text}\x1b[0m`;
const yellow = (text) => `\x1b[33m${text}\x1b[0m`;
const red = (text) => `\x1b[31m${text}\x1b[0m`;
const bold = (text) => `\x1b[1m${text}\x1b[0m`;

function tool(command, args = ["--version"]) {
  // A single command string lets Windows find .cmd/.exe shims (e.g. pip-installed tools) without a shell-args warning.
  const result = spawnSync(`${command} ${args.join(" ")}`, { encoding: "utf8", shell: true });
  return result.status === 0 ? (result.stdout || result.stderr).split(/\r?\n/)[0].trim() : null;
}

function readEnv(path) {
  if (!existsSync(path)) return null;
  const values = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=(.*)$/);
    if (match) values[match[1]] = match[2].trim();
  }
  return values;
}

let problems = 0;
console.log(bold("\nTools on this computer"));
const nodeMajor = Number(process.versions.node.split(".")[0]);
console.log(`  ${nodeMajor >= 20 ? green("✔") : red("✖")} Node.js ${process.versions.node}${nodeMajor >= 20 ? "" : "  → install Node 20+ from https://nodejs.org"}`);
if (nodeMajor < 20) problems += 1;
for (const [name, command, args, need, fix] of [
  ["FFmpeg", "ffmpeg", ["-version"], true, "winget install Gyan.FFmpeg"],
  ["FFprobe", "ffprobe", ["-version"], true, "comes with FFmpeg"],
  ["Python", "python", ["--version"], false, "winget install Python.Python.3.11"],
  ["Demucs (best background-music separation)", "demucs", ["--help"], false, "python -m pip install demucs soundfile"],
  ["yt-dlp (import from YouTube/TikTok/Instagram/Facebook)", "yt-dlp", ["--version"], false, "python -m pip install yt-dlp"],
]) {
  const version = tool(command, args);
  if (!version && need) problems += 1;
  console.log(`  ${version ? green("✔") : need ? red("✖") : yellow("•")} ${name}${version ? "" : `  → ${fix}`}`);
}

const env = readEnv(join(root, "backend", ".env"));
console.log(bold("\nbackend/.env"));
if (!env) {
  console.log(red("  ✖ backend/.env is missing. Copy backend/.env.example to backend/.env and fill it in."));
  problems += 1;
} else {
  const has = (key) => Boolean(env[key]);
  const groups = [
    ["Required", [["OPENAI_API_KEY", "transcription & translation"], ["ELEVENLABS_API_KEY", "voice cloning & dubbing"], ["SUPABASE_URL", "sign-in & storage"], ["SUPABASE_KEY", "sign-in & admin user management"], ["DATABASE_URL", "your database"], ["APP_SECRET", "secure links"], ["ADMIN_EMAILS", "who can open Admin"]], true],
    ["Payments", [["PAYSTACK_SECRET_KEY", "Naira payments"], ["STRIPE_SECRET_KEY", "US-dollar card payments"], ["STRIPE_WEBHOOK_SECRET", "Stripe renewals"]], false],
    ["Notifications", [["RESEND_API_KEY", "email when dubs are ready"], ["WHATSAPP_TOKEN", "WhatsApp messages"], ["WHATSAPP_PHONE_NUMBER_ID", "WhatsApp messages"]], false],
    ["Premium & monitoring", [["SYNC_API_KEY", "lip-sync"], ["GOOGLE_CLIENT_ID", "publish to YouTube"], ["GOOGLE_CLIENT_SECRET", "publish to YouTube"], ["SENTRY_DSN", "error alerts"], ["CLAMAV_HOST", "upload virus scanning"]], false],
  ];
  for (const [title, keys, required] of groups) {
    console.log(`  ${bold(title)}`);
    for (const [key, purpose] of keys) {
      if (!has(key) && required) problems += 1;
      console.log(`    ${has(key) ? green("✔") : required ? red("✖") : yellow("•")} ${key.padEnd(26)} ${has(key) ? "set" : "empty"}  (${purpose})`);
    }
  }
  if (env.SUPABASE_KEY) {
    try {
      const role = env.SUPABASE_KEY.split(".").length === 3 ? JSON.parse(Buffer.from(env.SUPABASE_KEY.split(".")[1], "base64url")).role : env.SUPABASE_KEY.startsWith("sb_secret_") ? "service_role" : "anon";
      if (role !== "service_role") {
        console.log(yellow("    ! SUPABASE_KEY is not the service_role key — Admin can't create or delete users. Use Supabase → Project Settings → API → service_role."));
      }
    } catch {
      // unknown key format
    }
  }
  console.log(`\n  Instructions for every key are written above it in ${bold("backend/.env")}.`);
}

console.log(problems ? red(`\n${problems} required item(s) need attention.\n`) : green("\nAll required pieces are in place. Start the app with:  npm run dev\n"));
process.exitCode = problems ? 1 : 0;
