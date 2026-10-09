import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { commandAvailable, getMediaInfo, run, runCapture } from "./media.js";

async function peakDb(path) {
  const { stderr } = await runCapture("ffmpeg", ["-v", "info", "-i", path, "-af", "volumedetect", "-f", "null", "-"]);
  const match = stderr.match(/max_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/i);
  return match ? Number(match[1]) : -Infinity;
}

async function findFile(directory, name) {
  const entries = await readdir(directory, { withFileTypes: true, recursive: true });
  const match = entries.find((entry) => entry.isFile() && entry.name === name);
  return match ? join(match.parentPath || match.path, match.name) : null;
}

/** Demucs (open-source, best quality) writes no_vocals.wav: everything except the voices. */
async function separateWithDemucs(mixPath, workdir, signal) {
  const outputDirectory = join(workdir, "demucs");
  await run(config.demucsCommand, ["--two-stems=vocals", ...config.demucsArgs, "-o", outputDirectory, mixPath], { timeoutMs: 60 * 60 * 1000, signal });
  const background = await findFile(outputDirectory, "no_vocals.wav");
  if (!background) throw new Error("Demucs did not produce a background track.");
  return background;
}

/** Crude fallback: voices are usually mixed to the centre of a stereo track, so cancelling the centre removes most of them. */
async function separateWithCenterCancel(mixPath, workdir) {
  const info = await getMediaInfo(mixPath);
  const channels = Number(info.streams.find((stream) => stream.codec_type === "audio")?.channels || 1);
  if (channels < 2) throw new Error("Centre-channel separation needs stereo audio.");
  const background = join(workdir, "background.wav");
  await run("ffmpeg", ["-y", "-i", mixPath, "-af", "pan=stereo|c0=c0-c1|c1=c1-c0,volume=0.8", "-ar", "44100", background]);
  return background;
}

/**
 * Which methods to try, best first. Demucs is the best but slow on an ordinary computer, so automatic mode only uses it when
 * it will finish within the admin's time limit; otherwise the fast method is used and the customer is told.
 */
export async function providerPlan(durationSeconds) {
  let preferred = config.separationProvider;
  if (preferred === "elevenlabs") {
    // Old setting. ElevenLabs only returns the voices, and taking those away from the mix never lines up exactly, so the
    // original voice stayed audible under the dub. It's treated as automatic.
    logger.warn("SEPARATION_PROVIDER=elevenlabs is no longer supported; using automatic");
    preferred = "auto";
  }
  if (preferred === "none") return { order: [], note: null };
  if (preferred === "ffmpeg") return { order: ["ffmpeg"], note: null };
  const demucsReady = await commandAvailable(config.demucsCommand, ["--help"]);
  if (preferred === "demucs") return { order: demucsReady ? ["demucs", "ffmpeg"] : ["ffmpeg"], note: null };
  const estimatedMinutes = ((Number(durationSeconds) || 0) * config.demucsSecondsPerVideoSecond) / 60;
  if (demucsReady && estimatedMinutes <= config.separationTimeLimitMinutes) return { order: ["demucs", "ffmpeg"], note: null };
  return {
    order: ["ffmpeg"],
    note: demucsReady ? "This video is long, so the background music was kept with a faster method. It can sound slightly less clean." : null,
  };
}

/**
 * Produces a music-and-effects track (the original audio without speech) so the dub can be laid on top of it.
 * Returns null when there is no meaningful background or no separation method works; the dub then plays alone.
 * Pass an AbortSignal to stop the work (for example when the job fails).
 */
export async function separateBackground(mixPath, workdir, durationSeconds, { signal } = {}) {
  const failures = [];
  const { order, note: speedNote } = await providerPlan(durationSeconds);
  for (const provider of order) {
    try {
      const background = provider === "demucs" ? await separateWithDemucs(mixPath, workdir, signal) : await separateWithCenterCancel(mixPath, workdir);
      if (await peakDb(background) <= -45) return { backgroundPath: null, provider, note: "No background music or effects were detected." };
      return { backgroundPath: background, provider, note: provider === "ffmpeg" ? speedNote : null };
    } catch (error) {
      if (signal?.aborted) throw error;
      failures.push(`${provider}: ${error.message}`);
      logger.warn({ err: error, provider }, "Background separation attempt failed");
    }
  }
  return { backgroundPath: null, provider: null, note: failures.length ? `Background audio could not be kept (${failures.join("; ")}).` : speedNote };
}

/**
 * How loud is it where nobody is speaking? Cuts out the stretches between the transcript's lines and measures their average
 * level (dB). A very quiet result means there is no music or effects to keep. Returns null when the speech is too continuous
 * to tell (then the full separation is used, to be safe).
 */
export async function measureQuietGaps(audioPath, segments, durationSeconds, { minGapSeconds = 1, minTotalSeconds = 4, margin = 0.2, maxGaps = 60 } = {}) {
  const lines = segments.filter((segment) => Number.isFinite(segment.start) && Number.isFinite(segment.end)).sort((first, second) => first.start - second.start);
  const gaps = [];
  let cursor = 0;
  for (const line of lines) {
    if (line.start - cursor >= minGapSeconds) gaps.push([cursor + margin, line.start - margin]);
    cursor = Math.max(cursor, line.end);
  }
  if (durationSeconds - cursor >= minGapSeconds) gaps.push([cursor + margin, durationSeconds - margin]);
  const chosen = gaps.sort((first, second) => (second[1] - second[0]) - (first[1] - first[0])).slice(0, maxGaps);
  const seconds = chosen.reduce((sum, [from, to]) => sum + (to - from), 0);
  if (seconds < minTotalSeconds) return null;
  const select = chosen.map(([from, to]) => `between(t,${from.toFixed(2)},${to.toFixed(2)})`).join("+");
  const { stderr } = await runCapture("ffmpeg", ["-v", "info", "-i", audioPath, "-af", `aselect='${select}',volumedetect`, "-f", "null", "-"]);
  const mean = stderr.match(/mean_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/i);
  return mean ? { seconds: Math.round(seconds * 10) / 10, meanDb: Number(mean[1]) } : null;
}

/** Lays the dub over the background at the configured level; the output is exactly as long as the dub track. */
export async function mixDubWithBackground(dubPath, backgroundPath, outputPath, volume = config.backgroundVolume) {
  await run("ffmpeg", [
    "-y", "-i", dubPath, "-i", backgroundPath, "-filter_complex",
    `[0:a]aformat=channel_layouts=stereo,aresample=44100[dub];[1:a]aformat=channel_layouts=stereo,aresample=44100,volume=${volume}[bg];[dub][bg]amix=inputs=2:normalize=0:duration=first,alimiter=limit=0.95[out]`,
    "-map", "[out]", "-ar", "44100", "-ac", "2", "-c:a", "pcm_s16le", outputPath,
  ]);
  return outputPath;
}
