"use client";

import { useEffect } from "react";
import { reportError } from "@/lib/monitoring";

// Replaces the root layout when the layout itself fails, so it carries its own <html> and minimal styling.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    void reportError(error, { digest: error.digest, scope: "global" });
  }, [error]);

  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", display: "grid", placeItems: "center", minHeight: "100vh", margin: 0, background: "#faf9f6", color: "#16124f" }}>
        <div style={{ textAlign: "center", padding: 24 }}>
          <h1>ReelLingo hit an unexpected error</h1>
          <p>Please reload the page. If it keeps happening, contact support.</p>
          <button type="button" onClick={reset} style={{ padding: "10px 20px", borderRadius: 10, border: 0, background: "#2e2c90", color: "#fff", fontWeight: 600, cursor: "pointer" }}>Reload</button>
        </div>
      </body>
    </html>
  );
}
