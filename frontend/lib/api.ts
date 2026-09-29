import type { ApiHealth, Job, LanguageOption, SessionUser, Usage } from "./types";

export const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const TOKEN_STORAGE_KEY = "reellingo_access_token";
const PROFILE_STORAGE_KEY = "reellingo_profile";

export type OAuthProvider = "google" | "github" | "apple";

export class ApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

export function getStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return sessionStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string): void {
  try {
    sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
  } catch {
    // ignore storage errors (e.g. private browsing)
  }
}

export function clearStoredToken(): void {
  try {
    sessionStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // ignore
  }
}

function readStoredProfile(): Partial<SessionUser> {
  try {
    return JSON.parse(localStorage.getItem(PROFILE_STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

// Name and creator type are only collected by our signup form, so they live in the browser.
export function saveProfile(profile: Partial<SessionUser>): void {
  try {
    const current = readStoredProfile();
    const next = profile.email && current.email && profile.email !== current.email ? profile : { ...current, ...profile };
    localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

function decodeTokenClaims(token: string): Record<string, unknown> {
  try {
    const payload = token.split(".")[1];
    if (!payload) return {};
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(decodeURIComponent(Array.from(json, (char) => `%${char.charCodeAt(0).toString(16).padStart(2, "0")}`).join("")));
  } catch {
    return {};
  }
}

export function getSessionUser(): SessionUser {
  const token = getStoredToken() || "";
  const claims = decodeTokenClaims(token);
  const metadata = (claims.user_metadata || {}) as Record<string, unknown>;
  const stored = readStoredProfile();
  const email = String(claims.email || stored.email || "");
  const storedMatches = !stored.email || stored.email === email;
  const name = String(metadata.full_name || metadata.name || (storedMatches && stored.name) || email.split("@")[0] || "Creator");
  return { email, name, creatorType: (storedMatches && stored.creatorType) || "" };
}

function authHeaders(): HeadersInit {
  const token = getStoredToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function throwResponseError(response: Response, context: string): Promise<never> {
  let message = `${context} (${response.status})`;
  try {
    const body = await response.json();
    message = body.detail || body.message || message;
  } catch {
    // Keep the status-based message when the response is not JSON.
  }
  throw new ApiError(message, response.status);
}

interface AuthResponse {
  user_id: string;
  access_token: string;
}

export async function login(email: string, password: string): Promise<AuthResponse> {
  const response = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) {
    await throwResponseError(response, "Login failed");
  }
  const data: AuthResponse = await response.json();
  setStoredToken(data.access_token);
  saveProfile({ email });
  return data;
}

export async function signup(email: string, password: string, profile: { name: string; creatorType: string }): Promise<AuthResponse> {
  const response = await fetch(`${API_URL}/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) {
    await throwResponseError(response, "Signup failed");
  }
  const data: AuthResponse = await response.json();
  setStoredToken(data.access_token);
  saveProfile({ email, ...profile });
  return data;
}

export async function logout(): Promise<void> {
  try {
    await fetch(`${API_URL}/auth/logout`, { method: "POST", headers: authHeaders() });
  } catch {
    // Signing out locally still works when the API is unreachable.
  }
  clearStoredToken();
}

export function oauthUrl(provider: OAuthProvider): string {
  return `${API_URL}/auth/oauth/${provider}`;
}

export async function createJob(
  file: File,
  sourceLanguage: string,
  targetLanguage: string,
  voiceClone: boolean
): Promise<Job> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("source_language", sourceLanguage);
  formData.append("target_language", targetLanguage);
  formData.append("voice_clone", String(voiceClone));

  const response = await fetch(`${API_URL}/jobs`, {
    method: "POST",
    headers: authHeaders(),
    body: formData,
  });

  if (!response.ok) {
    await throwResponseError(response, "Failed to create job");
  }

  return response.json();
}

export async function getJob(jobId: number): Promise<Job> {
  const response = await fetch(`${API_URL}/jobs/${jobId}`, { headers: authHeaders() });
  if (!response.ok) {
    await throwResponseError(response, "Failed to fetch job");
  }
  return response.json();
}

export async function getJobs(limit?: number): Promise<Job[]> {
  const query = limit ? `?limit=${limit}` : "";
  const response = await fetch(`${API_URL}/jobs${query}`, { headers: authHeaders() });
  if (!response.ok) await throwResponseError(response, "Could not load projects");
  return response.json();
}

export async function getUsage(): Promise<Usage> {
  const response = await fetch(`${API_URL}/usage`, { headers: authHeaders() });
  if (!response.ok) await throwResponseError(response, "Could not load usage");
  return response.json();
}

export async function getLanguages(): Promise<LanguageOption[]> {
  const response = await fetch(`${API_URL}/languages`);
  if (!response.ok) await throwResponseError(response, "Could not load languages");
  return response.json();
}

export async function getApiHealth(): Promise<ApiHealth> {
  const response = await fetch(`${API_URL}/health`);
  if (!response.ok) await throwResponseError(response, "Could not check API status");
  return response.json();
}
