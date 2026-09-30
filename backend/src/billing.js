import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { grantCredit } from "./accounts.js";
import { config } from "./config.js";
import { many, one, query } from "./db.js";
import { logger } from "./logger.js";
import { getCreditPack, getPlan } from "./plans.js";

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

function addMonth(date = new Date()) {
  const next = new Date(date);
  next.setUTCMonth(next.getUTCMonth() + 1);
  return next;
}

async function recordPayment({ userId, billingId, provider, reference, kind, planCode = null, pack = null, amount, currency }) {
  await query(
    `INSERT INTO payments (user_id, billing_id, provider, reference, kind, plan_code, credit_pack, amount, currency, status, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', CURRENT_TIMESTAMP)`,
    [userId, billingId, provider, reference, kind, planCode, pack, amount, currency],
  );
}

/** Starts a checkout for a plan subscription or a pay-as-you-go pack and returns the hosted payment page URL. */
export async function createCheckout({ provider, user, billingId, planCode = null, packCode = null }) {
  const providers = billingProviders();
  if (!providers[provider]) throw new Error(`${provider === "stripe" ? "Stripe" : "Paystack"} payments aren't configured on this server.`);
  const pack = packCode ? getCreditPack(packCode) : null;
  const plan = planCode ? await getPlan(planCode) : null;
  if (!pack && (!plan || plan.code !== planCode || plan.price_usd <= 0)) throw new Error("Choose a paid plan or a pay-as-you-go pack.");
  const kind = pack ? "payg" : "subscription";
  const reference = `rl_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  const callback = `${config.frontendUrl}/billing/callback?provider=${provider}`;
  const metadata = { billing_id: billingId, user_id: user.id, kind, plan_code: plan?.code || "", pack: pack?.code || "", reference };

  if (provider === "paystack") {
    const amount = (pack ? pack.price_ngn : plan.price_ngn) * 100;
    const planCodeOnPaystack = !pack ? config.paystackPlanCodes[plan.code] : "";
    await recordPayment({ userId: user.id, billingId, provider, reference, kind, planCode: plan?.code, pack: pack?.code, amount, currency: "NGN" });
    const data = await paystack("/transaction/initialize", {
      method: "POST",
      body: {
        email: user.email, amount, currency: "NGN", reference, callback_url: `${callback}&reference=${reference}`, metadata,
        ...(planCodeOnPaystack ? { plan: planCodeOnPaystack } : {}),
      },
    });
    return { url: data.authorization_url, reference };
  }

  const amount = Math.round((pack ? pack.price_usd : plan.price_usd) * 100);
  await recordPayment({ userId: user.id, billingId, provider, reference, kind, planCode: plan?.code, pack: pack?.code, amount, currency: "USD" });
  const priceId = !pack ? config.stripePriceIds[plan.code] : "";
  const lineItem = priceId
    ? { price: priceId, quantity: 1 }
    : {
      quantity: 1,
      price_data: {
        currency: "usd",
        unit_amount: amount,
        product_data: { name: pack ? `ReelLingo ${pack.minutes}-minute video credit` : `ReelLingo ${plan.name} plan` },
        ...(pack ? {} : { recurring: { interval: "month" } }),
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

/** Activates a plan or grants a credit for a successful payment. Safe to call repeatedly (callback + webhook). */
async function fulfill(reference, { providerRef = null, customer = null, periodEnd = null, raw = null } = {}) {
  const payment = await one("SELECT * FROM payments WHERE reference = $1", [reference]);
  if (!payment) throw new Error("Unknown payment reference.");
  const claimed = await query("UPDATE payments SET status = 'success', raw_json = COALESCE($1, raw_json), updated_at = CURRENT_TIMESTAMP WHERE reference = $2 AND status <> 'success'", [raw ? JSON.stringify(raw).slice(0, 20000) : null, reference]);
  if (!claimed.rowCount) return { alreadyProcessed: true, payment };
  if (payment.kind === "payg") {
    const pack = getCreditPack(payment.credit_pack);
    await grantCredit(payment.billing_id, pack.minutes, "payg", reference);
  } else {
    await activateSubscription(payment.billing_id, payment.plan_code, { provider: payment.provider, providerRef, customer, periodEnd });
  }
  logger.info({ reference, kind: payment.kind, billingId: payment.billing_id }, "Payment fulfilled");
  return { alreadyProcessed: false, payment };
}

export async function activateSubscription(billingId, planCode, { provider = "manual", providerRef = null, customer = null, periodEnd = null } = {}) {
  const plan = await getPlan(planCode);
  const end = (periodEnd || addMonth()).toISOString();
  await query(
    `INSERT INTO subscriptions (user_id, tier, status, provider, provider_ref, provider_customer, current_period_end, cancel_at_period_end, max_videos_per_month, max_video_minutes, updated_at)
     VALUES ($1, $2, 'active', $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)
     ON CONFLICT (user_id) DO UPDATE SET tier = $2, status = 'active', provider = $3, provider_ref = COALESCE($4, subscriptions.provider_ref),
       provider_customer = COALESCE($5, subscriptions.provider_customer), current_period_end = $6, cancel_at_period_end = $7,
       max_videos_per_month = $8, max_video_minutes = $9, updated_at = CURRENT_TIMESTAMP`,
    [billingId, plan.code, provider, providerRef, customer, end, false, plan.videos_per_month, plan.max_video_minutes],
  );
}

/** Confirms a payment when the creator lands back on the callback page (webhooks may arrive later). */
export async function verifyPayment(provider, { reference, sessionId }) {
  if (provider === "paystack") {
    const data = await paystack(`/transaction/verify/${encodeURIComponent(reference)}`);
    if (data.status !== "success") return { status: data.status || "pending" };
    await fulfill(reference, { customer: data.customer?.customer_code, raw: { id: data.id, plan: data.plan } });
    return { status: "success" };
  }
  const session = await stripe(`/checkout/sessions/${encodeURIComponent(sessionId)}`);
  if (session.payment_status !== "paid" && session.status !== "complete") return { status: "pending" };
  let periodEnd = null;
  if (session.subscription) {
    const subscription = await stripe(`/subscriptions/${encodeURIComponent(session.subscription)}`);
    const end = subscription.current_period_end || subscription.items?.data?.[0]?.current_period_end;
    if (end) periodEnd = new Date(end * 1000);
  }
  await fulfill(session.metadata?.reference || reference, { providerRef: session.subscription || null, customer: session.customer || null, periodEnd, raw: { session_id: session.id } });
  return { status: "success" };
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

export async function handlePaystackEvent(event) {
  const data = event.data || {};
  if (event.event === "charge.success") {
    const reference = data.reference;
    const payment = reference ? await one("SELECT * FROM payments WHERE reference = $1", [reference]) : null;
    if (payment) {
      await fulfill(reference, { customer: data.customer?.customer_code, raw: { id: data.id } });
    } else if (data.plan?.plan_code) {
      // A renewal charge from an existing Paystack subscription: extend the paid period.
      const subscription = await subscriptionByProvider("customer", data.customer?.customer_code);
      if (subscription) {
        await query("UPDATE subscriptions SET status = 'active', current_period_end = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2", [addMonth().toISOString(), subscription.id]);
        await recordPayment({ userId: subscription.user_id, billingId: subscription.user_id, provider: "paystack", reference: `renewal_${data.reference || data.id}`, kind: "renewal", planCode: subscription.tier, amount: Number(data.amount || 0), currency: data.currency || "NGN" }).catch(() => undefined);
        await query("UPDATE payments SET status = 'success' WHERE reference = $1", [`renewal_${data.reference || data.id}`]);
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
      await query("UPDATE subscriptions SET status = 'active', current_period_end = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2", [new Date(end * 1000).toISOString(), subscription.id]);
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

export async function paymentHistory(billingId) {
  return (await many("SELECT reference, provider, kind, plan_code, credit_pack, amount, currency, status, created_at FROM payments WHERE billing_id = $1 ORDER BY created_at DESC LIMIT 50", [billingId]))
    .map((row) => ({ ...row, amount: Number(row.amount), created_at: toIso(row.created_at) }));
}
