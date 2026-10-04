"use client";

import { useEffect, useState } from "react";
import { CircleAlert, CircleCheck, Clock3, CreditCard, LoaderCircle, Receipt } from "lucide-react";
import AppShell from "@/components/AppShell";
import { cancelPlan, getBilling, getMinutesHistory, startCheckout } from "@/lib/api";
import { formatMinutes, formatMoney } from "@/lib/format";
import type { BillingInfo, MinuteLedgerEntry } from "@/lib/types";

type Provider = "paystack" | "stripe";
type Cycle = "monthly" | "yearly";

const LEDGER_LABELS: Record<string, string> = {
  job: "Project", redub: "Re-dub", clips: "Short clips", refund: "Refund (didn't finish)", deleted: "Refund (deleted)", review_refund: "Refund (no reviewer in time)",
  pack: "Bought minutes", referral: "Referral reward", admin_grant: "Added by ReelLingo", admin_remove: "Removed by ReelLingo", legacy_credit: "Old credit converted",
};

export default function BillingPage() {
  const [billing, setBilling] = useState<BillingInfo | null>(null);
  const [history, setHistory] = useState<MinuteLedgerEntry[]>([]);
  const [provider, setProvider] = useState<Provider>("paystack");
  const [cycle, setCycle] = useState<Cycle>("monthly");
  const [autoRenew, setAutoRenew] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  useEffect(() => {
    getBilling().then((info) => {
      setBilling(info);
      if (!info.providers.paystack && info.providers.stripe) setProvider("stripe");
    }).catch((error: unknown) => setMessage({ tone: "error", text: error instanceof Error ? error.message : "Could not load billing." }));
    getMinutesHistory().then((result) => setHistory(result.history)).catch(() => undefined);
    if (new URLSearchParams(window.location.search).get("canceled")) setMessage({ tone: "error", text: "Checkout was cancelled. You haven't been charged." });
  }, []);

  async function checkout(choice: { plan?: string; pack?: string }) {
    setBusy(choice.plan || choice.pack || "");
    setMessage(null);
    try {
      const planChoice = choice.plan ? { ...choice, cycle, ...(provider === "paystack" ? { auto_renew: autoRenew } : {}) } : choice;
      const { url } = await startCheckout(provider, planChoice);
      window.location.href = url;
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Checkout failed." });
      setBusy(null);
    }
  }

  async function cancel() {
    if (!window.confirm("Stop renewing your plan? You keep it until the end of the current billing period.")) return;
    setBusy("cancel");
    try {
      await cancelPlan();
      setBilling(await getBilling());
      setMessage({ tone: "success", text: "Your plan won't renew. You keep your features until the end of the period." });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Could not cancel." });
    } finally {
      setBusy(null);
    }
  }

  const payable = billing && (billing.providers.paystack || billing.providers.stripe);
  const canManage = !billing?.workspace || ["owner", "admin"].includes(billing.workspace.role);
  const money = (usd: number, ngn: number) => (provider === "paystack" ? formatMoney(ngn, "NGN") : formatMoney(usd, "USD"));
  const yearlyOffered = Boolean(billing?.yearly && billing.plans.some((plan) => plan.price_usd_yearly > 0));
  // Plans with a Paystack plan code renew automatically by card; without one, every payment covers one period.
  const autoRenewAvailable = provider === "paystack" && Boolean(billing?.paystack_auto_renew_plans?.some((key) => (cycle === "yearly" ? key.endsWith("_yearly") : !key.endsWith("_yearly"))));
  const minutes = billing?.minutes;
  const usedShare = minutes && minutes.plan_allowance ? Math.min(100, Math.round((minutes.plan_used / minutes.plan_allowance) * 100)) : 0;

  return (
    <AppShell crumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Billing" }]}>
      <div className="page-head">
        <div>
          <h1>Plans &amp; billing</h1>
          <p>{billing?.workspace ? "Billing for this team workspace — minutes are shared by every member." : "Choose a plan, buy extra minutes and see your payment history."}</p>
        </div>
        {payable && (
          <div className="segmented" role="group" aria-label="Payment currency">
            {billing.providers.paystack && <button type="button" aria-pressed={provider === "paystack"} className={provider === "paystack" ? "is-on" : ""} onClick={() => setProvider("paystack")}>₦ Naira · Paystack</button>}
            {billing.providers.stripe && <button type="button" aria-pressed={provider === "stripe"} className={provider === "stripe" ? "is-on" : ""} onClick={() => setProvider("stripe")}>$ USD · Card</button>}
          </div>
        )}
      </div>

      {message && <div role={message.tone === "error" ? "alert" : "status"} className={`alert ${message.tone === "error" ? "alert-error" : "alert-success"}`} style={{ marginBottom: 20 }}>{message.tone === "error" ? <CircleAlert size={16} /> : <CircleCheck size={16} />}<span>{message.text}</span></div>}
      {billing && !payable && <div className="alert alert-warn" style={{ marginBottom: 20 }}><CircleAlert size={16} /><span><strong>Payments aren&apos;t configured.</strong> Add PAYSTACK_SECRET_KEY and/or STRIPE_SECRET_KEY to backend/.env.</span></div>}
      {!canManage && <div className="alert alert-info" style={{ marginBottom: 20 }}><CircleAlert size={16} /><span>Only team owners and admins can change the team&apos;s plan.</span></div>}

      {!billing || !minutes ? (
        <div className="skeleton" style={{ height: 320 }} />
      ) : (
        <>
          <section className="card card-pad current-plan">
            <div>
              <span className="eyebrow">CURRENT PLAN</span>
              <h2>{billing.plan.name}{billing.subscription?.billing_cycle === "yearly" && billing.tier !== "free" ? " · yearly" : ""}</h2>
              <p className="card-sub">
                Videos up to {billing.plan.max_video_minutes} min · {billing.plan.max_targets} language{billing.plan.max_targets === 1 ? "" : "s"} per upload
                {billing.subscription?.current_period_end && billing.tier !== "free" && ` · ${billing.subscription.cancel_at_period_end ? "ends" : "renews"} ${new Date(billing.subscription.current_period_end).toLocaleDateString()}`}
              </p>
              <div className="minutes-meter" aria-label={`${minutes.plan_used} of ${minutes.plan_allowance} plan minutes used`}>
                <div className="minutes-meter-head">
                  <strong>{formatMinutes(minutes.available)} left</strong>
                  <span>{formatMinutes(minutes.plan_left)} of {formatMinutes(minutes.plan_allowance)} this month{minutes.topup_left > 0 ? ` + ${formatMinutes(minutes.topup_left)} extra (never expire)` : ""}</span>
                </div>
                <div className="progress-track"><i style={{ width: `${usedShare}%` }} /></div>
                <small><Clock3 size={13} /> Plan minutes renew {new Date(minutes.resets_at).toLocaleDateString(undefined, { day: "numeric", month: "long" })}. 1 minute = 1 minute of video dubbed into 1 language; subtitles only use {Math.round(billing.weights.subtitles * 100)}%.</small>
              </div>
            </div>
            <div className="current-plan-side">
              {billing.tier !== "free" && !billing.subscription?.cancel_at_period_end && canManage && (
                <button type="button" className="btn btn-outline btn-sm" onClick={cancel} disabled={busy === "cancel"}>Cancel renewal</button>
              )}
            </div>
          </section>

          <div className="pay-method">
            {yearlyOffered && (
              <div className="segmented" role="group" aria-label="Billing period">
                <button type="button" aria-pressed={cycle === "monthly"} className={cycle === "monthly" ? "is-on" : ""} onClick={() => setCycle("monthly")}>Monthly</button>
                <button type="button" aria-pressed={cycle === "yearly"} className={cycle === "yearly" ? "is-on" : ""} onClick={() => setCycle("yearly")}>Yearly · 2 months free</button>
              </div>
            )}
            {autoRenewAvailable && (
              <div className="segmented" role="group" aria-label="How to pay for a plan">
                <button type="button" aria-pressed={autoRenew} className={autoRenew ? "is-on" : ""} onClick={() => setAutoRenew(true)}>Card · renews automatically</button>
                <button type="button" aria-pressed={!autoRenew} className={!autoRenew ? "is-on" : ""} onClick={() => setAutoRenew(false)}>Transfer, USSD or card · pay once</button>
              </div>
            )}
          </div>

          <div className="pricing-grid app-pricing">
            {billing.plans.map((plan) => {
              const current = plan.code === billing.tier;
              const yearly = cycle === "yearly" && plan.price_usd_yearly > 0;
              const usd = yearly ? plan.price_usd_yearly : plan.price_usd;
              const ngn = yearly ? plan.price_ngn_yearly : plan.price_ngn;
              return (
                <article key={plan.code} className={`plan ${plan.featured ? "is-featured" : ""}`}>
                  {plan.featured && <span className="plan-flag">MOST POPULAR</span>}
                  <h3>{plan.name}</h3>
                  <p>{plan.blurb}</p>
                  <div className="plan-price">
                    {plan.contact_sales ? "Custom" : plan.price_usd ? money(usd, ngn) : "Free"}
                    {plan.price_usd && !plan.contact_sales ? <small>/{yearly ? "year" : "month"}</small> : null}
                  </div>
                  {yearly && <p className="plan-saving">{money(plan.price_usd_yearly / 12, Math.round(plan.price_ngn_yearly / 12))}/month, billed yearly</p>}
                  <ul className="check-list">{plan.features.map((feature) => <li key={feature}><CircleCheck size={18} />{feature}</li>)}</ul>
                  {current ? (
                    <button type="button" className="btn btn-outline btn-block" disabled>Current plan</button>
                  ) : plan.contact_sales ? (
                    <a className="btn btn-outline btn-block" href={`mailto:${process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "support@reellingo.ai"}?subject=${encodeURIComponent(`${plan.name} plan`)}`}>Contact sales</a>
                  ) : plan.price_usd ? (
                    <button type="button" className={`btn btn-block ${plan.featured ? "btn-primary" : "btn-outline"}`} disabled={!payable || !canManage || Boolean(busy) || (cycle === "yearly" && !plan.price_usd_yearly)} onClick={() => checkout({ plan: plan.code })}>
                      {busy === plan.code ? <LoaderCircle size={16} className="spin" /> : <CreditCard size={16} />}{plan.name.length > 14 ? "Choose plan" : `Choose ${plan.name}`}
                    </button>
                  ) : <span className="plan-note">Your plan when nothing else is active</span>}
                </article>
              );
            })}
          </div>

          {billing.packs.length > 0 && <section className="section-block" id="payg">
            <h2>Extra minutes</h2>
            <p className="card-sub">Need more this month, or not ready for a plan? Extra minutes never expire and are used after your plan&apos;s monthly minutes. They work for dubbing, subtitles, lip-sync, human review and short clips.</p>
            <div className="pack-grid">
              {billing.packs.map((pack) => (
                <article key={pack.code} className="card pack">
                  <strong>{formatMinutes(pack.minutes)}</strong>
                  <span className="pack-price">{money(pack.price_usd, pack.price_ngn)}</span>
                  <small className="pack-unit">{money(pack.price_usd / pack.minutes, Math.round(pack.price_ngn / pack.minutes))} per minute</small>
                  <button type="button" className="btn btn-outline btn-sm btn-block" disabled={!payable || !canManage || Boolean(busy)} onClick={() => checkout({ pack: pack.code })}>
                    {busy === pack.code ? <LoaderCircle size={14} className="spin" /> : null}Buy minutes
                  </button>
                </article>
              ))}
            </div>
          </section>}

          {history.length > 0 && (
            <section className="section-block">
              <h2><Clock3 size={20} style={{ display: "inline", verticalAlign: "-3px" }} /> Minutes history</h2>
              <div className="table-wrap">
                <table className="data-table">
                  <thead><tr><th>Date</th><th>What</th><th>Minutes</th><th>From</th></tr></thead>
                  <tbody>
                    {history.slice(0, 50).map((entry) => (
                      <tr key={entry.id}>
                        <td>{new Date(entry.created_at.includes("T") ? entry.created_at : `${entry.created_at.replace(" ", "T")}Z`).toLocaleDateString()}</td>
                        <td>{LEDGER_LABELS[entry.kind] || entry.kind}{entry.job_id ? ` #${entry.job_id}` : ""}{entry.note ? ` · ${entry.note}` : ""}</td>
                        <td className={entry.delta < 0 ? "delta-out" : "delta-in"}>{entry.delta > 0 ? "+" : ""}{formatMinutes(entry.delta)}</td>
                        <td>{entry.bucket === "plan" ? "Plan" : "Extra"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section className="section-block">
            <h2><Receipt size={20} style={{ display: "inline", verticalAlign: "-3px" }} /> Payment history</h2>
            {billing.payments.length ? (
              <div className="table-wrap">
                <table className="data-table">
                  <thead><tr><th>Date</th><th>Item</th><th>Amount</th><th>Method</th><th>Status</th></tr></thead>
                  <tbody>
                    {billing.payments.map((payment) => (
                      <tr key={payment.reference}>
                        <td>{new Date(payment.created_at).toLocaleDateString()}</td>
                        <td>{payment.kind === "payg" ? `Extra minutes (${payment.credit_pack?.replace(/^(payg|min)_/, "")} min)` : payment.kind === "renewal" ? `${payment.plan_code} renewal` : `${payment.plan_code} plan${payment.billing_cycle === "yearly" ? " (yearly)" : ""}`}</td>
                        <td>{formatMoney(payment.amount / 100, payment.currency)}</td>
                        <td style={{ textTransform: "capitalize" }}>{payment.provider}</td>
                        <td><span className={`badge ${payment.status === "success" ? "badge-done" : payment.status === "pending" ? "badge-processing" : "badge-failed"}`}>{payment.status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="card-sub">No payments yet.</p>}
          </section>
        </>
      )}
    </AppShell>
  );
}
