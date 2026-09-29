"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Bell, ChevronRight, CircleHelp, FileText, LayoutGrid, LogOut, Menu, Plus, Search, Settings, Video } from "lucide-react";
import BrandLogo from "@/components/BrandLogo";
import { clearStoredToken, getApiHealth, getSessionUser, getStoredToken, logout } from "@/lib/api";
import type { SessionUser } from "@/lib/types";

export const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "support@reellingo.ai";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutGrid },
  { href: "/projects", label: "Projects", icon: Video },
  { href: "/transcripts", label: "Transcripts", icon: FileText },
  { href: "/settings", label: "Settings", icon: Settings },
];

export interface Crumb {
  label: string;
  href?: string;
}

export default function AppShell({ crumbs, children }: { crumbs: Crumb[]; children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!getStoredToken()) {
      router.replace("/login");
      return;
    }
    setUser(getSessionUser());
    getApiHealth().then((health) => {
      // A demo token is useless once the backend runs against real auth.
      if (health.mode === "live" && getStoredToken() === "local-demo-token") {
        clearStoredToken();
        router.replace("/login");
      }
    }).catch(() => undefined);
  }, [router]);

  useEffect(() => { setNavOpen(false); }, [pathname]);

  async function handleLogout() {
    await logout();
    router.replace("/login");
  }

  function handleSearch(event: FormEvent) {
    event.preventDefault();
    router.push(`/projects${query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ""}`);
  }

  const initials = (user?.name || "C").split(/\s+/).map((part) => part[0]?.toUpperCase()).join("").slice(0, 2);

  return (
    <div className={`app ${navOpen ? "is-nav-open" : ""}`} onClick={(event) => { if (navOpen && event.target === event.currentTarget) setNavOpen(false); }}>
      <aside className="sidebar">
        <BrandLogo variant="app" href="/dashboard" size={40} />
        <nav className="side-nav" aria-label="Studio navigation">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} className={pathname === href ? "is-active" : ""} aria-current={pathname === href ? "page" : undefined}>
              <Icon size={19} strokeWidth={1.8} />{label}
            </Link>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="user-chip">
            <span className="avatar">{initials}</span>
            <div><strong>{user?.name || " "}</strong><small>{user?.email || " "}</small></div>
          </div>
          <button type="button" className="logout-btn" onClick={handleLogout}><LogOut size={18} strokeWidth={1.8} />Log out</button>
        </div>
      </aside>

      <div className="app-main">
        <header className="topbar">
          <button type="button" className="icon-btn mobile-menu-btn" aria-label="Open navigation" onClick={() => setNavOpen(true)}><Menu size={20} /></button>
          <nav className="crumbs" aria-label="Breadcrumb">
            {crumbs.map((crumb, index) => (
              <span key={`${crumb.label}-${index}`} style={{ display: "contents" }}>
                {index > 0 && <ChevronRight size={15} />}
                {crumb.href && index < crumbs.length - 1 ? <Link href={crumb.href}>{crumb.label}</Link> : <span>{crumb.label}</span>}
              </span>
            ))}
          </nav>
          <form className="search" role="search" onSubmit={handleSearch}>
            <Search size={16} />
            <input type="search" placeholder="Search projects..." aria-label="Search projects" value={query} onChange={(event) => setQuery(event.target.value)} />
          </form>
          <a className="icon-btn" href={`mailto:${SUPPORT_EMAIL}`} aria-label="Get help"><CircleHelp size={20} /></a>
          <Link className="icon-btn bell" href="/dashboard#announcements" aria-label="Announcements"><Bell size={20} /></Link>
          <Link href="/dashboard#new-project" className="btn btn-primary btn-sm"><Plus size={17} /><span className="btn-label">New Project</span></Link>
        </header>

        <main className="app-content">{children}</main>

        <footer className="app-footer">
          <span>© {new Date().getFullYear()} ReelLingo AI. Built for the global African creator economy.</span>
          <nav>
            <Link href="/#how-it-works">Documentation</Link>
            <Link href="/#features">API Reference</Link>
            <Link href="/settings#status">Status</Link>
            <a href={`mailto:${SUPPORT_EMAIL}`}>Contact Support</a>
          </nav>
        </footer>
      </div>
    </div>
  );
}
