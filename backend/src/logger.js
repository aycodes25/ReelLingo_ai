import pino from "pino";
import { config } from "./config.js";

// Structured JSON logs; pipe through `npx pino-pretty` locally for readable output.
export const logger = pino({
  level: process.env.NODE_ENV === "test" || process.env.NODE_TEST_CONTEXT ? "silent" : config.logLevel,
  base: { service: "reellingo-api" },
  redact: ["req.headers.authorization", "req.headers.cookie", "req.headers[\"x-api-key\"]"],
});
