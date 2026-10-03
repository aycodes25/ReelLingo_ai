import { AsyncLocalStorage } from "node:async_hooks";
import { config } from "./config.js";
import { many, one, query } from "./db.js";
import { logger } from "./logger.js";

// Carries the running job through deep provider calls so every paid API call can be attributed to it.
export const jobContext = new AsyncLocalStorage();

export function runWithJob(job, task) {
  return jobContext.run({ jobId: job.id, userId: job.user_id }, task);
}

/** Records one paid-provider call for the usage dashboard. Never throws: usage tracking must not break the app. */
export async function recordUsage({ provider, operation, units, unit, costUsd = 0, userId = null, jobId = null }) {
  if (!Number.isFinite(costUsd) || !Number.isFinite(Number(units))) return;
  try {
    await query(
      "INSERT INTO cost_events (job_id, user_id, provider, operation, units, unit, cost_usd) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      [jobId, userId, provider, operation, Number(units), unit, Math.round(costUsd * 1e6) / 1e6],
    );
  } catch (error) {
    logger.warn({ err: error }, "Could not record provider usage");
  }
}

/** Records a call made while processing a job; the job and its owner come from the running job's context. */
export async function recordCost(provider, operation, units, unit, costUsd) {
  const context = jobContext.getStore();
  if (!context) return;
  await recordUsage({ provider, operation, units, unit, costUsd, userId: context.userId, jobId: context.jobId });
}

export function recordChatUsage(operation, usage) {
  if (!usage) return undefined;
  const input = Number(usage.prompt_tokens || 0);
  const output = Number(usage.completion_tokens || 0);
  const cost = (input * config.costs.chatInputPerMillion + output * config.costs.chatOutputPerMillion) / 1_000_000;
  return recordCost("openai", operation, input + output, "tokens", cost);
}

export async function jobCosts(jobId) {
  const rows = await many("SELECT provider, operation, SUM(units) AS units, MAX(unit) AS unit, SUM(cost_usd) AS cost FROM cost_events WHERE job_id = $1 GROUP BY provider, operation", [jobId]);
  const items = rows.map((row) => ({ provider: row.provider, operation: row.operation, units: Number(row.units), unit: row.unit, cost_usd: Number(row.cost) }));
  return { items, total_usd: Math.round(items.reduce((sum, item) => sum + item.cost_usd, 0) * 10000) / 10000 };
}

export async function totalCostSince(since) {
  const row = await one("SELECT COALESCE(SUM(cost_usd), 0) AS total FROM cost_events WHERE created_at >= $1", [since]);
  return Number(row?.total || 0);
}
