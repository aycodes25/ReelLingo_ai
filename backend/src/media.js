import { spawn } from "node:child_process";

/** Runs a command, returning stdout/stderr; rejects with the tail of stderr on failure. */
export function runCapture(command, args, { cwd, binary = false, timeoutMs } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    let stderr = "";
    let timer;
    if (timeoutMs) timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      if (stderr.length > 200_000) stderr = stderr.slice(-100_000);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const output = Buffer.concat(stdout);
      if (code === 0) resolve({ stdout: binary ? output : output.toString("utf8"), stderr });
      else reject(new Error(stderr.trim().split("\n").slice(-4).join(" ") || `${command} exited with code ${code}`));
    });
  });
}

export async function run(command, args, options) {
  await runCapture(command, args, options);
}

export async function getMediaInfo(filePath) {
  const { stdout } = await runCapture("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", filePath]);
  return JSON.parse(stdout);
}

export async function mediaDuration(filePath) {
  const duration = Number((await getMediaInfo(filePath)).format?.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("Could not read the media duration. Ensure FFmpeg is installed and the file is a valid video or audio file.");
  return duration;
}

let commandCache = new Map();
/** True when an external tool (yt-dlp, demucs…) can be started. */
export async function commandAvailable(command, versionArgs = ["--version"]) {
  if (commandCache.has(command)) return commandCache.get(command);
  const available = await runCapture(command, versionArgs, { timeoutMs: 20_000 }).then(() => true, () => false);
  commandCache.set(command, available);
  return available;
}

export function resetCommandCache() {
  commandCache = new Map();
}

let filterCache;
/** Lists FFmpeg filters so optional features (drawtext, ass) can degrade gracefully on minimal builds. */
export async function ffmpegHasFilter(name) {
  if (!filterCache) {
    try {
      const { stdout } = await runCapture("ffmpeg", ["-hide_banner", "-filters"]);
      filterCache = new Set(stdout.split("\n").map((line) => line.trim().split(/\s+/)[1]).filter(Boolean));
    } catch {
      filterCache = new Set();
    }
  }
  return filterCache.has(name);
}
