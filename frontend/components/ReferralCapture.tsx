"use client";

import { useEffect } from "react";
import { rememberReferral } from "@/lib/api";

/** Remembers a ?ref=CODE from any landing link so it's applied when the visitor signs up (email or social). */
export default function ReferralCapture() {
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("ref");
    if (code && /^[A-Za-z0-9]{4,12}$/.test(code)) rememberReferral(code);
  }, []);
  return null;
}
