import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ReelLingo",
  description: "AI Video Translator & Dubber for African Creators",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-[#0A0A0A] text-white">{children}</body>
    </html>
  );
}
