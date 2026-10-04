import * as Sentry from "@sentry/node";
import cors from "cors";
import express from "express";
import multer from "multer";
import { pinoHttp } from "pino-http";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./src/config.js";
import { closeDatabase, initializeDatabase } from "./src/database.js";
import { generalLimiter } from "./src/http.js";
import { languages } from "./src/languages.js";
import { lipSyncAvailable } from "./src/lipsync.js";
import { logger } from "./src/logger.js";
import { emailConfigured, whatsappConfigured } from "./src/notify.js";
import { billingProviders } from "./src/billing.js";
import { scannerConfigured } from "./src/scan.js";
import { publicSettings, startSettingsRefresh, stopSettingsRefresh } from "./src/settings.js";
import { localPath, STORAGE_LABELS, storageProvider, verifyLocalSignature } from "./src/storage.js";
import { useSpitchVoice } from "./src/spitch.js";
import { tusServer } from "./src/uploads.js";
import { startWorker, stopWorker } from "./src/worker.js";
import { youtubeConfigured } from "./src/youtube.js";
import accountRoutes from "./src/routes/account.js";
import adminRoutes from "./src/routes/admin.js";
import authRoutes from "./src/routes/auth.js";
import billingRoutes, { webhookRouter } from "./src/routes/billing.js";
import jobRoutes from "./src/routes/jobs.js";
import publicRoutes from "./src/routes/public.js";
import reviewRoutes from "./src/routes/reviews.js";
import teamRoutes from "./src/routes/teams.js";

if (config.sentryDsn) {
  Sentry.init({ dsn: config.sentryDsn, environment: process.env.NODE_ENV || "development", tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0) });
}

const app = express();
app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS || 1));
app.disable("x-powered-by");
app.use(pinoHttp({
  logger,
  genReqId: (request) => request.headers["x-request-id"] || randomUUID(),
  autoLogging: { ignore: (request) => request.url === "/health" || request.url.startsWith("/uploads") },
  customLogLevel: (_request, response, error) => (error || response.statusCode >= 500 ? "error" : response.statusCode >= 400 ? "warn" : "info"),
}));

// Resumable uploads handle their own CORS and body streaming, so they're mounted before anything else.
app.all(["/uploads", "/uploads/*"], (request, response) => {
  tusServer.handle(request, response);
});

// The studio website and the separate admin website both call this API.
app.use(cors({ origin: [config.frontendUrl, config.adminUrl], credentials: true, exposedHeaders: ["Content-Disposition", "RateLimit", "RateLimit-Policy"] }));
app.use(generalLimiter);
app.use(webhookRouter);
app.use(express.json({ limit: "2mb" }));

// Local-storage mode: files are served only with a valid, unexpired signature from getSignedUrl.
app.get("/files/*", (request, response) => {
  const key = decodeURIComponent(request.path.slice("/files/".length));
  const download = request.query.download ? String(request.query.download) : "";
  if (!verifyLocalSignature(key, request.query.exp, download, request.query.sig)) {
    response.status(403).json({ detail: "This link has expired." });
    return;
  }
  let path;
  try {
    path = localPath(key);
  } catch {
    response.status(400).json({ detail: "Invalid path." });
    return;
  }
  if (download) response.attachment(download.replace(/["\\]/g, ""));
  response.sendFile(path, (error) => {
    if (error && !response.headersSent) response.status(404).json({ detail: "File not found." });
  });
});

app.get("/health", (_request, response) => {
  response.json({
    status: "ok",
    mode: config.mockMode ? "demo" : "live",
    capabilities: {
      languages: languages.filter((language) => language.code !== "auto").length,
      voiceClone: Boolean(config.elevenlabsApiKey),
      authentication: Boolean(config.supabaseUrl && config.supabaseKey),
      multiSpeaker: Boolean(config.elevenlabsApiKey),
      lipSync: lipSyncAvailable(),
      payments: billingProviders(),
      email: emailConfigured(),
      whatsapp: whatsappConfigured(),
      youtube: youtubeConfigured(),
      // Native Yoruba, Hausa, Igbo and Pidgin voices (Spitch).
      nativeVoices: useSpitchVoice("yo"),
      virusScan: scannerConfigured(),
      worker: config.workerMode,
      storage: STORAGE_LABELS[storageProvider()],
    },
    settings: publicSettings(),
  });
});

app.use(publicRoutes);
app.use(authRoutes);
app.use(jobRoutes);
app.use(accountRoutes);
app.use(billingRoutes);
app.use(teamRoutes);
app.use(reviewRoutes);
app.use(adminRoutes);

app.use((_request, response) => {
  response.status(404).json({ detail: "Not found." });
});

if (config.sentryDsn) Sentry.setupExpressErrorHandler(app);

app.use((error, request, response, _next) => {
  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
    response.status(413).json({ detail: "The file exceeds the 2GB upload limit." });
    return;
  }
  if (error.type === "entity.parse.failed") {
    response.status(400).json({ detail: "The request body isn't valid JSON." });
    return;
  }
  const status = error.status || (error.message?.startsWith("Unsupported file type") ? 400 : 500);
  if (status >= 500) request.log?.error({ err: error }, "Request failed");
  response.status(status).json({ detail: status >= 500 && process.env.NODE_ENV === "production" ? "Internal server error." : error.message || "Internal server error.", ...(error.extra || {}) });
});

export async function startServer() {
  await initializeDatabase();
  startSettingsRefresh();
  if (config.workerMode === "inline") startWorker();
  const server = app.listen(config.port, () => {
    logger.info({ port: config.port, mode: config.mockMode ? "demo" : "live", worker: config.workerMode }, `ReelLingo API listening on http://localhost:${config.port}`);
  });
  const shutdown = async () => {
    server.close();
    // Running jobs aren't awaited: they'll be picked up again from their last saved step after restart.
    stopSettingsRefresh();
    await Promise.race([stopWorker(), new Promise((resolveWait) => setTimeout(resolveWait, 5000))]);
    await closeDatabase();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  return server;
}

export { app };

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void startServer();
}
