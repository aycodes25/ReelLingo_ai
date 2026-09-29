import Link from "next/link";
import Image from "next/image";
import {
  ArrowRight, CircleCheck, Facebook, Globe, Instagram, Languages, Linkedin, Mic, Music2, Play, Twitter, Youtube,
} from "lucide-react";
import BrandLogo from "@/components/BrandLogo";
import Testimonials from "@/components/Testimonials";

const FEATURE_POINTS = ["99.9% Accuracy", "Preserved Tone & Emotion", "Instant Processing"];

const LANGUAGE_CHIPS = ["swahili", "yoruba", "zulu", "igbo", "amharic", "french", "portuguese", "english", "arabic"];

const ADOPTION = [
  { country: "Nigeria", growth: "+124%", width: "100%", color: "#13a89a" },
  { country: "Kenya", growth: "+86%", width: "86%", color: "#3e3aa8" },
  { country: "South Africa", growth: "+92%", width: "92%", color: "#ffc21a" },
  { country: "Ghana", growth: "+110%", width: "100%", color: "#f26b3a" },
];

const PLANS = [
  {
    name: "Free Starter", blurb: "Perfect for new creators exploring AI localization.", price: "$0", period: "/month",
    features: ["15 minutes of video/mo", "Standard AI voices", "5 languages available", "Watermarked exports", "720p resolution"],
    cta: "Get Started", href: "/signup",
  },
  {
    name: "Pro Creator", blurb: "The essential tool for professional content creators.", price: "$29", period: "/month", featured: true,
    features: ["120 minutes of video/mo", "Premium voice cloning", "Unlimited languages", "No watermarks", "4K resolution support", "Priority processing"],
    cta: "Get Started", href: "/signup",
  },
  {
    name: "Enterprise", blurb: "For media houses and large production teams.", price: "Custom", period: "",
    features: ["Unlimited video volume", "Dedicated support manager", "Custom API integration", "Collaborative workspaces", "Custom voice development", "Bulk licensing deals"],
    cta: "Contact Sales", href: "mailto:sales@reellingo.ai",
  },
];

export default function LandingPage() {
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
              {PLANS.map((plan) => (
                <article key={plan.name} className={`plan ${plan.featured ? "is-featured" : ""}`}>
                  {plan.featured && <span className="plan-flag">MOST POPULAR</span>}
                  <h3>{plan.name}</h3>
                  <p>{plan.blurb}</p>
                  <div className="plan-price">{plan.price}{plan.period && <small>{plan.period}</small>}</div>
                  <ul className="check-list">{plan.features.map((feature) => <li key={feature}><CircleCheck size={18} />{feature}</li>)}</ul>
                  {plan.href.startsWith("mailto:")
                    ? <a href={plan.href} className="btn btn-outline btn-block">{plan.cta}</a>
                    : <Link href={plan.href} className={`btn btn-block ${plan.featured ? "btn-primary" : "btn-outline"}`}>{plan.cta}</Link>}
                </article>
              ))}
            </div>
            <p className="pricing-note">All plans include a 7-day free trial of Pro features. No credit card required.</p>
          </div>
        </section>

        <section className="section" style={{ paddingTop: 48 }}>
          <div className="container">
            <div className="cta-panel">
              <h2>Ready to reach the world?</h2>
              <p>Join thousands of African creators who are scaling their global presence with ReelLingo.</p>
              <div className="cta-actions">
                <Link href="/signup" className="btn btn-yellow btn-lg">Start Your Free Trial</Link>
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
