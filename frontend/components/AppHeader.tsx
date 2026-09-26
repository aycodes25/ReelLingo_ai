import Link from "next/link";
import { ArrowUpRight, Clapperboard } from "lucide-react";

export default function AppHeader({ active = "" }: { active?: string }) {
  return (
    <header className="site-header">
      <Link href="/" className="brand" aria-label="ReelLingo home">
        <span className="brand-mark"><Clapperboard size={18} strokeWidth={2.4} /></span>
        <span>reel<span className="brand-accent">lingo</span></span>
      </Link>
      <nav className="header-links" aria-label="Main navigation">
        <Link className={active === "studio" ? "nav-link is-current" : "nav-link"} href="/dashboard">Studio</Link>
        <a className="nav-link" href="/#languages">Languages</a>
      </nav>
      <Link href="/dashboard" className="header-cta">
        Open studio <ArrowUpRight size={15} />
      </Link>
    </header>
  );
}