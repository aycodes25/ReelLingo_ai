"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";
import { saveProfile, setStoredToken, getSessionUser } from "@/lib/api";

// Supabase returns OAuth sessions in the URL fragment: #access_token=...&refresh_token=...
export default function AuthCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const query = new URLSearchParams(window.location.search);
    const accessToken = fragment.get("access_token");
    if (!accessToken) {
      const reason = fragment.get("error_description") || query.get("error_description") || "Sign-in was cancelled.";
      router.replace(`/login?error=oauth_failed&error_description=${encodeURIComponent(reason)}`);
      return;
    }
    setStoredToken(accessToken);
    const user = getSessionUser();
    saveProfile({ email: user.email, name: user.name });
    router.replace("/dashboard");
  }, [router]);

  return (
    <main className="center-state" style={{ minHeight: "80vh", alignContent: "center" }}>
      <span><LoaderCircle size={26} className="spin" /></span>
      <h1>Signing you in…</h1>
      <p>Hang tight while we open your studio.</p>
    </main>
  );
}
