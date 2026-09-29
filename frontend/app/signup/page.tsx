"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, ChevronDown, CircleAlert, Globe, Mail, Mic, UserRound, Video } from "lucide-react";
import BrandLogo from "@/components/BrandLogo";
import { OAuthButtons, PasswordInput } from "@/components/AuthFields";
import { getApiHealth, signup } from "@/lib/api";
import type { ApiHealth } from "@/lib/types";

const CREATOR_TYPES = ["Educational", "Lifestyle & Vlogging", "Tech & Reviews", "Entertainment & Comedy", "Music", "Food & Cooking", "Business & Finance", "News & Documentary", "Faith & Inspiration", "Other"];

export default function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [creatorType, setCreatorType] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [health, setHealth] = useState<ApiHealth | null>(null);
  const signUpUnavailable = health?.mode === "live" && !health.capabilities.authentication;
  const isComplete = Boolean(name.trim() && email && password.length >= 8 && creatorType && agreed);

  useEffect(() => {
    getApiHealth().then(setHealth).catch(() => undefined);
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!isComplete) return;
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      await signup(email, password, { name: name.trim(), creatorType });
      router.push("/dashboard");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Something went wrong");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="signup-page">
      <div className="signup-card">
        <aside className="signup-aside">
          <BrandLogo variant="signup" size={40} />
          <h2>Empowering African<br />Creators for the<br /><em>Global Stage</em></h2>
          <p>Join thousands of creators using AI to localize their content with cultural nuance and precision.</p>
          <ul className="perk-list">
            <li><span><Globe size={13} /></span>Translate to 50+ Global Languages</li>
            <li><span><Mic size={13} /></span>Natural Voice Cloning &amp; Dubbing</li>
            <li><span><Video size={13} /></span>Automated Subtitle Synchronization</li>
          </ul>
          <div className="signup-art">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/images/african-pattern.png" alt="Geometric African pattern artwork in navy, coral and gold" />
          </div>
        </aside>

        <section className="signup-form">
          <h1>Create your account</h1>
          <p className="auth-sub">Start your localization journey today. No credit card required.</p>

          {signUpUnavailable && (
            <div className="alert alert-warn" style={{ marginBottom: 20 }}><CircleAlert size={16} /><span><strong>Account sign-up is not configured.</strong> Add SUPABASE_URL and SUPABASE_KEY to backend/.env, then restart the backend.</span></div>
          )}
          {errorMessage && <div role="alert" className="alert alert-error" style={{ marginBottom: 20 }}><CircleAlert size={16} /><span>{errorMessage}</span></div>}

          <form onSubmit={handleSubmit} className="form-stack">
            <div className="field">
              <label className="field-label" htmlFor="name">Full name</label>
              <div className="input-wrap">
                <UserRound size={16} />
                <input id="name" className="input" required autoComplete="name" placeholder="Kwame Osei" value={name} onChange={(event) => setName(event.target.value)} />
              </div>
            </div>
            <div className="field">
              <label className="field-label" htmlFor="email">Email address</label>
              <div className="input-wrap">
                <Mail size={16} />
                <input id="email" className="input" type="email" required autoComplete="email" placeholder="kwame@creator.com" value={email} onChange={(event) => setEmail(event.target.value)} />
              </div>
            </div>
            <div className="field">
              <label className="field-label" htmlFor="password">Password</label>
              <PasswordInput id="password" value={password} onChange={setPassword} autoComplete="new-password" />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="creator-type">Creator type</label>
              <div className="select-wrap">
                <select id="creator-type" className="select" required value={creatorType} onChange={(event) => setCreatorType(event.target.value)} style={{ color: creatorType ? undefined : "var(--primary)" }}>
                  <option value="" disabled>Select your primary niche</option>
                  {CREATOR_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                </select>
                <ChevronDown size={17} />
              </div>
            </div>
            <label className="checkbox">
              <input type="checkbox" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} />
              <span>I agree to the <a className="link" style={{ fontWeight: 500 }} href="#">Terms of Service</a> and <a className="link" style={{ fontWeight: 500 }} href="#">Privacy Policy</a>.</span>
            </label>
            <button type="submit" disabled={!isComplete || isSubmitting || signUpUnavailable} className="btn btn-primary btn-block auth-submit">
              {isSubmitting ? "Creating account…" : "Create Account"} <ArrowRight size={17} />
            </button>
          </form>

          <div className="divider">or continue with</div>
          <OAuthButtons providers={["google", "apple"]} />

          <p className="auth-switch">Already have an account? <Link href="/login" className="link-coral">Log in</Link></p>
        </section>
      </div>
    </main>
  );
}
