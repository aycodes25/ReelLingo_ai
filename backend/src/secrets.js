import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { config } from "./config.js";

const key = createHash("sha256").update(`encryption:${config.appSecret}`).digest();

/** Encrypts integration tokens (e.g. YouTube refresh tokens) before they are stored. */
export function encrypt(value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((part) => part.toString("base64url")).join(".");
}

export function decrypt(payload) {
  const [iv, tag, data] = String(payload).split(".").map((part) => Buffer.from(part, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8"));
}

/** Short-lived signed token, used as OAuth `state` so callbacks can't be forged or replayed later. */
export function signState(payload, ttlSeconds = 900) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds, nonce: randomBytes(6).toString("hex") })).toString("base64url");
  const signature = createHmac("sha256", config.appSecret).update(body).digest("base64url");
  return `${body}.${signature}`;
}

export function verifyState(token) {
  const [body, signature] = String(token || "").split(".");
  if (!body || !signature) return null;
  const expected = Buffer.from(createHmac("sha256", config.appSecret).update(body).digest("base64url"));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  return payload.exp >= Math.floor(Date.now() / 1000) ? payload : null;
}
