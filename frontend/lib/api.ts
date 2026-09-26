import type { ApiHealth, Job, LanguageOption } from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const TOKEN_STORAGE_KEY = "reellingo_access_token";

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
  return data;
}

export async function signup(email: string, password: string): Promise<AuthResponse> {
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
  return data;
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

export async function getJobs(): Promise<Job[]> {
  const response = await fetch(`${API_URL}/jobs`, { headers: authHeaders() });
  if (!response.ok) await throwResponseError(response, "Could not load projects");
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
