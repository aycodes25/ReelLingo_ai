const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN || "";
let started = false;

/** Starts browser error tracking once, only when a Sentry DSN is configured. */
export async function initMonitoring(): Promise<void> {
  if (!DSN || started || typeof window === "undefined") return;
  started = true;
  const Sentry = await import("@sentry/browser");
  Sentry.init({
    dsn: DSN,
    environment: process.env.NODE_ENV,
    tracesSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE || 0),
    // Access tokens live in request headers, never in URLs, but scrub query strings from breadcrumbs anyway.
    beforeBreadcrumb(breadcrumb) {
      if (breadcrumb.data?.url) breadcrumb.data.url = String(breadcrumb.data.url).split("?")[0];
      return breadcrumb;
    },
  });
}

export async function reportError(error: unknown, context?: Record<string, unknown>): Promise<void> {
  if (!DSN || typeof window === "undefined") return;
  await initMonitoring();
  const Sentry = await import("@sentry/browser");
  Sentry.captureException(error, context ? { extra: context } : undefined);
}
