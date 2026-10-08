import { join } from "node:path";
import OpenAI from "openai";
import { config } from "./config.js";
import { recordChatUsage } from "./costs.js";
import { getLanguage } from "./languages.js";
import { getMediaInfo, run } from "./media.js";
import { aspectSize, displaySize, mergeAudioVideo, videoEncodeArgs, writeAss } from "./render.js";
import { withRetries } from "./retry.js";

const MIN_CLIP_SECONDS = 15;
const MAX_CLIP_SECONDS = 75;
const TARGET_CLIPS = 4;

let ai;

/**
 * Picks self-contained moments that work on their own (a hook, a punchline, a strong statement).
 * Returns [{ start, end, title }], each 15-75 seconds, in time order and never overlapping.
 */
export async function pickHighlights(segments, { language, durationSeconds, requestCompletion } = {}) {
  const usable = segments.map((segment, index) => ({ index, start: Number(segment.start), end: Number(segment.end), text: String(segment.text || "").trim() }))
    .filter((segment) => Number.isFinite(segment.start) && Number.isFinite(segment.end) && segment.end > segment.start && segment.text);
  if (!usable.length) return [];
  let picks = [];
  if (requestCompletion || config.openaiApiKey) {
    try {
      picks = await askModel(usable, language, requestCompletion);
    } catch {
      picks = [];
    }
  }
  if (!picks.length) picks = evenlySpaced(usable, durationSeconds);
  return tidy(picks, durationSeconds);
}

async function askModel(segments, language, requestCompletion) {
  const complete = requestCompletion || ((request) => {
    ai ||= new OpenAI({ apiKey: config.openaiApiKey, baseURL: config.openaiBaseUrl, timeout: 120_000 });
    return ai.chat.completions.create(request);
  });
  const response = await withRetries(() => complete({
    model: config.openaiChatModel,
    response_format: { type: "json_object" },
    temperature: 0.3,
    messages: [
      {
        role: "system",
        content: `You cut short social-media clips (TikTok, Reels, Shorts) from a video transcript in ${getLanguage(language)?.name || language}. Choose up to ${TARGET_CLIPS} moments that make sense on their own and grab attention in the first seconds: a hook, a surprising fact, a joke, a strong opinion or a clear tip. Each clip must be ${MIN_CLIP_SECONDS}-${MAX_CLIP_SECONDS} seconds long, start at the start of a line and end at the end of a line, and clips must not overlap. Give each a catchy title of at most 8 words in the transcript's language. Return JSON {"clips":[{"start_index":0,"end_index":5,"title":"..."}]}.`,
      },
      { role: "user", content: JSON.stringify(segments.map((segment) => ({ i: segment.index, s: Math.round(segment.start), e: Math.round(segment.end), t: segment.text.slice(0, 300) }))) },
    ],
  }), { label: "Clip selection" });
  await recordChatUsage("clip_selection", response.usage);
  const clips = JSON.parse(response.choices[0]?.message?.content || "{}").clips || [];
  const byIndex = new Map(segments.map((segment) => [segment.index, segment]));
  return clips.map((clip) => {
    const first = byIndex.get(Number(clip.start_index));
    const last = byIndex.get(Number(clip.end_index));
    if (!first || !last) return null;
    return { start: first.start, end: last.end, title: String(clip.title || "").trim().slice(0, 80) };
  }).filter(Boolean);
}

/** Without a model: windows of about 45 seconds spread across the video, cut at line boundaries. */
function evenlySpaced(segments, durationSeconds) {
  const total = durationSeconds || segments[segments.length - 1].end;
  const count = Math.max(1, Math.min(TARGET_CLIPS, Math.floor(total / 60)));
  const picks = [];
  for (let slot = 0; slot < count; slot += 1) {
    const anchor = (total * (slot + 0.5)) / count - 22;
    const first = segments.find((segment) => segment.start >= anchor) || segments[0];
    const lastIndex = segments.findIndex((segment) => segment.end >= first.start + 45);
    const last = segments[lastIndex === -1 ? segments.length - 1 : lastIndex];
    picks.push({ start: first.start, end: last.end, title: `Highlight ${slot + 1}` });
  }
  return picks;
}

function tidy(picks, durationSeconds) {
  const limit = durationSeconds || Infinity;
  const sorted = picks
    .map((pick) => ({ ...pick, start: Math.max(0, pick.start), end: Math.min(limit, pick.end) }))
    .map((pick) => (pick.end - pick.start > MAX_CLIP_SECONDS ? { ...pick, end: pick.start + MAX_CLIP_SECONDS } : pick))
    .filter((pick) => pick.end - pick.start >= MIN_CLIP_SECONDS)
    .sort((first, second) => first.start - second.start);
  const result = [];
  for (const pick of sorted) {
    if (result.length && pick.start < result[result.length - 1].end) continue;
    result.push({ ...pick, start: Math.round(pick.start * 100) / 100, end: Math.round(pick.end * 100) / 100 });
    if (result.length >= 5) break;
  }
  return result;
}

/** Lines that fall inside a clip, re-timed so the clip starts at 0. */
export function clipSegments(segments, start, end) {
  return segments
    .filter((segment) => segment.end > start && segment.start < end && String(segment.text || "").trim())
    .map((segment) => ({ ...segment, start: Math.max(0, segment.start - start), end: Math.min(end, segment.end) - start }));
}

/**
 * Renders one vertical (9:16) clip with burned-in captions. `videoPath` is the finished dub, so the clip carries
 * the dubbed voice and background audio.
 */
export async function renderClip(videoPath, segments, { start, end, workdir, index, style = "bold", watermark = false }) {
  const raw = join(workdir, `clip-${index}-raw.mp4`);
  await run("ffmpeg", ["-y", "-ss", String(start), "-i", videoPath, "-t", String(end - start), "-map", "0:v:0", "-map", "0:a:0", ...videoEncodeArgs(), "-c:a", "aac", "-b:a", "160k", raw]);
  const size = displaySize(await getMediaInfo(raw));
  const target = aspectSize(size, "9:16");
  const assPath = await writeAss(join(workdir, `clip-${index}.ass`), clipSegments(segments, start, end), { ...target, style });
  const output = join(workdir, `clip-${index}.mp4`);
  await mergeAudioVideo(raw, raw, output, { aspect: "9:16", assPath, watermark });
  return output;
}
