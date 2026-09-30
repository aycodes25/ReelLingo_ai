"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BookOpenText, Bell, ChevronDown, ChevronRight, CircleHelp, Code2, CreditCard, FileText, LayoutGrid, LogOut, Menu, Plus, Search, Settings,
  ShieldCheck, Users, Video,
} from "lucide-react";
import BrandLogo from "@/components/BrandLogo";
import { clearStoredToken, getApiHealth, getMe, getSessionUser, getStoredToken, getWorkspace, logout, setWorkspace } from "@/lib/api";
import type { ApiHealth, Me, SessionUser } from "@/lib/types";

export const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "support@reellingo.ai";
export const SUPPORT_WHATSAPP = process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP || "";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutGrid },
  { href: "/projects", label: "Projects", icon: Video },
  { href: "/transcripts", label: "Transcripts", icon: FileText },
  { href: "/glossary", label: "Glossary", icon: BookOpenText },
  { href: "/teams", label: "Teams", icon: Users },
  { href: "/billing", label: "Billing", icon: CreditCard },
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
  const [me, setMe] = useState<Me | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [workspace, setWorkspaceState] = useState("personal");
  const [health, setHealth] = useState<ApiHealth | null>(null);
  const [suspended, setSuspended] = useState<string | null>(null);

  useEffect(() => {
    if (!getStoredToken()) {
      router.replace(`/login?next=${encodeURIComponent(window.location.pathname)}`);
      return;
    }
    setUser(getSessionUser());
    setWorkspaceState(getWorkspace());
    getMe().then((account) => {
      setMe(account);
      setUser({ email: account.email, name: account.name || account.email.split("@")[0], creatorType: account.creator_type });
      // Forget a team workspace the user no longer belongs to.
      const current = getWorkspace();
      if (current !== "personal" && !account.teams.some((team) => String(team.id) === current && team.status === "active")) {
        setWorkspace("personal");
        setWorkspaceState("personal");
      }
    }).catch((error: { status?: number; code?: string; message?: string }) => {
      if (error?.status === 401) {
        clearStoredToken();
        router.replace("/login");
      }
      if (error?.code === "suspended") setSuspended(error.message || "Your account has been suspended.");
    });
    getApiHealth().then((status) => {
      setHealth(status);
      // A demo token is useless once the backend runs against real auth.
      if (status.mode === "live" && getStoredToken() === "local-demo-token") {
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

  function switchWorkspace(value: string) {
    setWorkspace(value);
    setWorkspaceState(value);
    window.location.reload();
  }

  const initials = (user?.name || "C").split(/\s+/).map((part) => part[0]?.toUpperCase()).join("").slice(0, 2);
  const activeTeams = me?.teams.filter((team) => team.status === "active") || [];
  const pendingInvites = me?.teams.filter((team) => team.status === "invited").length || 0;
  const features = health?.settings?.features || {};
  const visibleNav = NAV.filter((item) => item.href !== "/teams" || features.teams !== false);
  const nav = me?.is_admin ? [...visibleNav, { href: "/admin", label: "Admin", icon: ShieldCheck }] : visibleNav;
  const supportEmail = health?.settings?.support.email || SUPPORT_EMAIL;
  const supportWhatsapp = (health?.settings?.support.whatsapp || SUPPORT_WHATSAPP).replace(/\D/g, "");
  const announcement = health?.settings?.announcement;
  const maintenance = health?.settings?.maintenance;

  if (suspended) {
    return (
      <main className="center-state is-error" style={{ minHeight: "80vh", alignContent: "center" }}>
        <span><ShieldCheck size={28} /></span>
        <h1>Account suspended</h1>
        <p>{suspended}</p>
        <button type="button" className="btn btn-primary" onClick={handleLogout}>Log out</button>
      </main>
    );
  }

  return (
    <div className={`app ${navOpen ? "is-nav-open" : ""}`} onClick={(event) => { if (navOpen && event.target === event.currentTarget) setNavOpen(false); }}>
      <aside className="sidebar">
        <BrandLogo variant="app" href="/dashboard" size={40} />
        {activeTeams.length > 0 && (
          <label className="workspace-switch">
            <span>Workspace</span>
            <div className="select-wrap">
              <select className="select" value={workspace} onChange={(event) => switchWorkspace(event.target.value)} aria-label="Switch workspace">
                <option value="personal">Personal</option>
                {activeTeams.map((team) => <option key={team.id} value={String(team.id)}>{team.name}</option>)}
              </select>
              <ChevronDown size={16} />
            </div>
          </label>
        )}
        <nav className="side-nav" aria-label="Studio navigation">
          {nav.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} className={pathname === href || (href !== "/dashboard" && pathname?.startsWith(`${href}/`)) ? "is-active" : ""} aria-current={pathname === href ? "page" : undefined}>
              <Icon size={19} strokeWidth={1.8} />{label}
              {href === "/teams" && pendingInvites > 0 && <span className="nav-badge" aria-label={`${pendingInvites} pending invitation${pendingInvites === 1 ? "" : "s"}`}>{pendingInvites}</span>}
            </Link>
          ))}
        </nav>
        <div className="sidebar-foot">
          {me && (
            <Link href="/billing" className="plan-chip">
              <span>{me.plan.plan.name} plan</span>
              <small>{me.plan.videos_this_month}/{me.plan.max_videos_per_month} videos{me.plan.credits.length ? ` · ${me.plan.credits.length} credit${me.plan.credits.length === 1 ? "" : "s"}` : ""}</small>
            </Link>
          )}
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
            {workspace !== "personal" && <span className="workspace-tag">{activeTeams.find((team) => String(team.id) === workspace)?.name || "Team"}</span>}
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
          <a className="icon-btn" href={supportWhatsapp ? `https://wa.me/${supportWhatsapp}` : `mailto:${supportEmail}`} target={supportWhatsapp ? "_blank" : undefined} rel="noreferrer" aria-label="Get help"><CircleHelp size={20} /></a>
          <Link className="icon-btn bell" href="/dashboard#announcements" aria-label="Announcements"><Bell size={20} /></Link>
          <Link href="/dashboard#new-project" className="btn btn-primary btn-sm"><Plus size={17} /><span className="btn-label">New Project</span></Link>
        </header>

        {maintenance?.enabled && (
          <div className="site-banner is-warn" role="status">
            <b>Maintenance:</b> {maintenance.message}{me?.is_admin ? " (You're an admin, so you can still use everything.)" : ""}
          </div>
        )}
        {announcement && <div className={`site-banner is-${announcement.tone}`} role="status">{announcement.text}</div>}
        <main className="app-content">{children}</main>

        <footer className="app-footer">
          <span>© {new Date().getFullYear()} ReelLingo AI. Built for the global African creator economy.</span>
          <nav>
            <Link href="/#how-it-works">Documentation</Link>
            <Link href="/docs/api"><Code2 size={13} style={{ display: "inline", verticalAlign: "-2px" }} /> API Reference</Link>
            <Link href="/settings#status">Status</Link>
            <a href={`mailto:${supportEmail}`}>Contact Support</a>
          </nav>
        </footer>
      </div>
    </div>
  );
}
