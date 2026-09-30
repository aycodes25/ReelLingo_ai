import Link from "next/link";
import Image from "next/image";
import {
  ArrowRight, CircleCheck, Facebook, Globe, Instagram, Languages, Linkedin, Mic, Music2, Play, Twitter, Youtube,
} from "lucide-react";
import BrandLogo from "@/components/BrandLogo";
import Testimonials from "@/components/Testimonials";
import { formatMoney } from "@/lib/format";
import type { CreditPack, Plan } from "@/lib/types";

const FEATURE_POINTS = ["99.9% Accuracy", "Preserved Tone & Emotion", "Instant Processing"];

const LANGUAGE_CHIPS = ["swahili", "yoruba", "zulu", "igbo", "amharic", "french", "portuguese", "english", "arabic"];

const ADOPTION = [
  { country: "Nigeria", growth: "+124%", width: "100%", color: "#13a89a" },
  { country: "Kenya", growth: "+86%", width: "86%", color: "#3e3aa8" },
  { country: "South Africa", growth: "+92%", width: "92%", color: "#ffc21a" },
  { country: "Ghana", growth: "+110%", width: "100%", color: "#f26b3a" },
];

const API = process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// Used only if the API is unreachable while the page renders; the plans table is the source of truth.
const FALLBACK_PLANS: Plan[] = [
  { code: "free", name: "Free", blurb: "Try ReelLingo on a short clip.", price_usd: 0, price_ngn: 0, videos_per_month: 1, max_video_minutes: 3, voice_clone: false, watermark: true, priority: 0, max_targets: 1, lip_sync: false, api_access: false, team_seats: 1, saved_voices: 0, featured: false, features: ["1 video per month", "Up to 3 minutes per video", "Standard AI voices", "ReelLingo watermark", "SRT & VTT subtitles"] },
  { code: "starter", name: "Starter", blurb: "For hobbyists and TikTokers.", price_usd: 10, price_ngn: 16000, videos_per_month: 5, max_video_minutes: 10, voice_clone: true, watermark: false, priority: 1, max_targets: 2, lip_sync: false, api_access: false, team_seats: 1, saved_voices: 0, featured: false, features: ["5 videos per month", "Up to 10 minutes per video", "Voice cloning", "No watermark", "2 languages per upload", "Burned-in captions"] },
  { code: "creator", name: "Creator", blurb: "The sweet spot for YouTubers.", price_usd: 25, price_ngn: 40000, videos_per_month: 10, max_video_minutes: 25, voice_clone: true, watermark: false, priority: 2, max_targets: 4, lip_sync: false, api_access: false, team_seats: 1, saved_voices: 1, featured: true, features: ["10 videos per month", "Up to 25 minutes per video", "Premium voice cloning + saved voice", "Priority processing", "4 languages per upload", "Multi-speaker dubbing", "Publish to YouTube"] },
  { code: "studio", name: "Studio", blurb: "For media houses and Nollywood.", price_usd: 80, price_ngn: 130000, videos_per_month: 30, max_video_minutes: 60, voice_clone: true, watermark: false, priority: 3, max_targets: 10, lip_sync: true, api_access: true, team_seats: 5, saved_voices: 5, featured: false, features: ["30 videos per month", "Up to 60 minutes per video", "Lip-sync", "Highest priority queue", "10 languages per upload", "Team workspace (5 seats)", "API access", "Dedicated WhatsApp support"] },
];

async function loadPlans(): Promise<{ plans: Plan[]; packs: CreditPack[] }> {
  try {
    const response = await fetch(`${API}/plans`, { next: { revalidate: 300 } });
    if (response.ok) return response.json();
  } catch {
    // fall through to the static copy
  }
  return { plans: FALLBACK_PLANS, packs: [] };
}

export default async function LandingPage() {
  const { plans, packs } = await loadPlans();
  return (
    <div>
      <header className="site-header">
        <div className="container">
          <BrandLogo variant="landing" size={32} />
          <nav className="site-nav" aria-label="Main navigation">
            <a href="#features">Features</a>
            <a href="#how-it-works">How it works</a>
            <a href="#languages">Language support</a>
            <a href="#pricing">Pricing</a>
          </nav>
          <div className="site-header-actions">
            <Link href="/login" className="login-link">LOG IN</Link>
            <Link href="/signup" className="btn btn-primary btn-sm">Start Free Trial</Link>
          </div>
        </div>
      </header>

      <main>
        <section className="hero">
          <div className="container">
            <div>
              <span className="pill pill-yellow">NEW: AI VOICE CLONING 2.0</span>
              <h1>Break the<br /><em>language barrier</em><br />for your content.</h1>
              <p className="hero-lead">Automatically translate, dub, and localize your videos for global audiences while preserving your unique voice and cultural essence.</p>
              <div className="hero-actions">
                <Link href="/signup" className="btn btn-primary btn-lg">Start Translating Now <ArrowRight size={18} /></Link>
                <a href="#how-it-works" className="btn btn-ghost-light btn-lg" style={{ fontSize: 15 }}><Play size={18} /> Watch Demo</a>
              </div>
              <div className="hero-trust">
                <div className="avatar-stack" aria-hidden="true">
                  <span style={{ background: "#3d3a8f" }}>NB</span>
                  <span style={{ background: "#d98a2b" }}>AO</span>
                  <span style={{ background: "#e7e6ee", color: "#6b6980" }}>+</span>
                </div>
                <span>Trusted by <strong>10,000+</strong> creators across Africa</span>
              </div>
            </div>
            <div className="hero-media">
              <Image src="/images/creator-studio.png" alt="A creator recording a live AI-assisted broadcast in her studio" width={468} height={260} priority sizes="(max-width: 960px) 100vw, 480px" />
              <div className="voice-sync" aria-hidden="true">
                <span className="voice-sync-icon"><Mic size={16} /></span>
                <span>Voice Syncing…<span className="voice-sync-bar" /></span>
              </div>
            </div>
          </div>
        </section>

        <section className="platforms" aria-label="Supported platforms">
          <p>EMPOWERING CREATORS ON THESE PLATFORMS</p>
          <div className="platform-icons">
            <Youtube size={26} strokeWidth={1.6} aria-label="YouTube" />
            <Music2 size={26} strokeWidth={1.6} aria-label="TikTok" />
            <Instagram size={26} strokeWidth={1.6} aria-label="Instagram" />
            <Facebook size={26} strokeWidth={1.6} aria-label="Facebook" />
            <Linkedin size={26} strokeWidth={1.6} aria-label="LinkedIn" />
          </div>
        </section>

        <section className="section" id="features">
          <div className="container">
            <div className="section-head">
              <span className="pill pill-coral">CORE CAPABILITIES</span>
              <h2>Global Reach, Local Resonance</h2>
              <p>We combine state-of-the-art AI with cultural intelligence to ensure your message is never lost in translation.</p>
            </div>

            <div className="feature">
              <div>
                <span className="feature-icon"><Globe size={22} /></span>
                <h3>Hyper-Accurate Translation</h3>
                <p>Go beyond literal word-for-word translation. Our AI understands slang, idioms, and cultural context across 50+ African and international languages.</p>
                <ul className="check-list">{FEATURE_POINTS.map((point) => <li key={point}><CircleCheck size={19} />{point}</li>)}</ul>
              </div>
              <div className="feature-media">
                <Image src="/images/voices-continents.png" alt="Speech bubbles saying hello in many languages around a video call" width={482} height={361} sizes="(max-width: 960px) 100vw, 490px" />
              </div>
            </div>

            <div className="feature is-reverse">
              <div className="feature-media">
                <Image src="/images/sound-to-voice.png" alt="Sound waves turning into a microphone icon: sound to voice transformation" width={482} height={361} sizes="(max-width: 960px) 100vw, 490px" />
              </div>
              <div>
                <span className="feature-icon"><Mic size={22} /></span>
                <h3>Seamless Voice Dubbing</h3>
                <p>Maintain your identity. Our voice cloning technology replicates your unique vocal characteristics, ensuring your dubbed content sounds exactly like you.</p>
                <ul className="check-list">{FEATURE_POINTS.map((point) => <li key={point}><CircleCheck size={19} />{point}</li>)}</ul>
              </div>
            </div>
          </div>
        </section>

        <section className="section" id="how-it-works" style={{ paddingTop: 32 }}>
          <div className="container">
            <div className="section-head">
              <span className="pill pill-coral">HOW IT WORKS</span>
              <h2>From Upload to Global in 3 Simple Steps</h2>
              <p>ReelLingo handles the heavy lifting so you can focus on creating.</p>
            </div>
            <div className="steps">
              {[
                { icon: <Play size={24} />, title: "Upload Content", text: "Drag and drop your video file. We support all major formats up to 4K resolution." },
                { icon: <Languages size={24} />, title: "Select Languages", text: "Choose from 50+ target languages and keep your own voice with speaker cloning." },
                { icon: <Globe size={24} />, title: "Global Distribution", text: "Download your localized video and SRT subtitles, ready for all social platforms." },
              ].map((step, index) => (
                <div key={step.title}>
                  <span className="step-circle">{step.icon}</span>
                  <span className="step-number">0{index + 1}</span>
                  <h3>{step.title}</h3>
                  <p>{step.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="section" style={{ paddingTop: 48 }}>
          <div className="container"><Testimonials /></div>
        </section>

        <section className="languages-band" id="languages">
          <div className="container">
            <div>
              <h2>Supporting 50+ Global<br />Languages &amp; Dialects</h2>
              <p className="lead">From major international languages to regional African dialects, we&apos;ve got the world covered. Our AI models are continuously trained on native speech patterns.</p>
              <div className="lang-grid">
                {LANGUAGE_CHIPS.map((language) => <span key={language} className="lang-chip"><Globe size={16} />{language}</span>)}
              </div>
              <Link href="/signup" className="btn btn-ghost-light btn-sm" style={{ marginTop: 34 }}>See All Languages</Link>
            </div>
            <div className="adoption">
              <div className="adoption-head"><span>GLOBAL ADOPTION</span><span>Live Data</span></div>
              {ADOPTION.map((row) => (
                <div key={row.country} className="adoption-row">
                  <div><span>{row.country}</span><span>{row.growth}</span></div>
                  <div className="bar"><i style={{ width: row.width, background: row.color }} /></div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="section" id="pricing">
          <div className="container">
            <div className="section-head" style={{ marginBottom: 48 }}>
              <span className="pill pill-coral">PRICING PLANS</span>
              <h2>Affordable for Every Stage</h2>
              <p>Whether you&apos;re just starting out or managing a media empire, we have a plan that fits.</p>
            </div>
            <div className="pricing-grid">
              {plans.map((plan) => (
                <article key={plan.code} className={`plan ${plan.featured ? "is-featured" : ""}`}>
                  {plan.featured && <span className="plan-flag">MOST POPULAR</span>}
                  <h3>{plan.name}</h3>
                  <p>{plan.blurb}</p>
                  <div className="plan-price">{plan.price_usd ? formatMoney(plan.price_usd, "USD") : "$0"}<small>/month</small></div>
                  {plan.price_ngn > 0 && <p className="plan-local">or {formatMoney(plan.price_ngn, "NGN")}/month with Paystack</p>}
                  <ul className="check-list">{plan.features.map((feature) => <li key={feature}><CircleCheck size={18} />{feature}</li>)}</ul>
                  <Link href={plan.price_usd ? "/signup?plan=" + plan.code : "/signup"} className={`btn btn-block ${plan.featured ? "btn-primary" : "btn-outline"}`}>{plan.price_usd ? `Choose ${plan.name}` : "Start free"}</Link>
                </article>
              ))}
            </div>
            {packs.length > 0 && (
              <p className="pricing-note">
                Not ready to subscribe? Pay per video: {packs.map((pack) => `${formatMoney(pack.price_usd, "USD")} up to ${pack.minutes} min`).join(" · ")}.
              </p>
            )}
            <p className="pricing-note">Pay in Naira with Paystack or in dollars by card. Cancel anytime. No credit card needed for the free plan.</p>
          </div>
        </section>

        <section className="section" style={{ paddingTop: 48 }}>
          <div className="container">
            <div className="cta-panel">
              <h2>Ready to reach the world?</h2>
              <p>Join thousands of African creators who are scaling their global presence with ReelLingo.</p>
              <div className="cta-actions">
                <Link href="/signup" className="btn btn-yellow btn-lg">Start Free</Link>
                <a href="mailto:sales@reellingo.ai" className="btn btn-ghost-light btn-lg" style={{ fontSize: 15 }}>Talk to an Expert</a>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="container">
          <div className="footer-grid">
            <div>
              <BrandLogo variant="footer" size={32} />
              <p>Empowering the next generation of African storytellers to share their vision with the global community.</p>
              <div className="socials">
                <a href="https://facebook.com" aria-label="Facebook" target="_blank" rel="noreferrer"><Facebook size={18} /></a>
                <a href="https://twitter.com" aria-label="Twitter" target="_blank" rel="noreferrer"><Twitter size={18} /></a>
                <a href="https://instagram.com" aria-label="Instagram" target="_blank" rel="noreferrer"><Instagram size={18} /></a>
                <a href="https://linkedin.com" aria-label="LinkedIn" target="_blank" rel="noreferrer"><Linkedin size={18} /></a>
              </div>
            </div>
            <div>
              <h4>PRODUCT</h4>
              <ul><li><a href="#features">Features</a></li><li><a href="#features">Voice Cloning</a></li><li><a href="#how-it-works">Dubbing API</a></li><li><a href="#pricing">Pricing</a></li></ul>
            </div>
            <div>
              <h4>COMPANY</h4>
              <ul><li><a href="#features">About Us</a></li><li><a href="#features">Blog</a></li><li><a href="#features">Careers</a></li><li><a href="mailto:hello@reellingo.ai">Contact</a></li></ul>
            </div>
            <div>
              <h4>LEGAL</h4>
              <ul><li><a href="#">Privacy Policy</a></li><li><a href="#">Terms of Service</a></li><li><a href="#">Cookie Policy</a></li></ul>
            </div>
          </div>
          <div className="footer-bottom">
            <span>© {new Date().getFullYear()} ReelLingo AI. All rights reserved.</span>
            <div><span>Lagos, Nigeria</span><i /><span>Nairobi, Kenya</span></div>
          </div>
        </div>
      </footer>
    </div>
  );
}
