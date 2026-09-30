import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { config } from "./config.js";
import { ffmpegHasFilter, getMediaInfo, run, runCapture } from "./media.js";

export const ASPECTS = {
  "9:16": { label: "Vertical 9:16 (TikTok, Reels, Shorts)", ratio: [9, 16] },
  "1:1": { label: "Square 1:1 (Instagram feed)", ratio: [1, 1] },
  "16:9": { label: "Landscape 16:9 (YouTube)", ratio: [16, 9] },
  "4:5": { label: "Portrait 4:5 (Instagram, Facebook)", ratio: [4, 5] },
};

export const CAPTION_STYLES = {
  classic: "Classic: white text with an outline",
  boxed: "Boxed: white text on a dark band",
  bold: "Bold: large yellow words (TikTok style)",
  karaoke: "Karaoke: each word highlights as it's spoken",
};

const CAPTION_FONT = process.env.CAPTION_FONT || (process.platform === "win32" ? "Arial" : "DejaVu Sans");

export async function assertAudibleAudio(filePath) {
  const info = await getMediaInfo(filePath);
  if (!info.streams.some((stream) => stream.codec_type === "audio")) {
    throw new Error("Dub generation produced no audio stream.");
  }
  const { stderr } = await runCapture("ffmpeg", ["-v", "info", "-i", filePath, "-af", "volumedetect", "-f", "null", "-"]);
  const peak = stderr.match(/max_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/i);
  if (!peak || Number(peak[1]) <= -55) {
    throw new Error("Dub generation produced silent audio. The job was not marked complete.");
  }
}

function videoStream(info) {
  return info.streams.find((stream) => stream.codec_type === "video");
}

/** Size of the displayed picture, accounting for phone videos stored sideways with a rotation flag. */
export function displaySize(info) {
  const stream = videoStream(info);
  if (!stream) return null;
  let width = Number(stream.width);
  let height = Number(stream.height);
  const rotation = Math.abs(Number(stream.tags?.rotate || stream.side_data_list?.find((item) => item.rotation !== undefined)?.rotation || 0));
  if (rotation === 90 || rotation === 270) [width, height] = [height, width];
  return { width, height };
}

function drawtextEscape(text) {
  return String(text).replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\u2019").replace(/%/g, "\\%");
}

const FONT_CANDIDATES = [
  "C:/Windows/Fonts/arialbd.ttf", "C:/Windows/Fonts/arial.ttf", "C:/Windows/Fonts/segoeui.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf", "/System/Library/Fonts/Helvetica.ttc", "/Library/Fonts/Arial.ttf",
];

// drawtext needs a font file when FFmpeg's fontconfig has no configuration (common on Windows builds and slim images).
function watermarkFontFile() {
  if (config.watermarkFont) return config.watermarkFont;
  return FONT_CANDIDATES.find((path) => existsSync(path)) || "";
}

async function watermarkFilter(height) {
  if (!(await ffmpegHasFilter("drawtext"))) return null;
  const size = Math.max(14, Math.round(height * 0.035));
  const margin = Math.round(size * 0.9);
  const fontFile = watermarkFontFile().replace(/\\/g, "/");
  const font = fontFile ? `:fontfile='${drawtextEscape(fontFile)}'` : "";
  return `drawtext=text='${drawtextEscape(config.watermarkText)}'${font}:fontcolor=white@0.8:fontsize=${size}:x=w-tw-${margin}:y=h-th-${margin}:box=1:boxcolor=black@0.35:boxborderw=${Math.round(size / 2)}`;
}

/**
 * Replaces the video's audio with the dub. Video is stream-copied unless a filter (watermark, captions,
 * reframing) has to be drawn, in which case it's re-encoded with H.264.
 */
export async function mergeAudioVideo(videoPath, audioPath, outputVideoPath, { watermark = false, assPath = null, aspect = null } = {}) {
  const videoInfo = await getMediaInfo(videoPath);
  const duration = Number(videoInfo.format?.duration);
  const size = displaySize(videoInfo);
  if (!Number.isFinite(duration) || duration <= 0 || !size) {
    throw new Error("Could not determine input video duration.");
  }
  await assertAudibleAudio(audioPath);

  const filters = [];
  let height = size.height;
  if (aspect) {
    const target = aspectSize(size, aspect);
    height = target.height;
    filters.push(`split=2[a][b];[a]scale=${target.width}:${target.height}:force_original_aspect_ratio=increase,crop=${target.width}:${target.height},boxblur=20:2[bg];[b]scale=${target.width}:${target.height}:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1`);
  }
  if (assPath) {
    if (!(await ffmpegHasFilter("ass"))) throw new Error("This FFmpeg build cannot burn in captions (libass is missing).");
    filters.push(`ass=${basename(assPath)}`);
  }
  if (watermark) {
    const filter = await watermarkFilter(height);
    if (filter) filters.push(filter);
  }

  const videoArgs = filters.length
    ? ["-filter_complex", `[0:v:0]${filters.join(",")}[v]`, "-map", "[v]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p"]
    : ["-map", "0:v:0", "-c:v", "copy"];
  await run("ffmpeg", [
    "-y", "-i", videoPath, "-i", audioPath,
    ...videoArgs, "-map", "1:a:0",
    "-c:a", "aac", "-b:a", "192k",
    "-af", "apad", "-t", String(duration),
    "-metadata:s:a:0", "title=ReelLingo translated dub",
    "-movflags", "+faststart", outputVideoPath,
  ], { cwd: assPath ? dirname(assPath) : undefined });

  const outputInfo = await getMediaInfo(outputVideoPath);
  const audioStream = outputInfo.streams.find((stream) => stream.codec_type === "audio");
  if (!audioStream || Number(outputInfo.format?.duration) < duration - 0.25) {
    throw new Error("The exported video is missing its complete audio or video stream.");
  }
  await assertAudibleAudio(outputVideoPath);
  return outputVideoPath;
}

/** Output size for a reframed variant: the short side keeps the source resolution (capped at 1080p). */
export function aspectSize(size, aspect) {
  const [ratioWidth, ratioHeight] = ASPECTS[aspect]?.ratio || [16, 9];
  const shortSide = Math.max(360, Math.min(1080, Math.min(size.width, size.height)));
  const even = (value) => Math.round(value / 2) * 2;
  return ratioWidth <= ratioHeight
    ? { width: even(shortSide), height: even((shortSide * ratioHeight) / ratioWidth) }
    : { width: even((shortSide * ratioWidth) / ratioHeight), height: even(shortSide) };
}

export async function encodeAudio(audioPath, outputPath) {
  await run("ffmpeg", ["-y", "-i", audioPath, "-c:a", "libmp3lame", "-b:a", "192k", outputPath]);
  return outputPath;
}

/** Audio-only exports get a spoken watermark-free MP3; free-plan audio carries an ID3 comment instead of a visual mark. */
export async function exportAudioOnly(audioPath, outputPath, { watermark = false } = {}) {
  await assertAudibleAudio(audioPath);
  const tags = watermark ? ["-metadata", `comment=${config.watermarkText}`] : [];
  await run("ffmpeg", ["-y", "-i", audioPath, ...tags, "-c:a", "libmp3lame", "-b:a", "192k", outputPath]);
  return outputPath;
}

function srtTime(seconds) {
  const milliseconds = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const wholeSeconds = Math.floor((milliseconds % 60_000) / 1000);
  const remainder = milliseconds % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(wholeSeconds).padStart(2, "0")},${String(remainder).padStart(3, "0")}`;
}

export function generateSrt(segments) {
  return segments.map((segment, index) => (
    `${index + 1}\n${srtTime(segment.start)} --> ${srtTime(segment.end)}\n${segment.text}`
  )).join("\n\n") + "\n";
}

export function generateVtt(segments) {
  return `WEBVTT\n\n${segments.map((segment, index) => (
    `${index + 1}\n${srtTime(segment.start).replace(",", ".")} --> ${srtTime(segment.end).replace(",", ".")}\n${segment.text}`
  )).join("\n\n")}\n`;
}

function assTime(seconds) {
  const centiseconds = Math.max(0, Math.round(seconds * 100));
  const hours = Math.floor(centiseconds / 360000);
  const minutes = Math.floor((centiseconds % 360000) / 6000);
  const wholeSeconds = Math.floor((centiseconds % 6000) / 100);
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(wholeSeconds).padStart(2, "0")}.${String(centiseconds % 100).padStart(2, "0")}`;
}

function assEscape(text) {
  return String(text).replace(/\\/g, "\uFF3C").replace(/[{}]/g, "").replace(/\r?\n/g, "\\N");
}

/** Splits a caption into readable chunks and gives each chunk a share of the segment's time by length. */
export function captionChunks(segment, maxCharacters) {
  const words = segment.text.trim().split(/\s+/).filter(Boolean);
  const chunks = [];
  let current = [];
  for (const word of words) {
    if (current.length && [...current, word].join(" ").length > maxCharacters) {
      chunks.push(current);
      current = [];
    }
    current.push(word);
  }
  if (current.length) chunks.push(current);
  const totalCharacters = words.join("").length || 1;
  const duration = Math.max(0.2, segment.end - segment.start);
  let cursor = segment.start;
  return chunks.map((chunkWords) => {
    const share = chunkWords.join("").length / totalCharacters;
    const start = cursor;
    const end = Math.min(segment.end, cursor + duration * share);
    cursor = end;
    return { start, end, words: chunkWords };
  });
}

// ASS colours are &HAABBGGRR.
const STYLE_PRESETS = {
  classic: { size: 0.05, primary: "&H00FFFFFF", secondary: "&H00FFFFFF", outline: "&H00000000", back: "&H64000000", bold: 0, border: 1, outlineWidth: 0.004, margin: 0.07, characters: 42, upper: false },
  boxed: { size: 0.045, primary: "&H00FFFFFF", secondary: "&H00FFFFFF", outline: "&H96000000", back: "&H96000000", bold: 0, border: 3, outlineWidth: 0.008, margin: 0.07, characters: 42, upper: false },
  bold: { size: 0.07, primary: "&H0000D7FF", secondary: "&H0000D7FF", outline: "&H00000000", back: "&H00000000", bold: -1, border: 1, outlineWidth: 0.007, margin: 0.2, characters: 22, upper: true },
  karaoke: { size: 0.065, primary: "&H0000D7FF", secondary: "&H00FFFFFF", outline: "&H00000000", back: "&H00000000", bold: -1, border: 1, outlineWidth: 0.007, margin: 0.2, characters: 22, upper: true },
};

/** Builds an Advanced SubStation file sized to the output video so captions scale correctly. */
export function generateAss(segments, { width, height, style = "classic" }) {
  const preset = STYLE_PRESETS[style] || STYLE_PRESETS.classic;
  const portrait = height > width;
  const reference = portrait ? width * 1.25 : height;
  const fontSize = Math.round(reference * preset.size);
  const outline = Math.max(1, Math.round(reference * preset.outlineWidth));
  const marginV = Math.round(height * (portrait ? preset.margin : Math.min(preset.margin, 0.08)));
  const maxCharacters = portrait ? Math.min(preset.characters, 22) : preset.characters;
  const lines = [
    "[Script Info]", "ScriptType: v4.00+", `PlayResX: ${width}`, `PlayResY: ${height}`, "WrapStyle: 0", "ScaledBorderAndShadow: yes", "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Default,${CAPTION_FONT},${fontSize},${preset.primary},${preset.secondary},${preset.outline},${preset.back},${preset.bold},0,0,0,100,100,0,0,${preset.border},${outline},0,2,${Math.round(width * 0.06)},${Math.round(width * 0.06)},${marginV},1`,
    "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  for (const segment of segments) {
    if (!segment.text?.trim()) continue;
    for (const chunk of captionChunks(segment, maxCharacters)) {
      const words = chunk.words.map((word) => assEscape(preset.upper ? word.toLocaleUpperCase() : word));
      let text = words.join(" ");
      if (style === "karaoke") {
        // Word timing is estimated from word length: translations have no word-level timestamps.
        const total = chunk.words.join("").length || 1;
        const centiseconds = Math.max(1, Math.round((chunk.end - chunk.start) * 100));
        text = words.map((word, index) => `{\\k${Math.max(1, Math.round((chunk.words[index].length / total) * centiseconds))}}${word}`).join(" ");
      }
      lines.push(`Dialogue: 0,${assTime(chunk.start)},${assTime(chunk.end)},Default,,0,0,0,,${text}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

export async function writeAss(path, segments, options) {
  await writeFile(path, generateAss(segments, options), "utf8");
  return path;
}
