"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/plans", label: "Plans" },
  { href: "/admin/settings", label: "App settings" },
  { href: "/admin/teams", label: "Teams" },
  { href: "/admin/payments", label: "Payments" },
];

export default function AdminNav() {
  const pathname = usePathname();
  return (
    <nav className="admin-nav" aria-label="Admin sections">
      {TABS.map((tab) => {
        const active = tab.href === "/admin" ? pathname === "/admin" : pathname?.startsWith(tab.href);
        return <Link key={tab.href} href={tab.href} className={active ? "is-active" : ""} aria-current={active ? "page" : undefined}>{tab.label}</Link>;
      })}
    </nav>
  );
}
