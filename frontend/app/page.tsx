import Link from "next/link";
import Image from "next/image";
import { ArrowDownRight, ArrowRight, Globe2, Languages, Sparkles } from "lucide-react";
import AppHeader from "@/components/AppHeader";

export default function LandingPage() {
  return (
    <div className="landing-shell">
      <AppHeader />
      <main>
        <section className="landing-hero">
          <div className="hero-copy">
            <p className="eyebrow"><span className="eyebrow-dot" /> SOUND LIKE YOU, EVERYWHERE</p>
            <h1>Your voice.<br /><span>Everywhere.</span></h1>
            <p className="hero-description">Translate your video into a new language and give it a voice that feels at home there.</p>
            <div className="hero-actions">
              <Link href="/dashboard" className="primary-action">Open creator studio <ArrowRight size={17} /></Link>
              <a href="#languages" className="text-action">Explore languages <ArrowDownRight size={16} /></a>
            </div>
            <p className="hero-note"><Sparkles size={14} /> Built for African stories. Ready for the world.</p>
          </div>
          <figure className="hero-visual">
            <Image
              src="/creator-dashboard-reference.png"
              alt="ReelLingo creator dashboard with video projects and language controls"
              fill
              priority
              sizes="(max-width: 900px) 100vw, 54vw"
            />
            <figcaption><span className="live-dot" /> A little more room to be heard</figcaption>
          </figure>
        </section>

        <section className="language-band" id="languages">
          <div className="language-band-title"><Globe2 size={17} /><span>One story, many places</span></div>
          <p>Nigeria <b>·</b> Ghana <b>·</b> Kenya <b>·</b> France <b>·</b> Japan <b>·</b> Brazil <b>·</b> and beyond</p>
          <Link href="/dashboard" aria-label="Browse all languages in the studio"><Languages size={18} /></Link>
        </section>

        <section className="landing-bottom">
          <p>FROM FIRST WORD TO FINAL CUT</p>
          <div><span>Transcribe</span><i>→</i><span>Translate</span><i>→</i><span>Dub</span><i>→</i><span>Share it wide</span></div>
        </section>
      </main>
    </div>
  );
}
