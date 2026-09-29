"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, CircleAlert, CircleCheck, Globe, Mail, Sparkles } from "lucide-react";
import BrandLogo from "@/components/BrandLogo";
import { OAuthButtons, PasswordInput } from "@/components/AuthFields";
import { getApiHealth, login } from "@/lib/api";
import type { ApiHealth } from "@/lib/types";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [health, setHealth] = useState<ApiHealth | null>(null);
  const signInUnavailable = health?.mode === "live" && !health.capabilities.authentication;

  useEffect(() => {
    getApiHealth().then(setHealth).catch(() => undefined);
    const params = new URLSearchParams(window.location.search);
    if (params.get("error") === "oauth_unavailable") {
      setErrorMessage("Social sign-in needs Supabase. Add SUPABASE_URL and SUPABASE_KEY to backend/.env and enable the provider in Supabase.");
    } else if (params.get("error")) {
      setErrorMessage(params.get("error_description") || "Sign-in was cancelled. Please try again.");
    }
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      await login(email, password);
      router.push("/dashboard");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Something went wrong");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="auth-split">
      <section className="auth-form-side">
        <div className="auth-form-inner">
          <h1>Welcome back</h1>
          <p className="auth-sub">Log in to your account to continue creating and translating.</p>

          <OAuthButtons providers={["google", "github"]} />
          <div className="divider">or continue with email</div>

          {health?.mode === "demo" && !health.capabilities.authentication && (
            <div className="alert alert-warn"><CircleAlert size={16} /><span><strong>Demo sign-in.</strong> Supabase isn&apos;t configured, so any email and password opens the local demo studio.</span></div>
          )}
          {signInUnavailable && (
            <div className="alert alert-warn"><CircleAlert size={16} /><span><strong>Account sign-in is not configured.</strong> Add SUPABASE_URL and SUPABASE_KEY to backend/.env, then restart the backend.</span></div>
          )}
          {errorMessage && <div role="alert" className="alert alert-error"><CircleAlert size={16} /><span>{errorMessage}</span></div>}

          <form onSubmit={handleSubmit} className="form-stack">
            <div className="field">
              <label className="field-label" htmlFor="email">Email address</label>
              <div className="input-wrap">
                <Mail size={17} />
                <input id="email" className="input" type="email" required autoComplete="email" placeholder="name@company.com" value={email} onChange={(event) => setEmail(event.target.value)} />
              </div>
            </div>
            <div className="field">
              <div className="field-label-row">
                <label className="field-label" htmlFor="password">Password</label>
                <a className="link" style={{ fontWeight: 500, fontSize: 15 }} href="mailto:support@reellingo.ai?subject=Password%20reset">Forgot password?</a>
              </div>
              <PasswordInput id="password" value={password} onChange={setPassword} autoComplete="current-password" />
            </div>
            <button type="submit" disabled={isSubmitting || signInUnavailable} className="btn btn-primary btn-block auth-submit">
              {isSubmitting ? "Signing in…" : "Sign In"} <ArrowRight size={17} />
            </button>
          </form>

          <p className="auth-switch">Don&apos;t have an account? <Link href="/signup" className="link">Sign up for free</Link></p>
        </div>
        <p className="auth-footnote">© {new Date().getFullYear()} ReelLingo AI. All rights reserved. Professional video localization for creators.</p>
      </section>

      <section className="auth-visual" aria-label="About ReelLingo">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/images/globe-network.png" alt="" />
        <div className="auth-visual-inner">
          <BrandLogo variant="auth" size={42} />
          <div><span className="kicker"><Sparkles size={12} /> AI-Powered Localization</span></div>
          <h2>Empowering African creators to go global.</h2>
          <p className="lead">Connect with audiences worldwide by localizing your content in minutes. Precision translation, voice cloning, and cultural nuance built for you.</p>
          <div className="stat-cards">
            <div className="stat-card">
              <span className="stat-card-icon" style={{ color: "#ff8a5c", background: "rgba(242,107,58,.22)" }}><Globe size={20} /></span>
              <strong>50+ Languages</strong>
              <span>Localize your message for every corner of the world.</span>
            </div>
            <div className="stat-card">
              <span className="stat-card-icon" style={{ color: "#3fd6c3", background: "rgba(19,168,154,.25)" }}><CircleCheck size={20} /></span>
              <strong>99% Accuracy</strong>
              <span>High-fidelity transcription and natural dubbing sync.</span>
            </div>
          </div>
          <div className="quote-chip">
            <span className="avatar" style={{ background: "#3d3a8f" }}>KO</span>
            <span>&ldquo;ReelLingo doubled my subscribers in just 3 months!&rdquo; <b>— Kwame O.</b></span>
          </div>
        </div>
      </section>
    </div>
  );
}
