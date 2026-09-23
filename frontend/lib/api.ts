import type { Job } from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const TOKEN_STORAGE_KEY = "reellingo_access_token";

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
    throw new Error(`Login failed: ${response.status}`);
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
    throw new Error(`Signup failed: ${response.status}`);
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
    throw new Error(`Failed to create job: ${response.status}`);
  }

  return response.json();
}

export async function getJob(jobId: number): Promise<Job> {
  const response = await fetch(`${API_URL}/jobs/${jobId}`, { headers: authHeaders() });
  if (!response.ok) {
    throw new Error(`Failed to fetch job: ${response.status}`);
  }
  return response.json();
}
