"use client";

import { useEffect, useState } from "react";
import { CircleAlert, CircleCheck, CreditCard, LoaderCircle, Receipt, Ticket } from "lucide-react";
import AppShell from "@/components/AppShell";
import { cancelPlan, getBilling, startCheckout } from "@/lib/api";
import { formatMoney } from "@/lib/format";
import type { BillingInfo } from "@/lib/types";

type Provider = "paystack" | "stripe";

export default function BillingPage() {
  const [billing, setBilling] = useState<BillingInfo | null>(null);
  const [provider, setProvider] = useState<Provider>("paystack");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  useEffect(() => {
    getBilling().then((info) => {
      setBilling(info);
      if (!info.providers.paystack && info.providers.stripe) setProvider("stripe");
    }).catch((error: unknown) => setMessage({ tone: "error", text: error instanceof Error ? error.message : "Could not load billing." }));
    if (new URLSearchParams(window.location.search).get("canceled")) setMessage({ tone: "error", text: "Checkout was cancelled. You haven't been charged." });
  }, []);

  async function checkout(choice: { plan?: string; pack?: string }) {
    setBusy(choice.plan || choice.pack || "");
    setMessage(null);
    try {
      const { url } = await startCheckout(provider, choice);
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
  const price = (usd: number, ngn: number) => (provider === "paystack" ? formatMoney(ngn, "NGN") : formatMoney(usd, "USD"));

  return (
    <AppShell crumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Billing" }]}>
      <div className="page-head">
        <div>
          <h1>Plans &amp; billing</h1>
          <p>{billing?.workspace ? "Billing for this team workspace — usage and credits are shared by every member." : "Choose a plan, buy one-off credits and see your payment history."}</p>
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

      {!billing ? (
        <div className="skeleton" style={{ height: 320 }} />
      ) : (
        <>
          <section className="card card-pad current-plan">
            <div>
              <span className="eyebrow">CURRENT PLAN</span>
              <h2>{billing.plan.name}</h2>
              <p className="card-sub">
                {billing.usage.videos_this_month} of {billing.usage.max_videos_per_month} videos used this month · up to {billing.plan.max_video_minutes} min each
                {billing.subscription?.current_period_end && billing.tier !== "free" && ` · ${billing.subscription.cancel_at_period_end ? "ends" : "renews"} ${new Date(billing.subscription.current_period_end).toLocaleDateString()}`}
              </p>
            </div>
            <div className="current-plan-side">
              {billing.credits.length > 0 && <span className="credit-count"><Ticket size={16} />{billing.credits.length} credit{billing.credits.length === 1 ? "" : "s"}: {billing.credits.map((credit) => `${credit.max_minutes} min`).join(", ")}</span>}
              {billing.tier !== "free" && !billing.subscription?.cancel_at_period_end && canManage && (
                <button type="button" className="btn btn-outline btn-sm" onClick={cancel} disabled={busy === "cancel"}>Cancel renewal</button>
              )}
            </div>
          </section>

          <div className="pricing-grid app-pricing">
            {billing.plans.map((plan) => {
              const current = plan.code === billing.tier;
              return (
                <article key={plan.code} className={`plan ${plan.featured ? "is-featured" : ""}`}>
                  {plan.featured && <span className="plan-flag">MOST POPULAR</span>}
                  <h3>{plan.name}</h3>
                  <p>{plan.blurb}</p>
                  <div className="plan-price">{plan.contact_sales ? "Custom" : plan.price_usd ? price(plan.price_usd, plan.price_ngn) : "Free"}{plan.price_usd && !plan.contact_sales ? <small>/month</small> : null}</div>
                  <ul className="check-list">{plan.features.map((feature) => <li key={feature}><CircleCheck size={18} />{feature}</li>)}</ul>
                  {current ? (
                    <button type="button" className="btn btn-outline btn-block" disabled>Current plan</button>
                  ) : plan.contact_sales ? (
                    <a className="btn btn-outline btn-block" href={`mailto:${process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "support@reellingo.ai"}?subject=${encodeURIComponent(`${plan.name} plan`)}`}>Contact sales</a>
                  ) : plan.price_usd ? (
                    <button type="button" className={`btn btn-block ${plan.featured ? "btn-primary" : "btn-outline"}`} disabled={!payable || !canManage || Boolean(busy)} onClick={() => checkout({ plan: plan.code })}>
                      {busy === plan.code ? <LoaderCircle size={16} className="spin" /> : <CreditCard size={16} />}Choose {plan.name}
                    </button>
                  ) : <span className="plan-note">Your plan when nothing else is active</span>}
                </article>
              );
            })}
          </div>

          {billing.packs.length > 0 && <section className="section-block" id="payg">
            <h2>Pay as you go</h2>
            <p className="card-sub">Not ready for a subscription? Buy a one-off credit. Each covers one video up to the length shown and never expires. Credits are used automatically when your monthly videos run out or a video is longer than your plan allows.</p>
            <div className="pack-grid">
              {billing.packs.map((pack) => (
                <article key={pack.code} className="card pack">
                  <strong>Up to {pack.minutes} min</strong>
                  <span className="pack-price">{price(pack.price_usd, pack.price_ngn)}</span>
                  <button type="button" className="btn btn-outline btn-sm btn-block" disabled={!payable || !canManage || Boolean(busy)} onClick={() => checkout({ pack: pack.code })}>
                    {busy === pack.code ? <LoaderCircle size={14} className="spin" /> : null}Buy 1 video
                  </button>
                </article>
              ))}
            </div>
          </section>}

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
                        <td>{payment.kind === "payg" ? `Credit (${payment.credit_pack?.replace("payg_", "")} min)` : payment.kind === "renewal" ? `${payment.plan_code} renewal` : `${payment.plan_code} plan`}</td>
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
