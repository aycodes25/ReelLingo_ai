import assert from "node:assert/strict";
import test from "node:test";
import { isRetryableError, withRetries } from "../src/retry.js";

function apiError(status, message, extra = {}) {
  return Object.assign(new Error(message), { status, ...extra });
}

test("transient network and rate-limit failures are retried", () => {
  assert.equal(isRetryableError(new Error("Connection error.")), true);
  assert.equal(isRetryableError(Object.assign(new Error("socket hang up"), { code: "ECONNRESET" })), true);
  assert.equal(isRetryableError(apiError(429, "Rate limit reached for requests")), true);
  assert.equal(isRetryableError(apiError(503, "Service Unavailable")), true);
});

test("billing, quota and request errors fail immediately", () => {
  assert.equal(isRetryableError(apiError(429, "You have no credits remaining.", { code: "credit_balance_exhausted", type: "insufficient_quota" })), false);
  assert.equal(isRetryableError(apiError(401, "quota_exceeded", { body: "{\"detail\":{\"status\":\"quota_exceeded\"}}" })), false);
  assert.equal(isRetryableError(apiError(400, "Invalid file format")), false);
  assert.equal(isRetryableError(apiError(404, "model not found")), false);
});

test("withRetries retries until success and labels the final failure", async () => {
  let calls = 0;
  const value = await withRetries(async () => {
    calls += 1;
    if (calls < 3) throw new Error("Connection error.");
    return "ok";
  }, { baseDelayMs: 1 });
  assert.equal(value, "ok");
  assert.equal(calls, 3);

  let quotaCalls = 0;
  await assert.rejects(withRetries(async () => {
    quotaCalls += 1;
    throw apiError(429, "You have no credits remaining.", { code: "credit_balance_exhausted" });
  }, { baseDelayMs: 1, label: "Transcription" }), /Transcription failed: You have no credits remaining/);
  assert.equal(quotaCalls, 1);
});
