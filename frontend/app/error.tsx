"use client";

import { useEffect } from "react";
import Link from "next/link";
import { CircleAlert } from "lucide-react";
import { reportError } from "@/lib/monitoring";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    void reportError(error, { digest: error.digest });
  }, [error]);

  return (
    <main className="center-state is-error" style={{ minHeight: "80vh", alignContent: "center" }}>
      <span><CircleAlert size={28} /></span>
      <h1>Something went wrong</h1>
      <p>We&apos;ve been notified. Try again, or head back to your dashboard.</p>
      <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
        <button type="button" className="btn btn-primary" onClick={reset}>Try again</button>
        <Link href="/dashboard" className="btn btn-outline">Dashboard</Link>
      </div>
    </main>
  );
}
