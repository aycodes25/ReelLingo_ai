import { logger } from "./logger.js";
import { notifyAdmins } from "./notify.js";

/**
 * Turns what a provider said ("Spitch translation (429): {"detail":{"code":"concurrency_limit_exceeded"…") into a
 * sentence a customer can act on. The full technical message is always in the server log; the customer gets the
 * sentence, and the admins get an email when something on our side (credit, keys) needs fixing.
 */
const RULES = [
  {
    kind: "credit",
    test: /insufficient_quota|exceeded your current quota|credit_balance|quota_exceeded|billing_hard_limit|no credits|out of credit|payment required|\(402\)|character_limit|quota.*exceeded/i,
    text: "One of the services we use is out of credit on our side, so this couldn't finish. Our team has been told and will top it up. Your minutes were returned: please try again in a little while.",
    alertsAdmin: true,
  },
  {
    kind: "keys",
    test: /invalid_api_key|incorrect api key|\(401\)|unauthorized|\(403\)|forbidden|authentication/i,
    text: "A connection to one of our services isn't working right now, so this couldn't finish. Our team has been told. Your minutes were returned: please try again soon.",
    alertsAdmin: true,
  },
  {
    kind: "busy",
    test: /concurrency_limit|too many requests|\(429\)|rate limit|overloaded|temporarily unavailable|\(503\)|\(502\)|\(504\)|server error/i,
    text: "Our voice and translation services were very busy for a moment. Nothing was lost: press Retry and it will carry on from where it stopped.",
    alertsAdmin: false,
  },
  {
    kind: "network",
    test: /econnreset|etimedout|timed out|timeout|fetch failed|network|socket|enotfound/i,
    text: "The connection to one of our services dropped. Nothing was lost: press Retry and it will carry on from where it stopped.",
    alertsAdmin: false,
  },
];

export function friendlyError(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  const rule = RULES.find((item) => item.test.test(message));
  return rule ? { kind: rule.kind, text: rule.text, alertsAdmin: rule.alertsAdmin } : { kind: "other", text: message, alertsAdmin: false };
}

// One email per kind of problem per hour, so a bad key doesn't send an email for every failed video.
const lastAlert = new Map();

export async function alertAdminsOnce(kind, subject, text, now = Date.now()) {
  if (now - (lastAlert.get(kind) || 0) < 3600 * 1000) return false;
  lastAlert.set(kind, now);
  try {
    return (await notifyAdmins(subject, text)) > 0;
  } catch (error) {
    logger.warn({ err: error }, "Could not alert the admins");
    return false;
  }
}

export function resetAlertThrottle() {
  lastAlert.clear();
}
