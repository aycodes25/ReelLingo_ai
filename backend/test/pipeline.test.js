import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import {
  assertAudibleAudio,
  detectSegmentLanguages,
  mergeAudioVideo,
  splitAudioForTranscription,
  transcribeAudioChunks,
  translate,
  whisperLanguageHint,
} from "../src/pipeline.js";

function run(command, args, capture = false) {
  return new Promise((resolve, reject) => {
    const process = spawn(command, args, { stdio: ["ignore", capture ? "pipe" : "ignore", "pipe"] });
    const stdout = [];
    let stderr = "";
    process.stderr.setEncoding("utf8");
    process.stderr.on("data", (chunk) => { stderr += chunk; });
    if (capture) process.stdout.on("data", (chunk) => stdout.push(chunk));
    process.on("error", reject);
    process.on("close", (code) => {
      if (code === 0) resolve(capture ? Buffer.concat(stdout) : undefined);
      else reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
    });
  });
}

test("merged video contains dubbed audio, not the source track", async () => {
  const dir = await mkdtemp(join(tmpdir(), "reellingo-audio-"));
  const source = join(dir, "source.mp4");
  const dub = join(dir, "dub.wav");
  const output = join(dir, "output.mp4");

  try {
    await run("ffmpeg", [
      "-y", "-f", "lavfi", "-i", "color=c=black:s=160x120:d=2:r=24",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
      "-shortest", "-c:v", "libx264", "-c:a", "aac", source,
    ]);
    await run("ffmpeg", [
      "-y", "-f", "lavfi", "-i", "sine=frequency=880:duration=1",
      "-ar", "44100", "-ac", "1", "-c:a", "pcm_s16le", dub,
    ]);

    await mergeAudioVideo(source, dub, output);
    const decoded = await run("ffmpeg", [
      "-v", "error", "-i", output, "-map", "0:a:0", "-af", "lowpass=f=3000",
      "-ar", "8000", "-ac", "1", "-f", "s16le", "pipe:1",
    ], true);

    let crossings = 0;
    for (let index = 2; index < decoded.length; index += 2) {
      const previous = decoded.readInt16LE(index - 2);
      const current = decoded.readInt16LE(index);
      if ((previous < 0 && current >= 0) || (previous >= 0 && current < 0)) crossings += 1;
    }
    const estimatedFrequency = crossings / (decoded.length / 2 / 8000);
    assert.ok(estimatedFrequency > 700 && estimatedFrequency < 1050, `got ${estimatedFrequency} Hz`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("transcription chunks cover the complete audio duration with continuous offsets", async () => {
  const dir = await mkdtemp(join(tmpdir(), "reellingo-chunks-"));
  const source = join(dir, "long-audio.wav");
  const chunkDirectory = join(dir, "chunks");
  await mkdir(chunkDirectory);

  try {
    await run("ffmpeg", [
      "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=125",
      "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", source,
    ]);
    const chunks = await splitAudioForTranscription(source, chunkDirectory, { maxSeconds: 120 });
    assert.equal(chunks.length, 2);
    assert.deepEqual(chunks.map((chunk) => chunk.offset), [0, 120]);
    const durations = await Promise.all(chunks.map(async (chunk) => {
      const output = await run("ffprobe", [
        "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", chunk.path,
      ], true);
      return Number.parseFloat(output.toString());
    }));
    assert.ok(Math.abs(durations.reduce((sum, duration) => sum + duration, 0) - 125) < 0.1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("long audio is split inside pauses so no word is cut in half", async () => {
  const dir = await mkdtemp(join(tmpdir(), "reellingo-silence-split-"));
  const source = join(dir, "speech-like.wav");
  const chunkDirectory = join(dir, "chunks");
  await mkdir(chunkDirectory);
  try {
    // 10s "speech", 1s pause, 10s "speech", 1s pause, 10s "speech"
    const tone = join(dir, "tone.wav");
    const pause = join(dir, "pause.wav");
    await run("ffmpeg", ["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=10", "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", tone]);
    await run("ffmpeg", ["-y", "-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono:d=1", "-c:a", "pcm_s16le", pause]);
    await run("ffmpeg", ["-y", "-i", tone, "-i", pause, "-i", tone, "-i", pause, "-i", tone, "-filter_complex", "concat=n=5:v=0:a=1", "-c:a", "pcm_s16le", source]);
    const chunks = await splitAudioForTranscription(source, chunkDirectory, { maxSeconds: 15, minSeconds: 5 });
    assert.equal(chunks.length, 3);
    assert.ok(Math.abs(chunks[1].offset - 10.5) < 0.3, `second chunk starts inside the first pause (${chunks[1].offset})`);
    assert.ok(Math.abs(chunks[2].offset - 21.5) < 0.3, `third chunk starts inside the second pause (${chunks[2].offset})`);
    const durations = await Promise.all(chunks.map(async (chunk) => Number.parseFloat((await run("ffprobe", [
      "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", chunk.path,
    ], true)).toString())));
    assert.ok(Math.abs(durations.reduce((sum, value) => sum + value, 0) - 32) < 0.1, "chunks cover all of the audio");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("each chunk is transcribed with the previous chunk's words as context and the chosen language", async () => {
  const requests = [];
  await transcribeAudioChunks([
    { path: "first.wav", offset: 0 },
    { path: "second.wav", offset: 600 },
  ], async (chunk, options) => {
    requests.push(options);
    return { language: "swahili", segments: [{ start: 0, end: 2, text: chunk.offset === 0 ? "Habari za asubuhi rafiki yangu" : "karibu tena" }] };
  }, { language: "sw" });
  assert.equal(requests[0].prompt, undefined);
  assert.equal(requests[0].language, "sw");
  assert.match(requests[1].prompt, /Habari za asubuhi rafiki yangu$/);
});

test("a dropped connection during transcription is retried instead of failing the job", async () => {
  let calls = 0;
  const result = await transcribeAudioChunks([{ path: "chunk.wav", offset: 0 }], async () => {
    calls += 1;
    if (calls === 1) throw new Error("Connection error.");
    return { language: "english", segments: [{ start: 0, end: 1, text: "hello" }] };
  }, { retryDelayMs: 1 });
  assert.equal(calls, 2);
  assert.equal(result.segments[0].text, "hello");
});

test("translation re-asks when the model drops a segment or the connection fails, instead of failing the job", async () => {
  const segments = [
    { start: 0, end: 1, text: "one", language: "en" },
    { start: 1, end: 2, text: "two", language: "en" },
  ];
  let calls = 0;
  const translated = await translate(segments, "fr", async (request) => {
    calls += 1;
    if (calls === 1) throw new Error("Connection error.");
    const content = JSON.parse(request.messages[1].content);
    const items = calls === 2 ? content.slice(0, 1) : content;
    return { choices: [{ message: { content: JSON.stringify({ segments: items.map((item) => ({ index: item.index, text: `fr ${item.text}` })) }) } }] };
  }, { retryDelayMs: 1 });
  assert.equal(calls, 3);
  assert.deepEqual(translated.map((segment) => segment.text), ["fr one", "fr two"]);

  const identified = await detectSegmentLanguages(segments, (() => {
    let detectCalls = 0;
    return async (request) => {
      detectCalls += 1;
      if (detectCalls === 1) throw new Error("Connection error.");
      const content = JSON.parse(request.messages[1].content);
      return { choices: [{ message: { content: JSON.stringify({ segments: content.map((item) => ({ index: item.index, language: "en" })) }) } }] };
    };
  })(), "auto", { retryDelayMs: 1 });
  assert.deepEqual(identified.map((segment) => segment.language), ["en", "en"]);
});

test("only languages Whisper officially supports are sent as hints", () => {
  assert.equal(whisperLanguageHint("sw"), "sw");
  assert.equal(whisperLanguageHint("fr"), "fr");
  assert.equal(whisperLanguageHint("fil"), "tl");
  assert.equal(whisperLanguageHint("yo"), undefined);
  assert.equal(whisperLanguageHint("pcm"), undefined);
  assert.equal(whisperLanguageHint("auto"), undefined);
});

test("silent synthesized audio cannot pass export validation", async () => {
  const dir = await mkdtemp(join(tmpdir(), "reellingo-silence-"));
  const silent = join(dir, "silent.wav");
  try {
    await run("ffmpeg", [
      "-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono:d=1", "-c:a", "pcm_s16le", silent,
    ]);
    await assert.rejects(assertAudibleAudio(silent), /silent audio/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("every transcription chunk is transcribed and rebased to full-video timestamps", async () => {
  const seenChunks = [];
  const result = await transcribeAudioChunks([
    { path: "first.wav", offset: 0 },
    { path: "second.wav", offset: 120 },
  ], async (chunk) => {
    seenChunks.push(chunk.path);
    return {
      language: chunk.offset === 0 ? "English" : "French",
      segments: [{ start: 1.25, end: 2.5, text: chunk.offset === 0 ? "first words" : "deux mots" }],
    };
  });

  assert.deepEqual(seenChunks, ["first.wav", "second.wav"]);
  assert.deepEqual(result.segments.map((segment) => [segment.start, segment.end]), [[1.25, 2.5], [121.25, 122.5]]);
  assert.deepEqual(result.chunkLanguages, ["en", "fr"]);
});

test("transcription retries transient errors and surfaces chunk context when all attempts fail", async () => {
  let calls = 0;
  await assert.rejects(() => transcribeAudioChunks([
    { path: "chunk-001.wav", offset: 0 },
  ], async () => {
    calls += 1;
    if (calls < 3) {
      const error = new Error("Connection reset by peer");
      error.code = "ECONNRESET";
      throw error;
    }
    throw new Error("OpenAI transcription failed after retries");
  }, { retryDelayMs: 1 }), /chunk-001.wav|OpenAI transcription failed after retries/);
  assert.equal(calls, 3);
});

test("mixed-language transcript is detected and translated by each segment's source language", async () => {
  const transcript = [
    { start: 0, end: 1.2, text: "Bawo ni", language: "und" },
    { start: 1.4, end: 2.6, text: "How are you", language: "und" },
  ];
  const identified = await detectSegmentLanguages(transcript, async (request) => {
    const content = JSON.parse(request.messages[1].content);
    return { choices: [{ message: { content: JSON.stringify({
      segments: content.map((segment) => ({ index: segment.index, language: segment.index === 0 ? "yo" : "en" })),
    }) } }] };
  });
  const sourcePrompts = [];
  const translated = await translate(identified, "es", async (request) => {
    sourcePrompts.push(request.messages[0].content);
    const content = JSON.parse(request.messages[1].content);
    return { choices: [{ message: { content: JSON.stringify({
      segments: content.map((segment) => ({ index: segment.index, text: `translated ${segment.text}` })),
    }) } }] };
  });

  assert.deepEqual(identified.map((segment) => segment.language), ["yo", "en"]);
  assert.equal(sourcePrompts.length, 2);
  assert.match(sourcePrompts[0], /Yoruba/);
  assert.match(sourcePrompts[1], /English/);
  assert.deepEqual(translated.map((segment) => segment.text), ["translated Bawo ni", "translated How are you"]);
  assert.deepEqual(translated.map((segment) => [segment.start, segment.end]), [[0, 1.2], [1.4, 2.6]]);
});