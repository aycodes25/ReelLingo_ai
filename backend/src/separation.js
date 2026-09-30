import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "./config.js";
import { recordCost } from "./costs.js";
import { logger } from "./logger.js";
import { commandAvailable, getMediaInfo, run, runCapture } from "./media.js";
import { responseError, withRetries } from "./retry.js";

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
async function separateWithDemucs(mixPath, workdir) {
  const outputDirectory = join(workdir, "demucs");
  await run(config.demucsCommand, ["--two-stems=vocals", "-o", outputDirectory, mixPath], { timeoutMs: 60 * 60 * 1000 });
  const background = await findFile(outputDirectory, "no_vocals.wav");
  if (!background) throw new Error("Demucs did not produce a background track.");
  return background;
}

/** ElevenLabs Voice Isolator returns only the voices; subtracting them from the mix leaves the background. */
async function separateWithElevenLabs(mixPath, workdir, durationSeconds) {
  const form = new FormData();
  form.append("audio", new Blob([await readFile(mixPath)], { type: "audio/wav" }), "mix.wav");
  const audio = await withRetries(async () => {
    const response = await fetch("https://api.elevenlabs.io/v1/audio-isolation", {
      method: "POST",
      headers: { "xi-api-key": config.elevenlabsApiKey },
      body: form,
    });
    if (!response.ok) throw await responseError(response, "ElevenLabs voice isolation");
    return Buffer.from(await response.arrayBuffer());
  }, { label: "ElevenLabs voice isolation" });
  await recordCost("elevenlabs", "voice_isolation", durationSeconds / 60, "minutes", (durationSeconds / 60) * config.costs.elevenlabsIsolationPerMinute);
  const voicesPath = join(workdir, "isolated-voices.mp3");
  await writeFile(voicesPath, audio);
  const background = join(workdir, "background.wav");
  await run("ffmpeg", [
    "-y", "-i", mixPath, "-i", voicesPath, "-filter_complex",
    "[1:a]aresample=44100,aformat=channel_layouts=stereo,volume=-1[inverse];[0:a]aformat=channel_layouts=stereo[mix];[mix][inverse]amix=inputs=2:normalize=0:duration=first[out]",
    "-map", "[out]", "-ar", "44100", "-ac", "2", background,
  ]);
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

async function providerOrder() {
  const preferred = config.separationProvider;
  if (preferred === "none") return [];
  if (preferred !== "auto") return [preferred];
  const order = [];
  if (await commandAvailable(config.demucsCommand, ["--help"])) order.push("demucs");
  if (config.elevenlabsApiKey) order.push("elevenlabs");
  order.push("ffmpeg");
  return order;
}

/**
 * Produces a music-and-effects track (the original audio without speech) so the dub can be laid on top of it.
 * Returns null when there is no meaningful background or no separation method works; the dub then plays alone.
 */
export async function separateBackground(mixPath, workdir, durationSeconds) {
  const failures = [];
  for (const provider of await providerOrder()) {
    try {
      const background = provider === "demucs"
        ? await separateWithDemucs(mixPath, workdir)
        : provider === "elevenlabs"
          ? await separateWithElevenLabs(mixPath, workdir, durationSeconds)
          : await separateWithCenterCancel(mixPath, workdir);
      if (await peakDb(background) <= -45) return { backgroundPath: null, provider, note: "No background music or effects were detected." };
      return { backgroundPath: background, provider, note: null };
    } catch (error) {
      failures.push(`${provider}: ${error.message}`);
      logger.warn({ err: error, provider }, "Background separation attempt failed");
    }
  }
  return { backgroundPath: null, provider: null, note: failures.length ? `Background audio could not be kept (${failures.join("; ")}).` : null };
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
