import express from "express";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { activateSubscription, approvePayment } from "../billing.js";
import { auditAdminChanges, listAudit } from "../audit.js";
import { jobCosts } from "../costs.js";
import { getJob, updateJob } from "../database.js";
import { dbTime, many } from "../db.js";
import { asyncRoute, authenticate, HttpError, jobOutput, requireAdmin, toIsoTimestamp } from "../http.js";
import {
  adjustMinutes, createUser, deleteTeam, deleteUser, emailUser, listAllPayments, listAllTeams, listUsers, syncAuthUsers, updateUser, userDetail,
} from "../admin.js";
import { config } from "../config.js";
import { purgeJob } from "../jobfiles.js";
import { ensureCharged, freeTierStatus, NotEnoughMinutes } from "../minutes.js";
import { applyRecommendedPricing, createPlan, DEFAULT_PACKS, deletePlan, getPlan, getRawPlan, listPacks, listRawPlans, PERMISSIONS, savePacks, updatePlan } from "../plans.js";
import { planProfitWarnings, profitReport } from "../profit.js";
import { adminReviewOverview, markReviewerPaid, setReviewer } from "../reviews.js";
import { createVoiceSample, listVoiceTests, rateVoiceTest, voiceLabOptions } from "../voicelab.js";
import { planFor } from "../accounts.js";
import { listSettings, updateSettings } from "../settings.js";
import {
  BUDGET_UNITS, clearUsageCache, dailyUsage, deleteProviderBudget, providerSummaries, setProviderBudget, setUserBudget, usageByUser, userUsageDetail,
} from "../usage.js";

const router = express.Router();
router.use("/admin", authenticate, requireAdmin, auditAdminChanges);

// Naira→USD rate for margin estimates comes from Admin → Settings (NGN_PER_USD in .env by default).


/**
 * Turns a raw job error into a readable, groupable line: provider JSON is reduced to its message,
 * temporary folder paths and long IDs are shortened, but small numbers (gpt-4o, chunk-0003) stay readable.
 */
export function errorGroup(message) {
  let text = String(message || "Unknown error");
  const jsonStart = text.indexOf("{");
  if (jsonStart !== -1) {
    try {
      const parsed = JSON.parse(text.slice(jsonStart));
      const detail = parsed.detail || parsed.error || parsed;
      const inner = typeof detail === "string" ? detail : detail.message || detail.msg || detail.code || detail.type;
      if (inner) text = `${text.slice(0, jsonStart).replace(/[\s:(]+$/, "")}: ${inner}`;
    } catch {
      // not JSON: keep the text as it is
    }
  }
  return text
    .replace(/[A-Za-z]:\\[^\s:]*\\(?=[^\\\s]+\.\w+)/g, "")
    .replace(/\/tmp\/[^\s:]*\//g, "")
    .replace(/\b(?:gen-|req_|org_|org-|sk-|proj_)\w+|\b[0-9a-f]{16,}\b/gi, "…")
    .replace(/\b\d{5,}\b/g, "…")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

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
      const key = errorGroup(job.error_message);
      errors.set(key, (errors.get(key) || 0) + 1);
    }
    const took = job.status === "done" ? seconds(job.started_at, job.completed_at) : null;
    if (took) processing.push(took);
  }
  const finished = (byStatus.done || 0) + (byStatus.failed || 0);
  const totalCost = costs.reduce((sum, row) => sum + Number(row.cost), 0);
  const revenueUsd = payments.reduce((sum, row) => sum + (row.currency === "NGN" ? Number(row.amount) / 100 / config.ngnPerUsd : Number(row.amount) / 100), 0);
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
      ngn_per_usd: config.ngnPerUsd,
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
  // The failed attempt refunded its minutes; an admin retry charges them again (even if it takes the balance below zero).
  if (job.status === "failed") {
    const plan = await planFor({ userId: job.user_id, teamId: job.team_id });
    try {
      await ensureCharged(job, { billingId: plan.billingId, allowance: plan.plan.minutes_per_month, periodEnd: plan.periodEnd, force: true });
    } catch (error) {
      if (!(error instanceof NotEnoughMinutes)) throw error;
    }
  }
  response.json(await jobOutput(await updateJob(job.id, { status: "queued", current_step: "queued", attempts: 0, error_message: null })));
}));

router.post("/admin/minutes", asyncRoute(async (request, response) => {
  const billingId = String(request.body?.billing_id || "").trim();
  if (!billingId) throw new HttpError(400, "Provide billing_id and minutes.");
  try {
    response.status(201).json({ added: await adjustMinutes(billingId, request.body?.minutes, request.body?.note, request.userId) });
  } catch (error) {
    throw new HttpError(400, error.message);
  }
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

/** Runs an admin action, turning validation errors into 400s (404s pass through). */
function action(handler) {
  return asyncRoute(async (request, response) => {
    try {
      await handler(request, response);
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(error.status || 400, error.message);
    }
  });
}

// ---------- Jobs ----------
router.delete("/admin/jobs/:jobId", action(async (request, response) => {
  const job = await getJob(Number(request.params.jobId));
  if (!job) throw new HttpError(404, "Job not found.");
  await purgeJob(job, { hard: request.query.hard === "1" });
  response.status(204).end();
}));

// ---------- Users ----------
router.get("/admin/users", action(async (request, response) => {
  if (request.query.sync === "1") await syncAuthUsers();
  response.json(await listUsers({
    search: String(request.query.q || ""), plan: String(request.query.plan || ""), status: String(request.query.status || ""),
    page: Math.max(1, Number(request.query.page) || 1), perPage: Math.min(Math.max(Number(request.query.per_page) || 50, 1), 200),
  }));
}));

router.post("/admin/users", action(async (request, response) => {
  response.status(201).json(await createUser(request.body || {}, request.user));
}));

router.get("/admin/users/:userId", action(async (request, response) => {
  response.json(await userDetail(String(request.params.userId)));
}));

router.patch("/admin/users/:userId", action(async (request, response) => {
  response.json(await updateUser(String(request.params.userId), request.body || {}, request.user));
}));

router.delete("/admin/users/:userId", action(async (request, response) => {
  response.json(await deleteUser(String(request.params.userId), request.user));
}));

router.post("/admin/users/:userId/minutes", action(async (request, response) => {
  await adjustMinutes(String(request.params.userId), request.body?.minutes, request.body?.note, request.userId);
  response.status(201).json(await userDetail(String(request.params.userId)));
}));

router.put("/admin/users/:userId/reviewer", action(async (request, response) => {
  await setReviewer(String(request.params.userId), { isReviewer: Boolean(request.body?.is_reviewer), languages: Array.isArray(request.body?.languages) ? request.body.languages : [] });
  response.json(await userDetail(String(request.params.userId)));
}));

router.post("/admin/users/:userId/email", action(async (request, response) => {
  await emailUser(String(request.params.userId), request.body?.subject, request.body?.message);
  response.json({ sent: true });
}));

// ---------- Plans ----------
router.get("/admin/plans", action(async (_request, response) => {
  const plans = await listRawPlans();
  const counts = new Map((await many(
    "SELECT tier, COUNT(*) AS count FROM subscriptions WHERE status <> 'canceled' AND (current_period_end IS NULL OR current_period_end > $1) GROUP BY tier",
    [dbTime()],
  )).map((row) => [row.tier, Number(row.count)]));
  response.json({ plans: plans.map((plan) => ({ ...plan, subscribers: counts.get(plan.code) || 0 })), permissions: PERMISSIONS, max_video_minutes: config.maxVideoMinutes });
}));

/** A plan that could lose money at the worst case is only saved when the admin confirms it (confirm_loss: true). */
function assertProfitable(request, plan) {
  if (request.body?.confirm_loss === true) return;
  const warnings = planProfitWarnings(plan);
  if (warnings.length) {
    throw new HttpError(409, `This plan could lose money: ${warnings.join(" ")} Change the price or minutes, or save it anyway.`, { code: "unprofitable", warnings });
  }
}

router.post("/admin/plans", action(async (request, response) => {
  assertProfitable(request, request.body || {});
  response.status(201).json(await createPlan(request.body || {}));
}));

router.put("/admin/plans/:code", action(async (request, response) => {
  const code = String(request.params.code);
  const before = await getRawPlan(code);
  if (!before) throw new HttpError(404, "Plan not found.");
  assertProfitable(request, { ...before, ...(request.body || {}) });
  response.locals.audit = { before };
  response.json(await updatePlan(code, request.body || {}));
}));

router.delete("/admin/plans/:code", action(async (request, response) => {
  response.json(await deletePlan(String(request.params.code), String(request.query.move_to || "free")));
}));

/** Profit check: every plan and pack, at worst-case and typical usage, from the provider prices in Settings. */
router.get("/admin/profit", action(async (_request, response) => {
  response.json({ ...(await profitReport()), free_tier: await freeTierStatus() });
}));

/** Writes the profit-checked prices and minutes onto the live plans and packs. */
router.post("/admin/plans/apply-recommended", action(async (request, response) => {
  const changed = await applyRecommendedPricing({ includeText: Boolean(request.body?.include_text) });
  response.json({ changed, report: await profitReport() });
}));

router.get("/admin/packs", action(async (_request, response) => {
  response.json({ packs: await listPacks(), defaults: DEFAULT_PACKS });
}));

router.put("/admin/packs", action(async (request, response) => {
  response.locals.audit = { before: await listPacks() };
  response.json({ packs: await savePacks(request.body?.packs, request.userId) });
}));

// ---------- Human reviewers ----------
router.get("/admin/reviews", action(async (_request, response) => {
  response.json(await adminReviewOverview());
}));

router.post("/admin/reviewers/:userId/paid", action(async (request, response) => {
  response.json(await markReviewerPaid(String(request.params.userId)));
}));

// ---------- Voice Lab: listen to each voice before customers do ----------
router.get("/admin/voice-lab", action(async (_request, response) => {
  response.json({ ...voiceLabOptions(), tests: await listVoiceTests() });
}));

router.post("/admin/voice-lab/samples", action(async (request, response) => {
  const directory = await mkdtemp(join(tmpdir(), "reellingo-voicelab-"));
  try {
    response.status(201).json(await createVoiceSample(request.body || {}, request.userId, directory));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}));

router.put("/admin/voice-lab/:id", action(async (request, response) => {
  response.json(await rateVoiceTest(Number(request.params.id), request.body || {}));
}));

// ---------- Settings ----------
router.get("/admin/settings", action(async (_request, response) => {
  response.json(listSettings());
}));

router.put("/admin/settings", action(async (request, response) => {
  const changing = new Set(Object.keys(request.body || {}));
  response.locals.audit = { before: Object.fromEntries(listSettings().filter((setting) => changing.has(setting.key)).map((setting) => [setting.key, setting.value])) };
  response.json(await updateSettings(request.body || {}, request.userId));
}));

// ---------- API usage dashboard ----------
router.get("/admin/usage", action(async (request, response) => {
  if (request.query.refresh === "1") clearUsageCache();
  const days = Math.min(Math.max(Number(request.query.days) || 30, 1), 365);
  const [providers, daily, users] = await Promise.all([providerSummaries(), dailyUsage(days), usageByUser({ days })]);
  response.json({
    days,
    providers,
    daily,
    users,
    totals: {
      cost_usd: Math.round(users.reduce((sum, user) => sum + user.cost_usd, 0) * 10000) / 10000,
      users: users.filter((user) => user.cost_usd > 0).length,
    },
    units: BUDGET_UNITS,
    openai_admin_key: Boolean(config.openaiAdminKey),
  });
}));

router.get("/admin/usage/users/:userId", action(async (request, response) => {
  const days = Math.min(Math.max(Number(request.query.days) || 30, 1), 365);
  response.json(await userUsageDetail(String(request.params.userId), { days }));
}));

router.put("/admin/usage/budgets/:provider", action(async (request, response) => {
  const budget = await setProviderBudget(String(request.params.provider), request.body || {});
  clearUsageCache();
  response.json(budget);
}));

router.delete("/admin/usage/budgets/:provider", action(async (request, response) => {
  await deleteProviderBudget(String(request.params.provider));
  clearUsageCache();
  response.status(204).end();
}));

router.put("/admin/usage/user-budgets/:userId", action(async (request, response) => {
  response.json({ budget: await setUserBudget(String(request.params.userId), request.body || {}) });
}));

// ---------- Teams & payments ----------
router.get("/admin/teams", action(async (_request, response) => {
  response.json(await listAllTeams());
}));

router.delete("/admin/teams/:teamId", action(async (request, response) => {
  await deleteTeam(Number(request.params.teamId));
  response.status(204).end();
}));

router.get("/admin/payments", action(async (request, response) => {
  response.json(await listAllPayments({ status: String(request.query.status || "") }));
}));

/** Accepts a payment that was held because the provider collected less than the price (for example a discount). */
router.post("/admin/payments/:reference/approve", action(async (request, response) => {
  response.json(await approvePayment(String(request.params.reference)));
}));

// ---------- Audit trail ----------
router.get("/admin/audit", action(async (request, response) => {
  response.json(await listAudit({
    limit: Math.min(Math.max(Number(request.query.limit) || 100, 1), 500), offset: Math.max(Number(request.query.offset) || 0, 0), search: String(request.query.q || ""),
  }));
}));

export default router;
