"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CircleAlert, CircleCheck, LoaderCircle } from "lucide-react";
import AppShell from "@/components/AppShell";
import { verifyCheckout } from "@/lib/api";

/** Landing page after Paystack/Stripe checkout: confirms the payment so the plan or credit is active right away. */
export default function BillingCallbackPage() {
  const [state, setState] = useState<"checking" | "success" | "pending" | "error">("checking");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const provider = params.get("provider") || "paystack";
    const reference = params.get("reference") || params.get("trxref");
    const sessionId = params.get("session_id");
    let attempts = 0;
    const check = async () => {
      attempts += 1;
      try {
        const result = await verifyCheckout(provider, reference, sessionId);
        if (result.status === "success") {
          setState("success");
          return;
        }
        if (attempts < 6) setTimeout(check, 3000);
        else setState("pending");
      } catch (error) {
        setState("error");
        setMessage(error instanceof Error ? error.message : "We couldn't confirm the payment.");
      }
    };
    void check();
  }, []);

  return (
    <AppShell crumbs={[{ label: "Billing", href: "/billing" }, { label: "Payment" }]}>
      {state === "checking" && <section className="center-state"><span><LoaderCircle size={28} className="spin" /></span><h1>Confirming your payment…</h1><p>This only takes a moment.</p></section>}
      {state === "success" && <section className="center-state"><span style={{ color: "var(--teal)" }}><CircleCheck size={28} /></span><h1>Payment confirmed</h1><p>Your plan or credit is active. Time to reach new audiences.</p><Link href="/dashboard#new-project" className="btn btn-primary">Start a project</Link></section>}
      {state === "pending" && <section className="center-state"><span><LoaderCircle size={28} /></span><h1>Payment is still processing</h1><p>Your bank hasn&apos;t confirmed yet. It usually completes within a few minutes — we&apos;ll activate it automatically.</p><Link href="/billing" className="btn btn-primary">Back to billing</Link></section>}
      {state === "error" && <section className="center-state is-error"><span><CircleAlert size={28} /></span><h1>We couldn&apos;t confirm the payment</h1><p>{message} If you were charged, contact support with your payment reference.</p><Link href="/billing" className="btn btn-primary">Back to billing</Link></section>}
    </AppShell>
  );
}
