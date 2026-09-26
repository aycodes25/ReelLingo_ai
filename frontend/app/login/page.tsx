"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Clapperboard } from "lucide-react";
import AppHeader from "@/components/AppHeader";
import { getApiHealth, login, signup } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [authConfigured, setAuthConfigured] = useState<boolean | null>(null);

  useEffect(() => {
    getApiHealth().then((health) => setAuthConfigured(health.capabilities.authentication)).catch(() => undefined);
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      if (mode === "login") {
        await login(email, password);
      } else {
        await signup(email, password);
      }
      router.push("/dashboard");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Something went wrong");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="app-shell">
      <AppHeader />
      <main className="auth-main">
        <section className="auth-panel">
          <span className="auth-symbol"><Clapperboard size={22} /></span>
          <p className="eyebrow">YOUR CREATOR STUDIO</p>
          <h1>{mode === "login" ? "Welcome back." : "Your next audience is waiting."}</h1>
          <p className="auth-intro">{mode === "login" ? "Pick up right where your story left off." : "Create an account and take your voice with you."}</p>
          {authConfigured === false && <div className="notice notice-demo"><span><strong>Account sign-in is not configured.</strong> Add SUPABASE_URL and SUPABASE_KEY to backend/.env, then restart the backend.</span></div>}
          <form onSubmit={handleSubmit} className="auth-form">
            <label className="auth-field"><span>Email address</span><input type="email" required autoComplete="email" placeholder="you@example.com" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
            <label className="auth-field"><span>Password</span><input type="password" required minLength={8} autoComplete={mode === "login" ? "current-password" : "new-password"} placeholder="8 characters or more" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
            {errorMessage && <p role="alert" className="form-error">{errorMessage}</p>}
            <button type="submit" disabled={isSubmitting || authConfigured === false} className="primary-action auth-submit">
              {isSubmitting ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}<ArrowRight size={17} />
            </button>
          </form>
          <p className="auth-switch">{mode === "login" ? "New to ReelLingo?" : "Already have an account?"} <button type="button" onClick={() => setMode(mode === "login" ? "signup" : "login")}>{mode === "login" ? "Create an account" : "Sign in"}</button></p>
          <Link href="/" className="back-home">Back to home</Link>
        </section>
      </main>
    </div>
  );
}
