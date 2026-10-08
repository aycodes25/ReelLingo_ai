import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { rewardReferralIfDue } from "./accounts.js";
import { config } from "./config.js";
import { many, one, query, toBool } from "./db.js";
import { logger } from "./logger.js";
import { grantMinutes } from "./minutes.js";
import { notifyAdmins } from "./notify.js";
import { getPack, getPlan } from "./plans.js";

export function billingProviders() {
  return { paystack: Boolean(config.paystackSecretKey), stripe: Boolean(config.stripeSecretKey) };
}

async function paystack(path, { method = "GET", body } = {}) {
  const response = await fetch(`https://api.paystack.co${path}`, {
    method,
    headers: { Authorization: `Bearer ${config.paystackSecretKey}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.status === false) throw new Error(`Paystack: ${data.message || response.status}`);
  return data.data;
}

function formEncode(value, prefix = "", pairs = []) {
  if (value === undefined || value === null) return pairs;
  if (typeof value === "object") {
    for (const [key, item] of Object.entries(value)) formEncode(item, prefix ? `${prefix}[${key}]` : key, pairs);
  } else {
    pairs.push([prefix, String(value)]);
  }
  return pairs;
}

async function stripe(path, { method = "GET", body } = {}) {
  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${config.stripeSecretKey}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: body ? new URLSearchParams(formEncode(body)).toString() : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Stripe: ${data.error?.message || response.status}`);
  return data;
}

function toIso(value) {
  if (value instanceof Date) return value.toISOString();
  const text = String(value || "");
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text) ? `${text.replace(" ", "T")}Z` : text;
}

/** End of a paid period: one month, or twelve for yearly plans. */
export function periodAfter(cycle, from = new Date()) {
  const next = new Date(from);
  next.setUTCMonth(next.getUTCMonth() + (cycle === "yearly" ? 12 : 1));
  return next;
}

/** A renewal extends from the current end date (so paying a day early never loses a day), or from now if it lapsed. */
function renewalEnd(subscription) {
  const currentEnd = subscription.current_period_end ? new Date(subscription.current_period_end) : null;
  const from = currentEnd && currentEnd > new Date() ? currentEnd : new Date();
  return periodAfter(subscription.billing_cycle === "yearly" ? "yearly" : "monthly", from);
}

async function recordPayment({ userId, billingId, provider, reference, kind, planCode = null, pack = null, amount, currency, cycle = null }) {
  await query(
    `INSERT INTO payments (user_id, billing_id, provider, reference, kind, plan_code, credit_pack, amount, currency, status, billing_cycle, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', $10, CURRENT_TIMESTAMP)`,
    [userId, billingId, provider, reference, kind, planCode, pack, amount, currency, cycle],
  );
}

/** Starts a checkout for a plan subscription or a pay-as-you-go pack and returns the hosted payment page URL. */
export async function createCheckout({ provider, user, billingId, planCode = null, packCode = null, autoRenew = true, cycle = "monthly" }) {
  const providers = billingProviders();
  if (!providers[provider]) throw new Error(`${provider === "stripe" ? "Stripe" : "Paystack"} payments aren't configured on this server.`);
  const pack = packCode ? await getPack(packCode) : null;
  if (packCode && !pack) throw new Error("That minute pack no longer exists. Refresh the page and choose another.");
  const plan = planCode ? await getPlan(planCode) : null;
  if (!pack && (!plan || plan.code !== planCode || plan.price_usd <= 0)) throw new Error("Choose a paid plan or a minute pack.");
  if (pack && !config.featurePayg) throw new Error("Minute packs are currently unavailable.");
  if (plan && (plan.contact_sales || !plan.public)) throw new Error(`The ${plan.name} plan is arranged directly with our team. Contact ${config.supportEmail}.`);
  const yearly = !pack && cycle === "yearly";
  if (yearly && (!config.featureYearly || !plan.price_usd_yearly || !plan.price_ngn_yearly)) throw new Error(`The ${plan.name} plan isn't available yearly.`);
  const billingCycle = pack ? null : yearly ? "yearly" : "monthly";
  const kind = pack ? "payg" : "subscription";
  const reference = `rl_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  const callback = `${config.frontendUrl}/billing/callback?provider=${provider}`;
  const metadata = { billing_id: billingId, user_id: user.id, kind, plan_code: plan?.code || "", pack: pack?.code || "", cycle: billingCycle || "", reference };
  const planKey = plan ? `${plan.code}${yearly ? "_yearly" : ""}` : "";

  if (provider === "paystack") {
    const amount = Math.round((pack ? pack.price_ngn : yearly ? plan.price_ngn_yearly : plan.price_ngn) * 100);
    // A Paystack plan makes the payment renew automatically, but Paystack then only accepts cards.
    // Without it the customer can also pay by bank transfer, USSD or bank, and pays again when the period ends.
    const planCodeOnPaystack = !pack && autoRenew ? config.paystackPlanCodes[planKey] || "" : "";
    await recordPayment({ userId: user.id, billingId, provider, reference, kind, planCode: plan?.code, pack: pack?.code, amount, currency: "NGN", cycle: billingCycle });
    const data = await paystack("/transaction/initialize", {
      method: "POST",
      body: {
        email: user.email, amount, currency: "NGN", reference, callback_url: `${callback}&reference=${reference}`, metadata,
        ...(planCodeOnPaystack ? { plan: planCodeOnPaystack } : {}),
      },
    });
    return { url: data.authorization_url, reference };
  }

  const amount = Math.round((pack ? pack.price_usd : yearly ? plan.price_usd_yearly : plan.price_usd) * 100);
  await recordPayment({ userId: user.id, billingId, provider, reference, kind, planCode: plan?.code, pack: pack?.code, amount, currency: "USD", cycle: billingCycle });
  const priceId = !pack ? config.stripePriceIds[planKey] || "" : "";
  const lineItem = priceId
    ? { price: priceId, quantity: 1 }
    : {
      quantity: 1,
      price_data: {
        currency: "usd",
        unit_amount: amount,
        product_data: { name: pack ? `ReelLingo ${pack.minutes} minutes` : `ReelLingo ${plan.name} plan (${billingCycle})` },
        ...(pack ? {} : { recurring: { interval: yearly ? "year" : "month" } }),
      },
    };
  const session = await stripe("/checkout/sessions", {
    method: "POST",
    body: {
      mode: pack ? "payment" : "subscription",
      line_items: [lineItem],
      success_url: `${callback}&session_id={CHECKOUT_SESSION_ID}&reference=${reference}`,
      cancel_url: `${config.frontendUrl}/billing?canceled=1`,
      client_reference_id: billingId,
      customer_email: user.email || undefined,
      metadata,
      ...(pack ? {} : { subscription_data: { metadata } }),
    },
  });
  await query("UPDATE payments SET raw_json = $1 WHERE reference = $2", [JSON.stringify({ session_id: session.id }), reference]);
  return { url: session.url, reference };
}

const isDuplicate = (error) => /unique|duplicate/i.test(String(error?.message));

/** Alerts the admins that money came in short (or in the wrong currency), so nothing was activated. */
async function flagUnderpayment(payment, paid, context) {
  logger.error({ reference: payment.reference, expected: payment.amount, expectedCurrency: payment.currency, paid }, `Payment held: ${context}`);
  const received = paid?.amount === undefined || paid?.amount === null ? "unknown" : `${Number(paid.amount) / 100} ${String(paid.currency || "").toUpperCase()}`;
  await notifyAdmins(
    `ReelLingo: a payment was held (${payment.reference})`,
    `${context}\n\nReference: ${payment.reference}\nExpected: ${Number(payment.amount) / 100} ${payment.currency}\nReceived: ${received}\n\n`
    + "Nothing was activated. Most often the Paystack plan or Stripe price still has an old amount: update it there so it matches Admin → Plans. "
    + "If the amount is fine (for example a discount you gave), open Admin → Payments and approve the payment.",
  ).catch(() => undefined);
}

/** True when what the provider says it collected covers what was asked for, in the same currency. */
function coversPrice(expected, paid) {
  if (!paid || paid.amount === undefined || paid.amount === null || !paid.currency) return false;
  return String(paid.currency).toUpperCase() === String(expected.currency).toUpperCase() && Number(paid.amount) >= Number(expected.amount);
}

/**
 * Activates a plan or adds minutes for a successful payment. Safe to call repeatedly (callback + webhook).
 * `paid` is what the provider says it collected: a payment that doesn't cover the price is held, never activated.
 * `approved` is set when an admin has looked at a held payment and accepted it.
 */
async function fulfill(reference, { providerRef = null, customer = null, periodEnd = null, raw = null, paid = null, approved = false } = {}) {
  const payment = await one("SELECT * FROM payments WHERE reference = $1", [reference]);
  if (!payment) throw new Error("Unknown payment reference.");
  if (payment.status === "success") return { alreadyProcessed: true, payment };
  if (!approved && !coversPrice({ amount: Number(payment.amount), currency: payment.currency }, paid)) {
    await query("UPDATE payments SET status = 'underpaid', raw_json = $1, updated_at = CURRENT_TIMESTAMP WHERE reference = $2 AND status <> 'success'", [JSON.stringify({ ...(raw || {}), paid }).slice(0, 20000), reference]);
    if (payment.status !== "underpaid") await flagUnderpayment(payment, paid, "The provider collected less than the price, or a different currency.");
    return { alreadyProcessed: false, underpaid: true, payment };
  }
  const claimed =await query("UPDATE payments SET status = 'success', raw_json = COALESCE($1, raw_json), updated_at = CURRENT_TIMESTAMP WHERE reference = $2 AND status <> 'success'", [raw ? JSON.stringify(raw).slice(0, 20000) : null, reference]);
  if (!claimed.rowCount) return { alreadyProcessed: true, payment };
  try {
    if (payment.kind === "payg") {
      const pack = await getPack(payment.credit_pack);
      if (!pack) throw new Error(`Unknown minute pack ${payment.credit_pack}.`);
      await grantMinutes(payment.billing_id, pack.minutes, "pack", { reference, note: `Bought ${pack.minutes} minutes` });
    } else {
      await activateSubscription(payment.billing_id, payment.plan_code, { provider: payment.provider, providerRef, customer, periodEnd, cycle: payment.billing_cycle || "monthly" });
    }
  } catch (error) {
    // Put the payment back so the callback page or the next webhook can try again.
    await query("UPDATE payments SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE reference = $2", [payment.status === "success" ? "pending" : payment.status, reference]);
    throw error;
  }
  logger.info({ reference, kind: payment.kind, billingId: payment.billing_id }, "Payment fulfilled");
  await rewardReferralIfDue(payment.user_id, payment).catch((error) => logger.warn({ err: error }, "Referral reward failed"));
  return { alreadyProcessed: false, payment };
}

/** An admin accepts a held (short) payment, for example one that had a discount, and activates it. */
export async function approvePayment(reference) {
  const payment = await one("SELECT * FROM payments WHERE reference = $1", [reference]);
  if (!payment) throw new Error("Payment not found.");
  if (payment.status !== "underpaid") throw new Error("Only payments held for a short amount can be approved.");
  await fulfill(reference, { approved: true, raw: { approved_by_admin: true } });
  return { reference, status: "success" };
}

/**
 * Starts or renews a plan. Paying again for the same plan before it ends adds a full period on top of the days
 * that are left (nothing the customer paid for is lost); switching plans starts a fresh period from today.
 */
export async function activateSubscription(billingId, planCode, { provider = "manual", providerRef = null, customer = null, periodEnd = null, cycle = "monthly" } = {}) {
  const plan = await getPlan(planCode);
  const billingCycle = cycle === "yearly" ? "yearly" : "monthly";
  let end = periodEnd;
  if (!end) {
    const existing = await one("SELECT tier, status, current_period_end, billing_cycle FROM subscriptions WHERE user_id = $1", [billingId]);
    const currentEnd = existing?.current_period_end ? new Date(existing.current_period_end) : null;
    // "No expiry" grants (year 2999) are never extended.
    const paidUp = Boolean(existing && !["canceled", "inactive"].includes(existing.status) && currentEnd && currentEnd > new Date() && currentEnd.getTime() - Date.now() < 800 * 86400000);
    const sameTerms = paidUp && existing.tier === plan.code && (existing.billing_cycle || "monthly") === billingCycle;
    end = sameTerms ? periodAfter(billingCycle, currentEnd) : periodAfter(billingCycle);
  }
  await query(
    `INSERT INTO subscriptions (user_id, tier, status, provider, provider_ref, provider_customer, current_period_end, cancel_at_period_end, max_video_minutes, billing_cycle, updated_at)
     VALUES ($1, $2, 'active', $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)
     ON CONFLICT (user_id) DO UPDATE SET tier = $2, status = 'active', provider = $3, provider_ref = COALESCE($4, subscriptions.provider_ref),
       provider_customer = COALESCE($5, subscriptions.provider_customer), current_period_end = $6, cancel_at_period_end = $7,
       max_video_minutes = $8, billing_cycle = $9, updated_at = CURRENT_TIMESTAMP`,
    [billingId, plan.code, provider, providerRef, customer, end.toISOString(), false, plan.max_video_minutes, billingCycle],
  );
}

/** Confirms a payment when the creator lands back on the callback page (webhooks may arrive later). */
export async function verifyPayment(provider, { reference, sessionId }) {
  if (provider === "paystack") {
    const data = await paystack(`/transaction/verify/${encodeURIComponent(reference)}`);
    if (data.status !== "success") return { status: data.status || "pending" };
    const result = await fulfill(reference, { customer: data.customer?.customer_code, raw: { id: data.id, plan: data.plan }, paid: { amount: data.amount, currency: data.currency } });
    return { status: result.underpaid ? "underpaid" : "success" };
  }
  const session = await stripe(`/checkout/sessions/${encodeURIComponent(sessionId)}`);
  if (session.payment_status !== "paid" && session.status !== "complete") return { status: "pending" };
  let periodEnd = null;
  if (session.subscription) {
    const subscription = await stripe(`/subscriptions/${encodeURIComponent(session.subscription)}`);
    const end = subscription.current_period_end || subscription.items?.data?.[0]?.current_period_end;
    if (end) periodEnd = new Date(end * 1000);
  }
  const result = await fulfill(session.metadata?.reference || reference, {
    providerRef: session.subscription || null, customer: session.customer || null, periodEnd, raw: { session_id: session.id },
    paid: { amount: session.amount_total, currency: session.currency },
  });
  return { status: result.underpaid ? "underpaid" : "success" };
}

function safeEqual(first, second) {
  const a = Buffer.from(String(first));
  const b = Buffer.from(String(second));
  return a.length === b.length && timingSafeEqual(a, b);
}

export function verifyPaystackSignature(rawBody, signature) {
  if (!config.paystackSecretKey || !signature) return false;
  return safeEqual(createHmac("sha512", config.paystackSecretKey).update(rawBody).digest("hex"), signature);
}

export function verifyStripeSignature(rawBody, header, toleranceSeconds = 300) {
  if (!config.stripeWebhookSecret || !header) return false;
  const parts = Object.fromEntries(String(header).split(",").map((part) => part.split("=")).filter((pair) => pair.length === 2).map(([k, v]) => [k.trim(), v]));
  const signatures = String(header).split(",").filter((part) => part.trim().startsWith("v1=")).map((part) => part.trim().slice(3));
  if (!parts.t || !signatures.length || Math.abs(Date.now() / 1000 - Number(parts.t)) > toleranceSeconds) return false;
  const expected = createHmac("sha256", config.stripeWebhookSecret).update(`${parts.t}.${rawBody}`).digest("hex");
  return signatures.some((signature) => safeEqual(expected, signature));
}

async function subscriptionByProvider(field, value) {
  if (!value) return null;
  return one(`SELECT * FROM subscriptions WHERE ${field === "customer" ? "provider_customer" : "provider_ref"} = $1`, [value]);
}

/** What one renewal of this subscription should cost, in the provider's currency and smallest unit. */
async function expectedRenewal(subscription, currency) {
  const plan = await getPlan(subscription.tier);
  if (plan.code !== subscription.tier) return { amount: 0, currency };
  const yearly = subscription.billing_cycle === "yearly";
  const major = currency.toUpperCase() === "NGN" ? (yearly ? plan.price_ngn_yearly : plan.price_ngn) : (yearly ? plan.price_usd_yearly : plan.price_usd);
  return { amount: Math.round(major * 100), currency };
}

/**
 * Handles one renewal charge. Providers deliver webhooks more than once, so the payment is recorded first and
 * the paid period is only extended by whoever recorded it: a repeat delivery changes nothing. A renewal that
 * collected less than the plan costs doesn't extend the plan and alerts the admins instead.
 */
async function applyRenewal(subscription, { provider, reference, paid, extend }) {
  const expected = await expectedRenewal(subscription, paid.currency || "NGN");
  const underpaid = !coversPrice(expected, paid);
  try {
    await recordPayment({
      userId: subscription.user_id, billingId: subscription.user_id, provider, reference, kind: "renewal", planCode: subscription.tier,
      amount: Number(paid.amount || 0), currency: String(paid.currency || "NGN").toUpperCase(), cycle: subscription.billing_cycle || "monthly",
    });
  } catch (error) {
    if (isDuplicate(error)) return { duplicate: true };
    throw error;
  }
  if (underpaid) {
    await query("UPDATE payments SET status = 'underpaid', updated_at = CURRENT_TIMESTAMP WHERE reference = $1", [reference]);
    await flagUnderpayment({ reference, amount: expected.amount, currency: expected.currency.toUpperCase() }, paid, `A ${subscription.tier} renewal collected less than the plan price.`);
    return { underpaid: true };
  }
  try {
    await extend();
    await query("UPDATE payments SET status = 'success', updated_at = CURRENT_TIMESTAMP WHERE reference = $1", [reference]);
  } catch (error) {
    // Forget the attempt so the provider's next delivery can try again.
    await query("DELETE FROM payments WHERE reference = $1", [reference]).catch(() => undefined);
    throw error;
  }
  return { extended: true };
}

export async function handlePaystackEvent(event) {
  const data = event.data || {};
  if (event.event === "charge.success") {
    const reference = data.reference;
    const payment = reference ? await one("SELECT * FROM payments WHERE reference = $1", [reference]) : null;
    if (payment) {
      await fulfill(reference, { customer: data.customer?.customer_code, raw: { id: data.id }, paid: { amount: data.amount, currency: data.currency } });
    } else if (data.plan?.plan_code) {
      // A renewal charge from an existing Paystack subscription: extend the paid period.
      const subscription = await subscriptionByProvider("customer", data.customer?.customer_code);
      if (subscription) {
        await applyRenewal(subscription, {
          provider: "paystack", reference: `renewal_${data.reference || data.id}`, paid: { amount: data.amount, currency: data.currency || "NGN" },
          extend: () => query("UPDATE subscriptions SET status = 'active', current_period_end = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2", [renewalEnd(subscription).toISOString(), subscription.id]),
        });
      }
    }
  } else if (event.event === "subscription.create") {
    const subscription = await subscriptionByProvider("customer", data.customer?.customer_code);
    if (subscription) {
      await query("UPDATE subscriptions SET provider_ref = $1, current_period_end = COALESCE($2, current_period_end), updated_at = CURRENT_TIMESTAMP WHERE id = $3",
        [data.subscription_code, data.next_payment_date || null, subscription.id]);
    }
  } else if (event.event === "subscription.not_renew" || event.event === "subscription.disable") {
    const subscription = await subscriptionByProvider("ref", data.subscription_code) || await subscriptionByProvider("customer", data.customer?.customer_code);
    if (subscription) {
      await query("UPDATE subscriptions SET cancel_at_period_end = $1, status = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3",
        [true, event.event === "subscription.disable" && data.status === "complete" ? "canceled" : "active", subscription.id]);
    }
  }
}

export async function handleStripeEvent(event) {
  const object = event.data?.object || {};
  if (event.type === "checkout.session.completed") {
    const reference = object.metadata?.reference;
    if (reference && (object.payment_status === "paid" || object.status === "complete")) {
      await verifyPayment("stripe", { reference, sessionId: object.id });
    }
  } else if (event.type === "invoice.paid" && object.subscription) {
    const subscription = await subscriptionByProvider("ref", object.subscription);
    const end = object.lines?.data?.[0]?.period?.end;
    if (subscription && end) {
      const extend = () => query("UPDATE subscriptions SET status = 'active', current_period_end = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2", [new Date(end * 1000).toISOString(), subscription.id]);
      if (object.billing_reason === "subscription_cycle") {
        await applyRenewal(subscription, { provider: "stripe", reference: `renewal_${object.id}`, paid: { amount: object.amount_paid, currency: object.currency || "usd" }, extend });
      } else {
        // The first invoice was already checked when the checkout was paid.
        await extend();
      }
    }
  } else if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
    const subscription = await subscriptionByProvider("ref", object.id);
    if (subscription) {
      await query("UPDATE subscriptions SET cancel_at_period_end = $1, status = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3",
        [Boolean(object.cancel_at_period_end), event.type === "customer.subscription.deleted" ? "canceled" : "active", subscription.id]);
    }
  }
}

/** Stops renewal; the plan stays active until the end of the paid period. */
export async function cancelSubscription(billingId) {
  const subscription = await one("SELECT * FROM subscriptions WHERE user_id = $1", [billingId]);
  if (!subscription || subscription.tier === "free") throw new Error("There's no paid subscription to cancel.");
  if (subscription.provider === "stripe" && subscription.provider_ref) {
    await stripe(`/subscriptions/${encodeURIComponent(subscription.provider_ref)}`, { method: "POST", body: { cancel_at_period_end: true } });
  } else if (subscription.provider === "paystack" && subscription.provider_ref) {
    const details = await paystack(`/subscription/${encodeURIComponent(subscription.provider_ref)}`);
    await paystack("/subscription/disable", { method: "POST", body: { code: subscription.provider_ref, token: details.email_token } });
  }
  await query("UPDATE subscriptions SET cancel_at_period_end = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2", [true, subscription.id]);
}

/**
 * Stops Paystack or Stripe from billing an account, for when an admin takes the account over (moves it to another
 * plan, or removes its plan). Throws if the provider refuses, so nobody is left paying for a plan they no longer have.
 */
export async function releaseProviderSubscription(billingId) {
  const subscription = await one("SELECT * FROM subscriptions WHERE user_id = $1", [billingId]);
  const live = subscription && ["paystack", "stripe"].includes(subscription.provider) && subscription.provider_ref
    && subscription.tier !== "free" && subscription.status !== "canceled" && !toBool(subscription.cancel_at_period_end);
  if (!live) return false;
  await cancelSubscription(billingId);
  return true;
}

export async function paymentHistory(billingId) {
  return (await many("SELECT reference, provider, kind, plan_code, credit_pack, amount, currency, status, created_at FROM payments WHERE billing_id = $1 ORDER BY created_at DESC LIMIT 50", [billingId]))
    .map((row) => ({ ...row, amount: Number(row.amount), created_at: toIso(row.created_at) }));
}
