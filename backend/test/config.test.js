import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import test from "node:test";

const backendDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("an OpenAI key enables live mode even when the example still says MOCK_MODE=true", () => {
  const result = spawnSync(process.execPath, [
    "--input-type=module",
    "-e",
    "import { config } from './src/config.js'; process.stdout.write(config.mockMode ? 'demo' : 'live')",
  ], {
    cwd: backendDirectory,
    encoding: "utf8",
    env: { ...process.env, MOCK_MODE: "true", OPENAI_API_KEY: "test-key" },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "live");
});