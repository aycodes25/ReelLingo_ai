const RETRYABLE_TOKENS = [
  "econnreset", "econnaborted", "econnrefused", "etimedout", "enotfound", "eai_again", "epipe",
  "connection", "timeout", "timed out", "fetch failed", "network", "socket", "temporar",
  "rate limit", "too many requests", "overloaded", "server error", "bad gateway", "service unavailable",
];

// Billing and quota problems come back as 429 too, but retrying them only delays the error.
const PERMANENT_TOKENS = ["insufficient_quota", "credit_balance_exhausted", "quota_exceeded", "billing", "no credits"];

export function isRetryableError(error) {
  const status = Number(error?.status || error?.statusCode || 0);
  const details = `${error?.code || ""} ${error?.type || ""} ${error?.error?.code || ""} ${error?.body || ""} ${error?.message || ""}`.toLowerCase();
  if (PERMANENT_TOKENS.some((token) => details.includes(token))) return false;
  if (status === 408 || status === 409 || status === 429 || status >= 500) return true;
  if (status >= 400) return false;
  const code = String(error?.code || "").toLowerCase();
  const message = String(error?.message || error || "").toLowerCase();
  return RETRYABLE_TOKENS.some((token) => code.includes(token) || message.includes(token));
}

export function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetries(task, { attempts = 4, baseDelayMs = 2000, maxDelayMs = 15000, label = "Request" } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await task(attempt);
    } catch (error) {
      lastError = error;
      if (!isRetryableError(error) || attempt === attempts) break;
      await wait(Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs));
    }
  }
  const message = lastError instanceof Error ? lastError.message : String(lastError);
  const wrapped = new Error(`${label} failed: ${message}`);
  wrapped.status = lastError?.status;
  wrapped.cause = lastError;
  throw wrapped;
}

// Turns a failed fetch Response into an Error carrying the HTTP status so retry rules can inspect it.
export async function responseError(response, context) {
  let body = "";
  try {
    body = await response.text();
  } catch {
    // ignore unreadable bodies
  }
  const error = new Error(`${context} (${response.status}): ${body.slice(0, 500)}`);
  error.status = response.status;
  error.body = body;
  return error;
}
