import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Socket } from "node:net";
import { config } from "./config.js";
import { logger } from "./logger.js";

export function scannerConfigured() {
  return Boolean(config.clamavHost);
}

/**
 * Streams a file to ClamAV's clamd using the INSTREAM protocol. Returns { clean, signature }.
 * Only the first CLAMAV_MAX_BYTES are scanned (clamd's StreamMaxLength must be at least as large).
 */
export async function scanFile(path) {
  if (!scannerConfigured()) return { clean: true, skipped: true };
  const size = (await stat(path)).size;
  const limit = Math.min(size, config.clamavMaxBytes);
  return new Promise((resolve, reject) => {
    const socket = new Socket();
    let reply = "";
    const timer = setTimeout(() => socket.destroy(new Error("Virus scan timed out.")), 5 * 60 * 1000);
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => { reply += chunk; });
    socket.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    socket.on("close", () => {
      clearTimeout(timer);
      const text = reply.replace(/\0/g, "").trim();
      if (/OK$/.test(text)) resolve({ clean: true });
      else if (/FOUND$/.test(text)) resolve({ clean: false, signature: text.replace(/^stream:\s*/, "").replace(/\s*FOUND$/, "") });
      else reject(new Error(`Unexpected virus scanner reply: ${text || "(empty)"}`));
    });
    socket.connect(config.clamavPort, config.clamavHost, () => {
      socket.write("zINSTREAM\0");
      const stream = createReadStream(path, { end: Math.max(0, limit - 1), highWaterMark: 64 * 1024 });
      stream.on("data", (chunk) => {
        const header = Buffer.alloc(4);
        header.writeUInt32BE(chunk.length, 0);
        if (!socket.write(Buffer.concat([header, chunk]))) {
          stream.pause();
          socket.once("drain", () => stream.resume());
        }
      });
      stream.on("end", () => socket.end(Buffer.alloc(4)));
      stream.on("error", (error) => socket.destroy(error));
    });
  }).catch((error) => {
    logger.error({ err: error }, "Virus scan failed");
    throw new Error("The upload could not be virus-scanned right now. Please try again shortly.");
  });
}
