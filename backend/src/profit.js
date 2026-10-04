import { config } from "./config.js";
import { getPack, getRawPlan, listPacks, listRawPlans } from "./plans.js";

/**
 * Profit check for every plan and minute pack, from the provider prices in Admin → Settings.
 * "Worst case" assumes a customer uses every minute, talks fast, and every paid service is used (voice isolation,
 * Spitch translation + tone marks). "Typical" uses the typical talking speed and usage percentage.
 */

const round = (value, places = 2) => Math.round(Number(value || 0) * 10 ** places) / 10 ** places;

/** Provider cost (US$) of one dubbed minute of video into one language. */
export function costPerMinute() {
  const costs = config.costs;
  const assumptions = config.profitAssumptions;
  const voice = (characters) => Math.max((characters / 1000) * costs.elevenlabsPer1kChars, 60 * costs.spitchSpeechPerSecond);
  const transcription = Math.max(costs.whisperPerMinute, costs.scribePerHour / 60);
  const wordsPerMinute = assumptions.charactersPerMinuteWorst / 6;
  // Spitch translation and Yoruba tone marks are both billed per word.
  const spitchText = 2 * (wordsPerMinute / 10000) * costs.spitchTextPer10kWords;
  // Translation by OpenAI: roughly 2 tokens per word in and out.
  const openaiText = ((wordsPerMinute * 2) / 1e6) * (costs.chatInputPerMillion + costs.chatOutputPerMillion);
  const isolation = ["auto", "elevenlabs"].includes(config.separationProvider) ? costs.elevenlabsIsolationPerMinute : 0;
  const worst = voice(assumptions.charactersPerMinuteWorst) + transcription + Math.max(spitchText, openaiText) + isolation;
  const typical = voice(assumptions.charactersPerMinuteTypical) + transcription + openaiText + (config.separationProvider === "elevenlabs" ? isolation : 0);
  const subtitlesWorst = transcription + Math.max(spitchText, openaiText);
  return {
    dub_worst: round(worst, 4),
    dub_typical: round(typical, 4),
    subtitles_worst: round(subtitlesWorst, 4),
    lip_sync: round(costs.lipsyncPerMinute, 4),
    human_review: round(config.reviewerPayNgnPerMinute / config.ngnPerUsd, 4),
  };
}

export function paystackFee(amountNgn) {
  const { paystackPercent, paystackFlatNgn, paystackCapNgn } = config.profitAssumptions;
  if (!amountNgn) return 0;
  const fee = (amountNgn * paystackPercent) / 100 + (amountNgn >= 2500 ? paystackFlatNgn : 0);
  return Math.round(Math.min(fee, paystackCapNgn));
}

export function stripeFee(amountUsd) {
  const { stripePercent, stripeFlatUsd } = config.profitAssumptions;
  return amountUsd ? round((amountUsd * stripePercent) / 100 + stripeFlatUsd) : 0;
}

/**
 * One row of the profit table: what you earn, what the payment provider keeps, what the minutes could cost you,
 * and what's left. A minute of subtitles costs less than a minute of dubbing, so dubbing is always the worst case.
 */
function evaluate({ revenueNgn, revenueUsd, minutes, cost }) {
  const fx = config.ngnPerUsd;
  const typicalShare = config.profitAssumptions.typicalUsagePercent / 100;
  const worstNgn = minutes * cost.dub_worst * fx;
  const typicalNgn = minutes * typicalShare * cost.dub_typical * fx;
  const worstUsd = minutes * cost.dub_worst;
  const typicalUsd = minutes * typicalShare * cost.dub_typical;
  const ngnFee = paystackFee(revenueNgn);
  const usdFee = stripeFee(revenueUsd);
  const ngn = {
    revenue: revenueNgn, fee: ngnFee,
    worst_cost: Math.round(worstNgn), worst_profit: Math.round(revenueNgn - ngnFee - worstNgn),
    typical_cost: Math.round(typicalNgn), typical_profit: Math.round(revenueNgn - ngnFee - typicalNgn),
    price_per_minute: minutes ? Math.round(revenueNgn / minutes) : null,
  };
  ngn.worst_margin = revenueNgn ? round((ngn.worst_profit / revenueNgn) * 100, 1) : null;
  ngn.typical_margin = revenueNgn ? round((ngn.typical_profit / revenueNgn) * 100, 1) : null;
  const usd = {
    revenue: revenueUsd, fee: usdFee,
    worst_cost: round(worstUsd), worst_profit: round(revenueUsd - usdFee - worstUsd),
    typical_cost: round(typicalUsd), typical_profit: round(revenueUsd - usdFee - typicalUsd),
    price_per_minute: minutes ? round(revenueUsd / minutes) : null,
  };
  usd.worst_margin = revenueUsd ? round((usd.worst_profit / revenueUsd) * 100, 1) : null;
  usd.typical_margin = revenueUsd ? round((usd.typical_profit / revenueUsd) * 100, 1) : null;
  return { ngn, usd };
}

/** Minimum price per minute (₦ and $) that still breaks even when a customer uses everything. */
export function breakEvenPerMinute(cost = costPerMinute()) {
  const { paystackPercent, stripePercent } = config.profitAssumptions;
  return {
    ngn: Math.ceil((cost.dub_worst * config.ngnPerUsd) / (1 - paystackPercent / 100)),
    usd: round(cost.dub_worst / (1 - stripePercent / 100), 3),
  };
}

/** What the inviter's and the new customer's free minutes could cost you, at worst (₦). */
export function referralRewardCostNgn(cost = costPerMinute()) {
  return Math.round((config.referralBonusMinutes + config.referralNewUserMinutes) * cost.dub_worst * config.ngnPerUsd);
}

/**
 * True when this purchase still makes money at worst after paying both referral rewards, so rewards can never
 * turn a sale into a loss. (A ₦4,500 Subtitles plan doesn't qualify; a Starter plan or bigger does.)
 */
export async function referralAffordable(payment) {
  const cost = costPerMinute();
  const amount = Number(payment.amount || 0) / 100;
  const ngn = String(payment.currency).toUpperCase() === "NGN";
  let minutes = 0;
  if (payment.kind === "payg") {
    minutes = (await getPack(payment.credit_pack))?.minutes || 0;
  } else {
    const plan = await getRawPlan(payment.plan_code);
    if (!plan) return false;
    minutes = plan.minutes_per_month * (payment.billing_cycle === "yearly" ? 12 : 1);
  }
  const revenueNgn = ngn ? amount - paystackFee(amount) : (amount - stripeFee(amount)) * config.ngnPerUsd;
  const worstProfitNgn = revenueNgn - minutes * cost.dub_worst * config.ngnPerUsd;
  return worstProfitNgn >= referralRewardCostNgn(cost);
}

export async function profitReport() {
  const cost = costPerMinute();
  const [plans, packs] = await Promise.all([listRawPlans(), listPacks()]);
  const warnings = [];
  const rows = [];
  for (const plan of plans) {
    if (plan.contact_sales) {
      rows.push({ kind: "plan", code: plan.code, name: plan.name, cycle: "custom", minutes: null, note: "Custom pricing: quote at least the break-even price per minute below." });
      continue;
    }
    if (!plan.price_ngn && !plan.price_usd) {
      const worst = plan.minutes_per_month * cost.dub_worst;
      rows.push({
        kind: "plan", code: plan.code, name: plan.name, cycle: "monthly", minutes: plan.minutes_per_month,
        free: { worst_cost_per_user_usd: round(worst), worst_cost_per_user_ngn: Math.round(worst * config.ngnPerUsd), users_covered_by_budget: worst ? Math.floor(config.freeMonthlyBudgetUsd / worst) : null },
        note: `Free users are a marketing cost. Together they can never cost more than $${config.freeMonthlyBudgetUsd} a month (Admin → Settings → Pricing).`,
      });
      continue;
    }
    const monthly = evaluate({ revenueNgn: plan.price_ngn, revenueUsd: plan.price_usd, minutes: plan.minutes_per_month, cost });
    rows.push({ kind: "plan", code: plan.code, name: plan.name, cycle: "monthly", minutes: plan.minutes_per_month, ...monthly });
    if (plan.price_ngn_yearly || plan.price_usd_yearly) {
      const yearly = evaluate({ revenueNgn: plan.price_ngn_yearly, revenueUsd: plan.price_usd_yearly, minutes: plan.minutes_per_month * 12, cost });
      rows.push({ kind: "plan", code: plan.code, name: plan.name, cycle: "yearly", minutes: plan.minutes_per_month * 12, ...yearly });
    }
  }
  for (const pack of packs) {
    rows.push({ kind: "pack", code: pack.code, name: `${pack.minutes}-minute pack`, cycle: "once", minutes: pack.minutes, ...evaluate({ revenueNgn: pack.price_ngn, revenueUsd: pack.price_usd, minutes: pack.minutes, cost }) });
  }
  for (const row of rows) {
    if (row.ngn && row.ngn.revenue && row.ngn.worst_profit < 0) warnings.push(`${row.name} (${row.cycle}, ₦) could lose up to ₦${Math.abs(row.ngn.worst_profit).toLocaleString("en-NG")} if a customer uses every minute.`);
    if (row.usd && row.usd.revenue && row.usd.worst_profit < 0) warnings.push(`${row.name} (${row.cycle}, $) could lose up to $${Math.abs(row.usd.worst_profit)} if a customer uses every minute.`);
  }

  // Add-ons are paid for with minutes. The cheapest minute you sell must still cover each add-on's cost.
  const cheapest = rows.filter((row) => row.ngn?.price_per_minute).reduce((low, row) => Math.min(low, row.ngn.price_per_minute), Infinity);
  const cheapestUsd = rows.filter((row) => row.usd?.price_per_minute).reduce((low, row) => Math.min(low, row.usd.price_per_minute), Infinity);
  const weights = config.minuteWeights;
  const addons = [
    { name: "Lip-sync (per minute of video)", minutes: weights.lipSync, cost_usd: cost.lip_sync },
    { name: "Human review (per minute of video)", minutes: weights.humanReview, cost_usd: cost.human_review },
    { name: "Subtitles only (per minute of video)", minutes: weights.subtitles, cost_usd: cost.subtitles_worst },
  ].map((addon) => {
    const lowestRevenueNgn = Number.isFinite(cheapest) ? addon.minutes * cheapest : null;
    const lowestRevenueUsd = Number.isFinite(cheapestUsd) ? round(addon.minutes * cheapestUsd) : null;
    const worstProfitNgn = lowestRevenueNgn === null ? null : Math.round(lowestRevenueNgn - addon.cost_usd * config.ngnPerUsd);
    if (worstProfitNgn !== null && worstProfitNgn < 0) warnings.push(`${addon.name} uses too few minutes: it can lose ₦${Math.abs(worstProfitNgn).toLocaleString("en-NG")} per minute. Raise its weight in Settings → Pricing.`);
    return { ...addon, lowest_revenue_ngn: lowestRevenueNgn, lowest_revenue_usd: lowestRevenueUsd, worst_profit_ngn: worstProfitNgn, cost_ngn: Math.round(addon.cost_usd * config.ngnPerUsd) };
  });

  // Referral rewards are only paid on a purchase whose worst-case profit covers them (see referralAffordable).
  const rewardCostNgn = referralRewardCostNgn(cost);
  const qualifying = rows.filter((row) => row.ngn?.revenue && row.ngn.worst_profit >= rewardCostNgn);
  const referral = {
    reward_minutes: config.referralBonusMinutes + config.referralNewUserMinutes,
    worst_cost_ngn: rewardCostNgn,
    qualifying: qualifying.map((row) => `${row.name} (${row.cycle})`),
  };
  if (config.featureReferrals && rewardCostNgn > 0 && !qualifying.length) {
    warnings.push(`Referral rewards (${referral.reward_minutes} minutes, up to ₦${rewardCostNgn.toLocaleString("en-NG")}) cost more than any purchase earns at worst, so they'll never be paid. Lower them in Settings → Pricing.`);
  }

  return {
    referral,
    assumptions: {
      ngn_per_usd: config.ngnPerUsd, ...config.profitAssumptions, separation_provider: config.separationProvider,
      elevenlabs_per_1k_chars: config.costs.elevenlabsPer1kChars, free_monthly_budget_usd: config.freeMonthlyBudgetUsd,
    },
    cost_per_minute: cost,
    break_even_per_minute: breakEvenPerMinute(cost),
    rows,
    addons,
    warnings,
  };
}
