import Link from "next/link";
import { Languages } from "lucide-react";

type Variant = "app" | "landing" | "footer" | "auth" | "signup" | "ink";

const VARIANTS: Record<Variant, { mark: string; text: string }> = {
  app: { mark: "is-square", text: "on-dark" },
  auth: { mark: "is-square is-light", text: "on-dark" },
  signup: { mark: "is-square is-light", text: "is-coral" },
  landing: { mark: "is-circle", text: "is-ink" },
  footer: { mark: "is-gold", text: "is-gold" },
  ink: { mark: "is-circle", text: "is-ink" },
};

export default function BrandLogo({ variant = "app", href = "/", size = 34 }: { variant?: Variant; href?: string; size?: number }) {
  const style = VARIANTS[variant];
  return (
    <Link href={href} className={`brand ${style.text}`} aria-label="ReelLingo home">
      <span className={`brand-mark ${style.mark}`} style={{ width: size, height: size }}>
        <Languages size={Math.round(size * 0.56)} strokeWidth={2.2} />
      </span>
      <span>ReelLingo</span>
    </Link>
  );
}
