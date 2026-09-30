import express from "express";
import { grantCredit } from "../accounts.js";
import { activateSubscription } from "../billing.js";
import { jobCosts } from "../costs.js";
import { getJob, updateJob } from "../database.js";
import { dbTime, many } from "../db.js";
import { asyncRoute, authenticate, HttpError, jobOutput, requireAdmin, toIsoTimestamp } from "../http.js";
import { getPlan } from "../plans.js";

const router = express.Router();
router.use("/admin", authenticate, requireAdmin);

// Rough conversion for margin estimates only; set NGN_PER_USD to your current rate.
const NGN_PER_USD = Number(process.env.NGN_PER_USD || 1600);

function seconds(from, to) {
  const start = Date.parse(toIsoTimestamp(from));
  const end = Date.parse(toIsoTimestamp(to));
  return Number.isFinite(start) && Number.isFinite(end) && end > start ? (end - start) / 1000 : null;
}

router.get("/admin/overview", asyncRoute(async (request, response) => {
  const days = Math.min(Math.max(Number(request.query.days) || 30, 1), 365);
  const since = dbTime(new Date(Date.now() - days * 86400000));
  const jobs = await many("SELECT id, user_id, status, started_at, completed_at, duration_seconds, error_message, current_step, created_at FROM jobs WHERE created_at >= $1 ORDER BY id DESC LIMIT 10000", [since]);
  const costs = await many("SELECT provider, operation, SUM(cost_usd) AS cost, COUNT(*) AS calls FROM cost_events WHERE created_at >= $1 GROUP BY provider, operation ORDER BY cost DESC", [since]);
  const payments = await many("SELECT currency, SUM(amount) AS amount, COUNT(*) AS count FROM payments WHERE status = 'success' AND created_at >= $1 GROUP BY currency", [since]);
  const byStatus = {};
  const errors = new Map();
  const users = new Map();
  const processing = [];
  let minutes = 0;
  for (const job of jobs) {
    byStatus[job.status] = (byStatus[job.status] || 0) + 1;
    users.set(job.user_id, (users.get(job.user_id) || 0) + 1);
    minutes += Number(job.duration_seconds || 0) / 60;
    if (job.status === "failed" && job.error_message) {
      const key = job.error_message.replace(/\d+/g, "#").slice(0, 120);
      errors.set(key, (errors.get(key) || 0) + 1);
    }
    const took = job.status === "done" ? seconds(job.started_at, job.completed_at) : null;
    if (took) processing.push(took);
  }
  const finished = (byStatus.done || 0) + (byStatus.failed || 0);
  const totalCost = costs.reduce((sum, row) => sum + Number(row.cost), 0);
  const revenueUsd = payments.reduce((sum, row) => sum + (row.currency === "NGN" ? Number(row.amount) / 100 / NGN_PER_USD : Number(row.amount) / 100), 0);
  processing.sort((a, b) => a - b);
  response.json({
    days,
    jobs: { total: jobs.length, by_status: byStatus, failure_rate: finished ? (byStatus.failed || 0) / finished : 0, minutes_processed: Math.round(minutes) },
    processing_seconds: processing.length ? { median: processing[Math.floor(processing.length / 2)], p90: processing[Math.floor(processing.length * 0.9)] } : null,
    top_errors: [...errors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([message, count]) => ({ message, count })),
    top_users: [...users.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([user_id, count]) => ({ user_id, jobs: count })),
    costs: {
      total_usd: Math.round(totalCost * 100) / 100,
      per_done_job_usd: byStatus.done ? Math.round((totalCost / byStatus.done) * 1000) / 1000 : null,
      per_minute_usd: minutes ? Math.round((totalCost / minutes) * 1000) / 1000 : null,
      by_operation: costs.map((row) => ({ provider: row.provider, operation: row.operation, cost_usd: Math.round(Number(row.cost) * 1000) / 1000, calls: Number(row.calls) })),
    },
    revenue: {
      estimated_usd: Math.round(revenueUsd * 100) / 100,
      by_currency: payments.map((row) => ({ currency: row.currency, amount: Number(row.amount) / 100, count: Number(row.count) })),
      margin_usd: Math.round((revenueUsd - totalCost) * 100) / 100,
      ngn_per_usd: NGN_PER_USD,
    },
  });
}));

router.get("/admin/jobs", asyncRoute(async (request, response) => {
  const status = String(request.query.status || "");
  const limit = Math.min(Number(request.query.limit) || 50, 200);
  const rows = status
    ? await many("SELECT id FROM jobs WHERE status = $1 ORDER BY id DESC LIMIT $2", [status, limit])
    : await many("SELECT id FROM jobs ORDER BY id DESC LIMIT $1", [limit]);
  const result = [];
  for (const row of rows) {
    const job = await getJob(Number(row.id));
    const output = await jobOutput(job, { detail: false });
    result.push({ ...output, user_id: job.user_id, costs: await jobCosts(job.id), deleted: Boolean(job.deleted_at) });
  }
  response.json(result);
}));

router.post("/admin/jobs/:jobId/retry", asyncRoute(async (request, response) => {
  const job = await getJob(Number(request.params.jobId));
  if (!job) throw new HttpError(404, "Job not found.");
  response.json(await jobOutput(await updateJob(job.id, { status: "queued", current_step: "queued", attempts: 0, error_message: null })));
}));

router.post("/admin/credits", asyncRoute(async (request, response) => {
  const billingId = String(request.body?.billing_id || "").trim();
  const minutes = Number(request.body?.max_minutes);
  if (!billingId || !Number.isInteger(minutes) || minutes <= 0) throw new HttpError(400, "Provide billing_id and a whole number of max_minutes.");
  response.status(201).json(await grantCredit(billingId, minutes, "admin", `admin:${request.userId}`));
}));

router.post("/admin/subscriptions", asyncRoute(async (request, response) => {
  const billingId = String(request.body?.billing_id || "").trim();
  const plan = await getPlan(String(request.body?.plan || ""));
  if (!billingId || plan.code !== request.body?.plan) throw new HttpError(400, "Provide billing_id and a valid plan code.");
  const months = Math.min(Math.max(Number(request.body?.months) || 1, 1), 24);
  const end = new Date();
  end.setUTCMonth(end.getUTCMonth() + months);
  await activateSubscription(billingId, plan.code, { provider: "manual", periodEnd: end });
  response.json({ billing_id: billingId, plan: plan.code, current_period_end: end.toISOString() });
}));

export default router;
