import type { ReactNode } from "react";
import Link from "next/link";
import BrandLogo from "@/components/BrandLogo";

export interface LegalDetails {
  company: string;
  address: string;
  privacy_email: string;
  support_email: string;
  terms_version: string;
}

const API = process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

/** Business name, address and contact emails come from Admin → Settings → Legal, so they can change without a deploy. */
export async function loadLegalDetails(): Promise<LegalDetails> {
  const fallback = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "support@reellingo.ai";
  try {
    const response = await fetch(`${API}/health`, { next: { revalidate: 300 } });
    if (response.ok) {
      const health = await response.json();
      const legal = health.settings?.legal || {};
      const support = health.settings?.support?.email || fallback;
      return {
        company: legal.company || "ReelLingo",
        address: legal.address || "Lagos, Nigeria",
        privacy_email: legal.privacy_email || support,
        support_email: support,
        terms_version: legal.terms_version || "2026-10-04",
      };
    }
  } catch {
    // fall through
  }
  return { company: "ReelLingo", address: "Lagos, Nigeria", privacy_email: fallback, support_email: fallback, terms_version: "2026-10-04" };
}

export function formatVersion(version: string): string {
  const date = new Date(`${version}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? version : date.toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

export default function LegalLayout({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <div className="legal-page">
      <header className="site-header">
        <div className="container">
          <BrandLogo variant="landing" size={32} />
          <nav className="site-nav" aria-label="Legal">
            <Link href="/terms">Terms of Service</Link>
            <Link href="/privacy">Privacy Policy</Link>
          </nav>
          <div className="site-header-actions"><Link href="/" className="login-link">HOME</Link></div>
        </div>
      </header>
      <main className="container legal-body">
        <h1>{title}</h1>
        <p className="legal-updated">Last updated: {formatVersion(updated)}</p>
        {children}
      </main>
    </div>
  );
}
