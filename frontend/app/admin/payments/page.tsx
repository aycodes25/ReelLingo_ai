"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronDown, CircleAlert } from "lucide-react";
import AdminNav from "@/components/AdminNav";
import AppShell from "@/components/AppShell";
import { getAdminPayments } from "@/lib/api";
import { formatMoney } from "@/lib/format";
import type { AdminPayment } from "@/lib/types";

export default function AdminPaymentsPage() {
  const [payments, setPayments] = useState<AdminPayment[] | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getAdminPayments(status).then(setPayments).catch((loadError: unknown) => setError(loadError instanceof Error ? loadError.message : "Could not load payments."));
  }, [status]);

  const totals = (payments || []).filter((payment) => payment.status === "success").reduce<Record<string, number>>((sum, payment) => {
    sum[payment.currency] = (sum[payment.currency] || 0) + payment.amount / 100;
    return sum;
  }, {});

  return (
    <AppShell crumbs={[{ label: "Admin", href: "/admin" }, { label: "Payments" }]}>
      <AdminNav />
      <div className="page-head">
        <div>
          <h1>Payments</h1>
          <p>Every Paystack and Stripe payment. Money lands in your Paystack/Stripe accounts; this list is for tracking and support.</p>
        </div>
        <div className="select-wrap" style={{ width: 170 }}>
          <select className="select" value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filter by status">
            <option value="">All payments</option>
            <option value="success">Successful</option>
            <option value="pending">Pending</option>
          </select>
          <ChevronDown size={16} />
        </div>
      </div>
      {error && <div role="alert" className="alert alert-error" style={{ marginBottom: 20 }}><CircleAlert size={16} /><span>{error}</span></div>}
      {Object.keys(totals).length > 0 && (
        <div className="stat-grid" style={{ marginBottom: 20 }}>
          {Object.entries(totals).map(([currency, amount]) => <div key={currency} className="stat-tile"><span>Received ({currency})</span><strong>{formatMoney(amount, currency)}</strong><small>last 200 payments</small></div>)}
        </div>
      )}
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th>Date</th><th>Customer</th><th>Item</th><th>Amount</th><th>Method</th><th>Status</th><th>Reference</th></tr></thead>
          <tbody>
            {payments?.map((payment) => (
              <tr key={payment.reference}>
                <td>{new Date(payment.created_at).toLocaleString()}</td>
                <td><Link className="link" href={`/admin/users/${encodeURIComponent(payment.user_id)}`}>{payment.email || payment.user_id}</Link>{payment.billing_id.startsWith("team:") && <div className="cell-sub">for {payment.billing_id}</div>}</td>
                <td>{payment.kind === "payg" ? `Credit (${payment.credit_pack?.replace("payg_", "")} min)` : `${payment.plan_code} ${payment.kind}`}</td>
                <td>{formatMoney(payment.amount / 100, payment.currency)}</td>
                <td>{payment.provider}</td>
                <td><span className={`badge ${payment.status === "success" ? "badge-done" : payment.status === "pending" ? "badge-processing" : "badge-failed"}`}>{payment.status}</span></td>
                <td><code>{payment.reference}</code></td>
              </tr>
            ))}
            {payments?.length === 0 && <tr><td colSpan={7} className="card-sub">No payments yet. Once PAYSTACK_SECRET_KEY / STRIPE_SECRET_KEY are in backend/.env, purchases show up here.</td></tr>}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
