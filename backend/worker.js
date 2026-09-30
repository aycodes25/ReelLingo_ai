import { config } from "./src/config.js";
import { closeDatabase, initializeDatabase } from "./src/database.js";
import { logger } from "./src/logger.js";
import { startSettingsRefresh } from "./src/settings.js";
import { startWorker, stopWorker } from "./src/worker.js";

// Standalone worker: run with WORKER_MODE=off on the API so processing scales separately from web traffic.
await initializeDatabase();
startWorker();
startSettingsRefresh();
logger.info({ concurrency: config.workerConcurrency }, "ReelLingo worker running");

const shutdown = async () => {
  await Promise.race([stopWorker(), new Promise((resolve) => setTimeout(resolve, 10000))]);
  await closeDatabase();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
