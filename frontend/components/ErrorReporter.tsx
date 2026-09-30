"use client";

import { useEffect } from "react";
import { initMonitoring } from "@/lib/monitoring";

export default function ErrorReporter() {
  useEffect(() => {
    void initMonitoring();
  }, []);
  return null;
}
