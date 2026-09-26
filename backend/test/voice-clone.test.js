import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
    });
  });
}

test("clones the uploaded speaker sample, synthesizes with that clone, then deletes it", async () => {
  process.env.ELEVENLABS_API_KEY = "test-elevenlabs-key";
  const { dubWithClonedVoice } = await import("../src/pipeline.js");
  const directory = await mkdtemp(join(tmpdir(), "reellingo-voice-test-"));
  const sourceAudio = join(directory, "source.wav");
  const outputAudio = join(directory, "dub.mp3");
  const requests = [];
  const originalFetch = globalThis.fetch;

  try {
    await run("ffmpeg", [
      "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
      "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", sourceAudio,
    ]);

    globalThis.fetch = async (url, options = {}) => {
      requests.push({ url: String(url), options });
      if (String(url).endsWith("/voices/add")) {
        const file = options.body.get("files");
        assert.equal(file.name, "speaker-sample.mp3");
        assert.equal(file.type, "audio/mpeg");
        assert.ok(file.size > 1000);
        assert.match(options.body.get("description"), /uploaded video/);
        assert.equal(options.body.get("remove_background_noise"), "true");
        return new Response(JSON.stringify({ voice_id: "temporary-clone-id" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (String(url).includes("/text-to-speech/temporary-clone-id")) {
        const body = JSON.parse(options.body);
        assert.equal(body.model_id, "eleven_multilingual_v2");
        assert.equal(body.language_code, "en");
        assert.equal(body.text, "Translated words for the audience.");
        return new Response(Buffer.from("mocked-mp3-audio"), { status: 200 });
      }
      if (String(url).endsWith("/voices/temporary-clone-id")) {
        assert.equal(options.method, "DELETE");
        return new Response(null, { status: 200 });
      }
      throw new Error(`Unexpected provider request: ${url}`);
    };

    const result = await dubWithClonedVoice(
      [{ start: 0.25, end: 1.4, text: "Translated words for the audience." }],
      sourceAudio,
      outputAudio,
      "en",
    );

    assert.equal(result, outputAudio);
    assert.equal((await readFile(outputAudio)).toString(), "mocked-mp3-audio");
    assert.equal(requests.length, 3);
    assert.ok(requests[0].url.endsWith("/voices/add"));
    assert.ok(requests[1].url.includes("/text-to-speech/temporary-clone-id"));
    assert.ok(requests[2].url.endsWith("/voices/temporary-clone-id"));
  } finally {
    globalThis.fetch = originalFetch;
    await rm(directory, { recursive: true, force: true });
  }
});