import { config } from "./config.js";
import { logger } from "./logger.js";
import { useSpitchVoice } from "./spitch.js";
import { providerSummaries } from "./usage.js";

/**
 * "Will this video get all the way through?" Asked before anything is uploaded or charged, so a customer is told
 * up front (and nothing is started) when a service we depend on can't finish the job.
 *
 * blockers: the job would fail, so it isn't started.   warnings: it will work, but the customer should know.
 */

const CACHE_MS = 60_000;
let cached = null;

/** Provider balances are looked at once a minute, not on every keystroke. */
async function providerStatus(now = Date.now()) {
  if (cached && cached.expires > now) return cached.value;
  const value = new Map();
  try {
    for (const summary of await providerSummaries()) value.set(summary.provider, summary);
  } catch (error) {
    // If we can't tell, don't stop anyone: the job itself will report a real problem if there is one.
    logger.warn({ err: error }, "Pre-start check could not read provider balances");
  }
  cached = { value, expires: now + CACHE_MS };
  return value;
}

export function resetPreflightCache() {
  cached = null;
}

const PAUSED = "We're topping up one of our services, so new videos are paused for a short while. Nothing was charged: please try again a little later.";

/**
 * @param {object} input
 * @param {string[]} input.targets target language codes
 * @param {number|null} input.duration video length in seconds (null when it isn't known yet)
 * @param {"dub"|"subtitles"} input.mode
 * @param {boolean} input.cloned whether the voices will be cloned (cloned voices always use ElevenLabs)
 * @param {boolean} input.lipSync
 */
export async function preflight({ targets, duration = null, mode = "dub", cloned = false, lipSync = false }) {
  const blockers = [];
  const warnings = [];
  const status = await providerStatus();
  const empty = (provider) => config.blockOnEmptyProvider && status.get(provider)?.balance?.status === "empty";

  if (!config.openaiApiKey) {
    blockers.push({ code: "setup", message: "Translation isn't switched on yet. Please contact support." });
  } else if (empty("openai")) {
    blockers.push({ code: "provider_credit", provider: "openai", message: PAUSED });
  }

  if (mode === "dub") {
    const nativeTargets = targets.filter((code) => useSpitchVoice(code, { cloned }));
    const elevenTargets = targets.filter((code) => !nativeTargets.includes(code));
    if (elevenTargets.length) {
      if (!config.elevenlabsApiKey) {
        blockers.push({ code: "setup", message: "Voice dubbing isn't switched on yet. Please contact support." });
      } else {
        const balance = status.get("elevenlabs")?.balance;
        if (balance?.status === "empty") {
          blockers.push({ code: "provider_credit", provider: "elevenlabs", message: PAUSED });
        } else if (duration && balance?.unit === "characters" && Number.isFinite(balance.remaining)) {
          // A fast talker is about charactersPerMinuteWorst characters a minute, once for each language.
          const needed = Math.ceil((duration / 60) * config.profitAssumptions.charactersPerMinuteWorst * elevenTargets.length);
          if (balance.remaining < needed) {
            blockers.push({ code: "provider_credit", provider: "elevenlabs", message: PAUSED, needed, remaining: balance.remaining });
          }
        }
      }
    }
    if (nativeTargets.length && empty("spitch")) {
      blockers.push({ code: "provider_credit", provider: "spitch", message: PAUSED });
    }
    if (lipSync && empty("sync")) {
      blockers.push({ code: "provider_credit", provider: "sync", message: "Lip-sync is paused for a short while while we top up that service. Try again later, or continue without lip-sync." });
    }
  }
  return { ok: blockers.length === 0, blockers, warnings };
}
