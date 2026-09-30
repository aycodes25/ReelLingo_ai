import { createHash, randomBytes } from "node:crypto";
import { config } from "./config.js";
import { dbTime, many, one, query } from "./db.js";

const DEMO_USER = { id: "local-user", email: "creator@localhost" };
const DEMO_SESSION = { user_id: DEMO_USER.id, access_token: "local-demo-token", refresh_token: "local-demo-refresh", expires_in: 86400 * 365 };
const USER_CACHE_MS = 30_000;
const userCache = new Map();

function authUrl(path) {
  return `${config.supabaseUrl}/auth/v1${path}`;
}

function authHeaders(token) {
  return {
    apikey: config.supabaseKey,
    Authorization: token ? `Bearer ${token}` : `Bearer ${config.supabaseKey}`,
    "Content-Type": "application/json",
  };
}

function hasSupabaseAuth() {
  return Boolean(config.supabaseUrl && config.supabaseKey);
}

function session(data) {
  return {
    user_id: data.user.id,
    email: data.user.email || "",
    access_token: data.access_token,
    refresh_token: data.refresh_token || null,
    expires_in: Number(data.expires_in || 3600),
  };
}

export async function signup(email, password) {
  if (!hasSupabaseAuth()) {
    if (config.mockMode) return { ...DEMO_SESSION, email };
    throw new Error("Supabase auth is not configured.");
  }
  const response = await fetch(authUrl("/signup"), {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ email, password }),
  });
  const data = await response.json();
  if (!response.ok || !data.user?.id) throw new Error(data.msg || data.message || data.error_description || "Signup failed.");
  if (!data.access_token) {
    // Email confirmation is enabled in Supabase: the account exists but has no session yet.
    return { user_id: data.user.id, email, access_token: null, refresh_token: null, confirmation_required: true };
  }
  return session(data);
}

export async function login(email, password) {
  if (!hasSupabaseAuth()) {
    if (config.mockMode) return { ...DEMO_SESSION, email };
    throw new Error("Supabase auth is not configured.");
  }
  const response = await fetch(authUrl("/token?grant_type=password"), {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ email, password }),
  });
  const data = await response.json();
  if (!response.ok || !data.user?.id || !data.access_token) throw new Error("Invalid email or password.");
  return session(data);
}

/** Exchanges a refresh token for a new session so creators stay signed in during long jobs. */
export async function refreshSession(refreshToken) {
  if (!refreshToken) throw new Error("Missing refresh token.");
  if (!hasSupabaseAuth()) {
    if (config.mockMode && refreshToken === DEMO_SESSION.refresh_token) return DEMO_SESSION;
    throw new Error("Session expired. Sign in again.");
  }
  const response = await fetch(authUrl("/token?grant_type=refresh_token"), {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  const data = await response.json();
  if (!response.ok || !data.access_token || !data.user?.id) throw new Error("Session expired. Sign in again.");
  return session(data);
}

export const API_KEY_PREFIX = "rlk_";

export function hashApiKey(key) {
  return createHash("sha256").update(key).digest("hex");
}

export async function createApiKey(userId, name) {
  const secret = `${API_KEY_PREFIX}${randomBytes(24).toString("base64url")}`;
  const row = await one(
    "INSERT INTO api_keys (user_id, name, prefix, key_hash) VALUES ($1, $2, $3, $4) RETURNING *",
    [userId, String(name || "API key").slice(0, 60), secret.slice(0, 12), hashApiKey(secret)],
  );
  return { id: Number(row.id), name: row.name, prefix: row.prefix, created_at: row.created_at, key: secret };
}

export async function listApiKeys(userId) {
  return (await many("SELECT id, name, prefix, created_at, last_used_at FROM api_keys WHERE user_id = $1 AND revoked_at IS NULL ORDER BY id DESC", [userId]))
    .map((row) => ({ ...row, id: Number(row.id) }));
}

export async function revokeApiKey(userId, id) {
  return (await query("UPDATE api_keys SET revoked_at = $1 WHERE id = $2 AND user_id = $3 AND revoked_at IS NULL", [dbTime(), id, userId])).rowCount > 0;
}

async function userFromApiKey(key) {
  const row = await one(
    "SELECT api_keys.id, api_keys.user_id, profiles.email FROM api_keys LEFT JOIN profiles ON profiles.user_id = api_keys.user_id WHERE key_hash = $1 AND revoked_at IS NULL",
    [hashApiKey(key)],
  );
  if (!row) return null;
  void query("UPDATE api_keys SET last_used_at = $1 WHERE id = $2", [dbTime(), row.id]).catch(() => undefined);
  return { id: row.user_id, email: row.email || "", viaApiKey: true };
}

/** Resolves a request's credentials (Bearer session token, Bearer API key, or X-API-Key) to a user. */
export async function getCurrentUser(authorization, apiKeyHeader) {
  const token = apiKeyHeader || (authorization?.startsWith("Bearer ") ? authorization.slice(7) : "");
  if (!token) return null;
  if (token.startsWith(API_KEY_PREFIX)) return userFromApiKey(token);
  if (!hasSupabaseAuth()) {
    return config.mockMode && token === DEMO_SESSION.access_token ? DEMO_USER : null;
  }
  const cached = userCache.get(token);
  if (cached && cached.expires > Date.now()) return cached.user;
  const response = await fetch(authUrl("/user"), { headers: authHeaders(token) });
  if (!response.ok) return null;
  const data = await response.json();
  if (!data.id) return null;
  const user = { id: data.id, email: data.email || "", metadata: data.user_metadata || {} };
  userCache.set(token, { user, expires: Date.now() + USER_CACHE_MS });
  if (userCache.size > 5000) userCache.delete(userCache.keys().next().value);
  return user;
}

export async function getCurrentUserId(authorization) {
  return (await getCurrentUser(authorization))?.id || null;
}

export async function logout(authorization) {
  const token = authorization?.slice(7);
  if (token) userCache.delete(token);
  if (!hasSupabaseAuth() || !authorization) return;
  await fetch(authUrl("/logout"), { method: "POST", headers: authHeaders(token) });
}
