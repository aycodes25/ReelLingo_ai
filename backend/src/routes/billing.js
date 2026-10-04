import express from "express";
import { config } from "../config.js";
import { planFor } from "../accounts.js";
import {
  billingProviders, cancelSubscription, createCheckout, handlePaystackEvent, handleStripeEvent, paymentHistory, verifyPayment,
  verifyPaystackSignature, verifyStripeSignature,
} from "../billing.js";
import { asyncRoute, authenticate, blockDuringMaintenance, HttpError, workspace } from "../http.js";
import { logger } from "../logger.js";
import { listPacks, listPlans } from "../plans.js";

const router = express.Router();

function requireBillingRole(request) {
  if (request.workspace.teamId && !["owner", "admin"].includes(request.workspace.role)) {
    throw new HttpError(403, "Only team owners and admins can manage the team's billing.");
  }
}

router.get("/plans", asyncRoute(async (_request, response) => {
  response.json({ plans: await listPlans(), packs: config.featurePayg ? await listPacks() : [], providers: billingProviders(), yearly: config.featureYearly, weights: { ...config.minuteWeights } });
}));

router.get("/billing", authenticate, workspace, asyncRoute(async (request, response) => {
  const plan = await planFor({ userId: request.userId, teamId: request.workspace.teamId });
  response.json({
    tier: plan.tier,
    plan: plan.plan,
    subscription: plan.subscription,
    minutes: plan.minutes,
    usage: { videos_this_month: plan.videosThisMonth, minutes_this_month: plan.minutesThisMonth },
    plans: await listPlans(),
    packs: config.featurePayg ? await listPacks() : [],
    providers: billingProviders(),
    yearly: config.featureYearly,
    weights: { ...config.minuteWeights },
    // Which plans can renew automatically on Paystack (a plan code is set for them), per billing cycle.
    paystack_auto_renew: Object.values(config.paystackPlanCodes).some(Boolean),
    paystack_auto_renew_plans: Object.keys(config.paystackPlanCodes),
    payments: await paymentHistory(plan.billingId),
    workspace: request.workspace.teamId ? { team_id: request.workspace.teamId, role: request.workspace.role } : null,
  });
}));

router.post("/billing/checkout", authenticate, blockDuringMaintenance, workspace, asyncRoute(async (request, response) => {
  requireBillingRole(request);
  if (!request.user.email) throw new HttpError(400, "Your account needs an email address to pay.");
  const provider = request.body?.provider === "stripe" ? "stripe" : "paystack";
  try {
    const result = await createCheckout({
      provider,
      user: request.user,
      billingId: request.workspace.teamId ? `team:${request.workspace.teamId}` : request.userId,
      planCode: request.body?.plan || null,
      packCode: request.body?.pack || null,
      autoRenew: request.body?.auto_renew !== false,
      cycle: request.body?.cycle === "yearly" ? "yearly" : "monthly",
    });
    response.json(result);
  } catch (error) {
    throw new HttpError(400, error.message);
  }
}));

router.post("/billing/verify", authenticate, asyncRoute(async (request, response) => {
  const provider = request.body?.provider === "stripe" ? "stripe" : "paystack";
  try {
    response.json(await verifyPayment(provider, { reference: request.body?.reference, sessionId: request.body?.session_id }));
  } catch (error) {
    throw new HttpError(400, error.message);
  }
}));

router.post("/billing/cancel", authenticate, workspace, asyncRoute(async (request, response) => {
  requireBillingRole(request);
  try {
    await cancelSubscription(request.workspace.teamId ? `team:${request.workspace.teamId}` : request.userId);
  } catch (error) {
    throw new HttpError(400, error.message);
  }
  response.json({ canceled: true });
}));

/** Webhooks need the exact raw body to verify signatures, so they're mounted before the JSON parser. */
export const webhookRouter = express.Router();
webhookRouter.post("/billing/webhooks/paystack", express.raw({ type: "*/*", limit: "1mb" }), asyncRoute(async (request, response) => {
  const raw = request.body.toString("utf8");
  if (!verifyPaystackSignature(raw, request.headers["x-paystack-signature"])) {
    response.status(401).json({ detail: "Invalid signature." });
    return;
  }
  try {
    await handlePaystackEvent(JSON.parse(raw));
  } catch (error) {
    logger.error({ err: error }, "Paystack webhook failed");
    response.status(500).json({ detail: "Webhook processing failed." });
    return;
  }
  response.json({ received: true });
}));

webhookRouter.post("/billing/webhooks/stripe", express.raw({ type: "*/*", limit: "1mb" }), asyncRoute(async (request, response) => {
  const raw = request.body.toString("utf8");
  if (!verifyStripeSignature(raw, request.headers["stripe-signature"])) {
    response.status(401).json({ detail: "Invalid signature." });
    return;
  }
  try {
    await handleStripeEvent(JSON.parse(raw));
  } catch (error) {
    logger.error({ err: error }, "Stripe webhook failed");
    response.status(500).json({ detail: "Webhook processing failed." });
    return;
  }
  response.json({ received: true });
}));

export default router;
