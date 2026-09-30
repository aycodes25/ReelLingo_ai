"use client";

import { useState, type ReactNode } from "react";
import { Apple, Chrome, Eye, EyeOff, Facebook, Github, LockKeyhole } from "lucide-react";
import { oauthUrl, type OAuthProvider } from "@/lib/api";

const PROVIDERS: Record<OAuthProvider, { label: string; icon: ReactNode }> = {
  google: { label: "Google", icon: <Chrome size={18} color="#4285f4" /> },
  github: { label: "GitHub", icon: <Github size={18} /> },
  apple: { label: "Apple", icon: <Apple size={18} /> },
  facebook: { label: "Facebook", icon: <Facebook size={18} color="#1877f2" /> },
};

export function OAuthButtons({ providers }: { providers: OAuthProvider[] }) {
  return (
    <div className="oauth-row">
      {providers.map((provider) => (
        <a key={provider} href={oauthUrl(provider)} className="oauth-btn">
          {PROVIDERS[provider].icon}
          {PROVIDERS[provider].label}
        </a>
      ))}
    </div>
  );
}

interface PasswordFieldProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
}

export function PasswordInput({ id, value, onChange, autoComplete }: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="input-wrap">
      <LockKeyhole size={17} />
      <input
        id={id}
        className="input"
        type={visible ? "text" : "password"}
        required
        minLength={8}
        autoComplete={autoComplete}
        placeholder="••••••••"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <button type="button" className="input-toggle" onClick={() => setVisible(!visible)} aria-label={visible ? "Hide password" : "Show password"}>
        {visible ? <EyeOff size={17} /> : <Eye size={17} />}
      </button>
    </div>
  );
}
