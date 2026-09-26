import { config } from "./config.js";

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

export async function signup(email, password) {
  if (!config.supabaseUrl || !config.supabaseKey) {
    if (config.mockMode) return { user_id: "local-user", access_token: "local-demo-token" };
    throw new Error("Supabase auth is not configured.");
  }
  const response = await fetch(authUrl("/signup"), {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ email, password }),
  });
  const data = await response.json();
  if (!response.ok || !data.user?.id || !data.access_token) throw new Error(data.msg || data.message || "Signup failed.");
  return { user_id: data.user.id, access_token: data.access_token };
}

export async function login(email, password) {
  if (!config.supabaseUrl || !config.supabaseKey) {
    if (config.mockMode) return { user_id: "local-user", access_token: "local-demo-token" };
    throw new Error("Supabase auth is not configured.");
  }
  const response = await fetch(authUrl("/token?grant_type=password"), {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ email, password }),
  });
  const data = await response.json();
  if (!response.ok || !data.user?.id || !data.access_token) throw new Error("Invalid email or password.");
  return { user_id: data.user.id, access_token: data.access_token };
}

export async function getCurrentUserId(authorization) {
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) return null;
  if (!config.supabaseUrl || !config.supabaseKey) {
    return config.mockMode && token === "local-demo-token" ? "local-user" : null;
  }
  const response = await fetch(authUrl("/user"), { headers: authHeaders(token) });
  if (!response.ok) return null;
  const user = await response.json();
  return user.id || null;
}

export async function logout(authorization) {
  if (!config.supabaseUrl || !config.supabaseKey || !authorization) return;
  await fetch(authUrl("/logout"), { method: "POST", headers: authHeaders(authorization.slice(7)) });
}