import type {
  AdminJob, AdminOverview, AdminPayment, AdminPlan, AdminSetting, AdminTeam, AdminUserDetail, AdminUserRow, PlanOverrides, ApiHealth, ApiKey, BillingInfo, CreateJobOptions, CreditPack, GlossaryTerm, Job, LanguageOption, Me, Plan,
  SavedVoice, SessionUser, TeamDetail, TeamMember, TeamSummary, TranscriptSegment, Usage, WatchData,
} from "./types";

export const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const TOKEN_KEY = "reellingo_access_token";
const REFRESH_KEY = "reellingo_refresh_token";
const EXPIRES_KEY = "reellingo_expires_at";
const PROFILE_KEY = "reellingo_profile";
const WORKSPACE_KEY = "reellingo_workspace";
const REFERRAL_KEY = "reellingo_referral";

export type OAuthProvider = "google" | "github" | "apple" | "facebook";

export class ApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly data: Record<string, unknown> = {}) {
    super(message);
    this.name = "ApiError";
  }

  get code(): string | undefined {
    return typeof this.data.code === "string" ? this.data.code : undefined;
  }
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function read(key: string): string | null {
  try {
    return storage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) storage()?.removeItem(key);
    else storage()?.setItem(key, value);
  } catch {
    // Private browsing or storage disabled: the session lasts for this page only.
  }
}

// Sessions used to live in sessionStorage; carry an existing one over so nobody is logged out by the upgrade.
function migrateLegacySession(): void {
  try {
    if (typeof window === "undefined" || read(TOKEN_KEY)) return;
    const legacy = window.sessionStorage.getItem(TOKEN_KEY);
    if (legacy) {
      write(TOKEN_KEY, legacy);
      window.sessionStorage.removeItem(TOKEN_KEY);
    }
  } catch {
    // ignore
  }
}

export function getStoredToken(): string | null {
  migrateLegacySession();
  return read(TOKEN_KEY);
}

export function setStoredToken(token: string, refreshToken?: string | null, expiresIn?: number | null): void {
  write(TOKEN_KEY, token);
  if (refreshToken !== undefined) write(REFRESH_KEY, refreshToken);
  if (expiresIn) write(EXPIRES_KEY, String(Date.now() + expiresIn * 1000));
}

export function clearStoredToken(): void {
  for (const key of [TOKEN_KEY, REFRESH_KEY, EXPIRES_KEY, WORKSPACE_KEY]) write(key, null);
}

export function getWorkspace(): string {
  return read(WORKSPACE_KEY) || "personal";
}

export function setWorkspace(workspace: string): void {
  write(WORKSPACE_KEY, workspace === "personal" ? null : workspace);
}

export function rememberReferral(code: string): void {
  if (code) write(REFERRAL_KEY, code.trim().toUpperCase());
}

export function storedReferral(): string | null {
  return read(REFERRAL_KEY);
}

export function clearReferral(): void {
  write(REFERRAL_KEY, null);
}

function readStoredProfile(): Partial<SessionUser> {
  try {
    return JSON.parse(read(PROFILE_KEY) || "{}");
  } catch {
    return {};
  }
}

/** Caches the profile locally so the studio shell renders instantly; the server copy is the source of truth. */
export function saveProfile(profile: Partial<SessionUser>): void {
  const current = readStoredProfile();
  const next = profile.email && current.email && profile.email !== current.email ? profile : { ...current, ...profile };
  write(PROFILE_KEY, JSON.stringify(next));
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
  const name = String((storedMatches && stored.name) || metadata.full_name || metadata.name || email.split("@")[0] || "Creator");
  return { email, name, creatorType: (storedMatches && stored.creatorType) || "" };
}

function tokenExpiresSoon(): boolean {
  const expires = Number(read(EXPIRES_KEY) || 0);
  if (expires) return expires - Date.now() < 60_000;
  const claims = decodeTokenClaims(getStoredToken() || "");
  return typeof claims.exp === "number" ? claims.exp * 1000 - Date.now() < 60_000 : false;
}

let refreshing: Promise<boolean> | null = null;

/** Swaps the refresh token for a new session. Concurrent callers share one request. */
export function refreshSession(): Promise<boolean> {
  const refreshToken = read(REFRESH_KEY);
  if (!refreshToken) return Promise.resolve(false);
  refreshing ||= (async () => {
    try {
      const response = await fetch(`${API_URL}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      if (!response.ok) return false;
      const data = await response.json();
      setStoredToken(data.access_token, data.refresh_token, data.expires_in);
      return true;
    } catch {
      return false;
    } finally {
      setTimeout(() => { refreshing = null; }, 0);
    }
  })();
  return refreshing;
}

export async function authHeaders(includeWorkspace = true): Promise<Record<string, string>> {
  if (getStoredToken() && tokenExpiresSoon()) await refreshSession();
  const token = getStoredToken();
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  const workspace = getWorkspace();
  if (includeWorkspace && workspace !== "personal") headers["X-Workspace"] = workspace;
  return headers;
}

async function toApiError(response: Response, context: string): Promise<ApiError> {
  let message = `${context} (${response.status})`;
  let data: Record<string, unknown> = {};
  try {
    data = await response.json();
    message = String(data.detail || data.message || message);
  } catch {
    // Keep the status-based message when the response is not JSON.
  }
  return new ApiError(message, response.status, data);
}

interface RequestOptions {
  method?: string;
  json?: unknown;
  body?: BodyInit;
  context?: string;
  workspace?: boolean;
  auth?: boolean;
}

/** Authenticated request that refreshes an expired session once and retries. */
export async function request<T>(path: string, { method = "GET", json, body, context = "Request failed", workspace = true, auth = true }: RequestOptions = {}): Promise<T> {
  const send = async () => fetch(`${API_URL}${path}`, {
    method,
    headers: { ...(auth ? await authHeaders(workspace) : {}), ...(json !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: json !== undefined ? JSON.stringify(json) : body,
  });
  let response = await send();
  if (response.status === 401 && auth && await refreshSession()) response = await send();
  if (!response.ok) throw await toApiError(response, context);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

// ---------- Auth ----------
interface AuthResponse {
  user_id: string;
  access_token: string | null;
  refresh_token: string | null;
  expires_in?: number;
  confirmation_required?: boolean;
}

export async function login(email: string, password: string): Promise<AuthResponse> {
  const data = await request<AuthResponse>("/auth/login", { method: "POST", json: { email, password }, auth: false, context: "Login failed" });
  setStoredToken(data.access_token || "", data.refresh_token, data.expires_in);
  saveProfile({ email });
  return data;
}

export async function signup(email: string, password: string, profile: { name: string; creatorType: string }): Promise<AuthResponse> {
  const data = await request<AuthResponse>("/auth/signup", {
    method: "POST",
    json: { email, password, name: profile.name, creator_type: profile.creatorType, referral_code: storedReferral() || undefined },
    auth: false,
    context: "Signup failed",
  });
  if (data.access_token) {
    setStoredToken(data.access_token, data.refresh_token, data.expires_in);
    clearReferral();
  }
  saveProfile({ email, ...profile });
  return data;
}

export async function logout(): Promise<void> {
  try {
    await fetch(`${API_URL}/auth/logout`, { method: "POST", headers: await authHeaders(false) });
  } catch {
    // Signing out locally still works when the API is unreachable.
  }
  clearStoredToken();
}

export function oauthUrl(provider: OAuthProvider): string {
  return `${API_URL}/auth/oauth/${provider}`;
}

// ---------- Account ----------
export async function getMe(): Promise<Me> {
  const me = await request<Me>("/me", { workspace: false, context: "Could not load your account" });
  saveProfile({ email: me.email, name: me.name, creatorType: me.creator_type });
  return me;
}

export function updateMe(changes: Partial<Pick<Me, "name" | "creator_type" | "phone" | "notify_email" | "notify_whatsapp">>): Promise<Me> {
  return request<Me>("/me", { method: "PUT", json: changes, workspace: false, context: "Could not save your profile" });
}

export function applyReferralCode(code: string): Promise<{ applied: boolean }> {
  return request("/me/referral", { method: "POST", json: { code }, workspace: false, context: "Could not apply the referral code" });
}

export function getUsage(): Promise<Usage> {
  return request<Usage>("/usage", { context: "Could not load usage" });
}

// ---------- Uploads & jobs ----------
/** Uploads a file with the tus protocol so interrupted uploads resume instead of starting over. Returns the upload ID. */
export async function uploadResumable(file: File, onProgress: (fraction: number) => void, signal?: AbortSignal): Promise<string> {
  const { Upload } = await import("tus-js-client");
  return new Promise((resolve, reject) => {
    const upload = new Upload(file, {
      endpoint: `${API_URL}/uploads`,
      retryDelays: [0, 1000, 3000, 5000, 10000, 20000],
      chunkSize: 16 * 1024 * 1024,
      removeFingerprintOnSuccess: true,
      metadata: { filename: file.name, filetype: file.type || "application/octet-stream" },
      onBeforeRequest: async (req) => {
        const headers = await authHeaders(false);
        for (const [key, value] of Object.entries(headers)) req.setHeader(key, value);
      },
      onProgress: (sent, total) => onProgress(total ? sent / total : 0),
      onError: (error) => reject(new ApiError(error.message.includes("401") ? "Your session expired. Sign in again." : "The upload failed. Check your connection and try again — it will resume where it stopped.", 0)),
      onSuccess: () => {
        const id = upload.url?.split("/").pop();
        if (id) resolve(id);
        else reject(new ApiError("The upload finished but the server didn't return an ID.", 0));
      },
    });
    signal?.addEventListener("abort", () => {
      void upload.abort();
      reject(new ApiError("Upload cancelled.", 0));
    });
    upload.findPreviousUploads().then((previous) => {
      if (previous.length) upload.resumeFromPreviousUpload(previous[0]);
      upload.start();
    }).catch(() => upload.start());
  });
}

export function createJob(source: { uploadId?: string; sourceUrl?: string }, options: CreateJobOptions): Promise<Job> {
  return request<Job>("/jobs", {
    method: "POST",
    context: "Failed to create job",
    json: {
      upload_id: source.uploadId,
      source_url: source.sourceUrl,
      source_language: options.sourceLanguage,
      target_languages: options.targetLanguages.join(","),
      voice_mode: options.voiceMode,
      voice_id: options.voiceId ?? undefined,
      review: options.review,
      keep_background: options.keepBackground,
      multi_speaker: options.multiSpeaker,
      tone: options.tone,
      captions: options.captions || undefined,
      formats: options.formats.join(","),
      lip_sync: options.lipSync,
      trim_to_fit: options.trimToFit || false,
    },
  });
}

export function getJob(jobId: number): Promise<Job> {
  // Admins open other users' jobs from the admin page with ?admin=1.
  const admin = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("admin") === "1";
  return request<Job>(`/jobs/${jobId}${admin ? "?admin=1" : ""}`, { context: "Failed to fetch job" });
}

export function getJobs(limit?: number, offset = 0): Promise<Job[]> {
  const params = new URLSearchParams();
  if (limit) params.set("limit", String(limit));
  if (offset) params.set("offset", String(offset));
  const query = params.toString() ? `?${params}` : "";
  return request<Job[]>(`/jobs${query}`, { context: "Could not load projects" });
}

/**
 * Follows a job over server-sent events. Resolves when the stream ends; rejects if streaming isn't possible,
 * so callers can fall back to polling.
 */
export async function streamJob(jobId: number, onJob: (job: Job) => void, signal: AbortSignal): Promise<void> {
  const response = await fetch(`${API_URL}/jobs/${jobId}/events`, { headers: await authHeaders(false), signal });
  if (!response.ok || !response.body) throw await toApiError(response, "Live updates unavailable");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = block.split("\n").filter((line) => line.startsWith("data: ")).map((line) => line.slice(6)).join("\n");
      if (data) onJob(JSON.parse(data));
      boundary = buffer.indexOf("\n\n");
    }
  }
}

export function updateSegments(jobId: number, segments: { index: number; text?: string; source_text?: string }[]): Promise<Job> {
  return request<Job>(`/jobs/${jobId}/segments`, { method: "PATCH", json: { segments }, context: "Could not save your edits" });
}

export function retranslateSegment(jobId: number, index: number): Promise<{ index: number; text: string }> {
  return request(`/jobs/${jobId}/segments/${index}/retranslate`, { method: "POST", context: "Could not retranslate the line" });
}

export function approveJob(jobId: number): Promise<Job> {
  return request<Job>(`/jobs/${jobId}/approve`, { method: "POST", context: "Could not start dubbing" });
}

export function redubJob(jobId: number, changes: { captions?: string | null; formats?: string[]; keep_background?: boolean } = {}): Promise<Job> {
  return request<Job>(`/jobs/${jobId}/redub`, {
    method: "POST",
    json: { ...changes, formats: changes.formats ? changes.formats.join(",") : undefined, captions: changes.captions === null ? "" : changes.captions },
    context: "Could not re-dub",
  });
}

export function retryJob(jobId: number, trimToFit = false): Promise<Job> {
  return request<Job>(`/jobs/${jobId}/retry`, { method: "POST", json: { trim_to_fit: trimToFit }, context: "Could not retry" });
}

export function deleteJob(jobId: number): Promise<void> {
  return request<void>(`/jobs/${jobId}`, { method: "DELETE", context: "Could not delete the project" });
}

export function shareJob(jobId: number, enabled: boolean, includeOriginal = true): Promise<Job> {
  return request<Job>(`/jobs/${jobId}/share`, { method: "POST", json: { enabled, include_original: includeOriginal }, context: "Could not update sharing" });
}

export function publishToYoutube(jobId: number, details: { title: string; description: string; tags: string[]; privacy: string; output: string }): Promise<Job> {
  return request<Job>(`/jobs/${jobId}/publish/youtube`, { method: "POST", json: details, context: "Could not publish to YouTube" });
}

// ---------- Catalog ----------
export async function getLanguages(): Promise<LanguageOption[]> {
  return request<LanguageOption[]>("/languages", { auth: false, context: "Could not load languages" });
}

export async function getApiHealth(): Promise<ApiHealth> {
  return request<ApiHealth>("/health", { auth: false, context: "Could not check API status" });
}

export function getPlans(): Promise<{ plans: Plan[]; packs: CreditPack[]; providers: { paystack: boolean; stripe: boolean } }> {
  return request("/plans", { auth: false, context: "Could not load plans" });
}

export function getWatch(slug: string): Promise<WatchData> {
  return request<WatchData>(`/public/watch/${encodeURIComponent(slug)}`, { auth: false, context: "Video not found" });
}

// ---------- Billing ----------
export function getBilling(): Promise<BillingInfo> {
  return request<BillingInfo>("/billing", { context: "Could not load billing" });
}

export function startCheckout(provider: "paystack" | "stripe", choice: { plan?: string; pack?: string }): Promise<{ url: string; reference: string }> {
  return request("/billing/checkout", { method: "POST", json: { provider, ...choice }, context: "Could not start checkout" });
}

export function verifyCheckout(provider: string, reference: string | null, sessionId: string | null): Promise<{ status: string }> {
  return request("/billing/verify", { method: "POST", json: { provider, reference, session_id: sessionId }, context: "Could not confirm payment" });
}

export function cancelPlan(): Promise<{ canceled: boolean }> {
  return request("/billing/cancel", { method: "POST", context: "Could not cancel" });
}

// ---------- Glossary, voices, keys, integrations ----------
export function getGlossary(): Promise<GlossaryTerm[]> {
  return request("/glossary", { workspace: false, context: "Could not load your glossary" });
}

export function addGlossaryTerm(term: Omit<GlossaryTerm, "id">): Promise<GlossaryTerm[]> {
  return request("/glossary", { method: "POST", json: term, workspace: false, context: "Could not add the term" });
}

export function updateGlossaryTerm(term: GlossaryTerm): Promise<GlossaryTerm[]> {
  return request(`/glossary/${term.id}`, { method: "PUT", json: term, workspace: false, context: "Could not save the term" });
}

export function deleteGlossaryTerm(id: number): Promise<GlossaryTerm[]> {
  return request(`/glossary/${id}`, { method: "DELETE", workspace: false, context: "Could not delete the term" });
}

export function getVoices(): Promise<{ voices: SavedVoice[]; limit: number; available: boolean }> {
  return request("/voices", { workspace: false, context: "Could not load saved voices" });
}

export function saveVoiceFromJob(jobId: number, name: string, speaker?: string): Promise<{ voices: SavedVoice[] }> {
  return request("/voices", { method: "POST", json: { job_id: jobId, name, speaker, consent: true }, workspace: false, context: "Could not save the voice" });
}

export function saveVoiceFromSample(file: File, name: string): Promise<{ voices: SavedVoice[] }> {
  const form = new FormData();
  form.append("sample", file);
  form.append("name", name);
  form.append("consent", "true");
  return request("/voices", { method: "POST", body: form, workspace: false, context: "Could not save the voice" });
}

export function deleteVoice(id: number): Promise<{ voices: SavedVoice[] }> {
  return request(`/voices/${id}`, { method: "DELETE", workspace: false, context: "Could not delete the voice" });
}

export function getApiKeys(): Promise<{ keys: ApiKey[]; available: boolean }> {
  return request("/api-keys", { workspace: false, context: "Could not load API keys" });
}

export function createApiKeyRequest(name: string): Promise<ApiKey> {
  return request("/api-keys", { method: "POST", json: { name }, workspace: false, context: "Could not create the key" });
}

export function revokeApiKey(id: number): Promise<void> {
  return request(`/api-keys/${id}`, { method: "DELETE", workspace: false, context: "Could not revoke the key" });
}

export function getIntegrations(): Promise<{ youtube: { configured: boolean; connected: boolean; channel: string | null } }> {
  return request("/integrations", { workspace: false, context: "Could not load integrations" });
}

export function connectYoutube(): Promise<{ url: string }> {
  return request("/integrations/youtube/connect", { method: "POST", workspace: false, context: "Could not connect YouTube" });
}

export function disconnectYoutube(): Promise<void> {
  return request("/integrations/youtube", { method: "DELETE", workspace: false, context: "Could not disconnect YouTube" });
}

// ---------- Teams ----------
export function getTeams(): Promise<TeamSummary[]> {
  return request("/teams", { workspace: false, context: "Could not load teams" });
}

export function createTeam(name: string): Promise<TeamSummary> {
  return request("/teams", { method: "POST", json: { name }, workspace: false, context: "Could not create the team" });
}

export function getTeam(id: number): Promise<TeamDetail> {
  return request(`/teams/${id}`, { workspace: false, context: "Could not load the team" });
}

export function inviteTeamMember(id: number, email: string, role: string): Promise<TeamMember[]> {
  return request(`/teams/${id}/invites`, { method: "POST", json: { email, role }, workspace: false, context: "Could not send the invite" });
}

export function acceptTeamInvite(id: number): Promise<unknown> {
  return request(`/teams/${id}/accept`, { method: "POST", workspace: false, context: "Could not join the team" });
}

export function setTeamMemberRole(id: number, memberId: number, role: string): Promise<TeamMember[]> {
  return request(`/teams/${id}/members/${memberId}`, { method: "PATCH", json: { role }, workspace: false, context: "Could not change the role" });
}

export function removeTeamMember(id: number, memberId: number): Promise<TeamMember[]> {
  return request(`/teams/${id}/members/${memberId}`, { method: "DELETE", workspace: false, context: "Could not remove the member" });
}

// ---------- Admin ----------
export function getAdminOverview(days = 30): Promise<AdminOverview> {
  return request(`/admin/overview?days=${days}`, { workspace: false, context: "Could not load the admin overview" });
}

export function getAdminJobs(status = ""): Promise<AdminJob[]> {
  return request(`/admin/jobs?limit=50${status ? `&status=${status}` : ""}`, { workspace: false, context: "Could not load jobs" });
}

export function adminRetryJob(id: number): Promise<Job> {
  return request(`/admin/jobs/${id}/retry`, { method: "POST", workspace: false, context: "Could not retry" });
}

export function adminGrantCredit(billingId: string, maxMinutes: number): Promise<unknown> {
  return request("/admin/credits", { method: "POST", json: { billing_id: billingId, max_minutes: maxMinutes }, workspace: false, context: "Could not grant the credit" });
}

export function adminSetPlan(billingId: string, plan: string, months: number): Promise<unknown> {
  return request("/admin/subscriptions", { method: "POST", json: { billing_id: billingId, plan, months }, workspace: false, context: "Could not set the plan" });
}

export function adminDeleteJob(id: number): Promise<void> {
  return request(`/admin/jobs/${id}`, { method: "DELETE", workspace: false, context: "Could not delete the job" });
}

export function getAdminUsers(params: { q?: string; plan?: string; status?: string; page?: number; sync?: boolean } = {}): Promise<{ users: AdminUserRow[]; total: number; page: number; per_page: number }> {
  const query = new URLSearchParams();
  if (params.q) query.set("q", params.q);
  if (params.plan) query.set("plan", params.plan);
  if (params.status) query.set("status", params.status);
  if (params.page) query.set("page", String(params.page));
  if (params.sync) query.set("sync", "1");
  return request(`/admin/users?${query}`, { workspace: false, context: "Could not load users" });
}

export function getAdminUser(id: string): Promise<AdminUserDetail> {
  return request(`/admin/users/${encodeURIComponent(id)}`, { workspace: false, context: "Could not load the user" });
}

export function adminCreateUser(input: { email: string; name?: string; password?: string; plan?: string; months?: number; invite?: boolean }): Promise<{ user: AdminUserDetail; temporary_password: string | null; invited: boolean }> {
  return request("/admin/users", { method: "POST", json: input, workspace: false, context: "Could not create the account" });
}

export function adminUpdateUser(id: string, changes: Partial<{ name: string; phone: string; creator_type: string; admin_notes: string; is_admin: boolean; disabled: boolean; plan: string; months: number; no_expiry: boolean; overrides: PlanOverrides | null }>): Promise<AdminUserDetail> {
  return request(`/admin/users/${encodeURIComponent(id)}`, { method: "PATCH", json: changes, workspace: false, context: "Could not update the user" });
}

export function adminDeleteUser(id: string): Promise<{ deleted: boolean }> {
  return request(`/admin/users/${encodeURIComponent(id)}`, { method: "DELETE", workspace: false, context: "Could not delete the user" });
}

export function adminGrantUserCredits(id: string, maxMinutes: number, count: number): Promise<AdminUserDetail> {
  return request(`/admin/users/${encodeURIComponent(id)}/credits`, { method: "POST", json: { max_minutes: maxMinutes, count }, workspace: false, context: "Could not grant credits" });
}

export function adminRevokeCredit(creditId: number): Promise<void> {
  return request(`/admin/credits/${creditId}`, { method: "DELETE", workspace: false, context: "Could not remove the credit" });
}

export function adminEmailUser(id: string, subject: string, message: string): Promise<{ sent: boolean }> {
  return request(`/admin/users/${encodeURIComponent(id)}/email`, { method: "POST", json: { subject, message }, workspace: false, context: "Could not send the email" });
}

export function getAdminPlans(): Promise<{ plans: AdminPlan[]; permissions: Record<string, string>; max_video_minutes: number }> {
  return request("/admin/plans", { workspace: false, context: "Could not load plans" });
}

export function adminCreatePlan(plan: Partial<Plan> & { code: string }): Promise<Plan> {
  return request("/admin/plans", { method: "POST", json: plan, workspace: false, context: "Could not create the plan" });
}

export function adminUpdatePlan(code: string, plan: Partial<Plan>): Promise<Plan> {
  return request(`/admin/plans/${encodeURIComponent(code)}`, { method: "PUT", json: plan, workspace: false, context: "Could not save the plan" });
}

export function adminDeletePlan(code: string, moveTo: string): Promise<{ moved: number }> {
  return request(`/admin/plans/${encodeURIComponent(code)}?move_to=${encodeURIComponent(moveTo)}`, { method: "DELETE", workspace: false, context: "Could not delete the plan" });
}

export function getAdminSettings(): Promise<AdminSetting[]> {
  return request("/admin/settings", { workspace: false, context: "Could not load settings" });
}

export function adminUpdateSettings(changes: Record<string, unknown>): Promise<AdminSetting[]> {
  return request("/admin/settings", { method: "PUT", json: changes, workspace: false, context: "Could not save settings" });
}

export function getAdminTeams(): Promise<AdminTeam[]> {
  return request("/admin/teams", { workspace: false, context: "Could not load teams" });
}

export function adminDeleteTeam(id: number): Promise<void> {
  return request(`/admin/teams/${id}`, { method: "DELETE", workspace: false, context: "Could not delete the team" });
}

export function getAdminPayments(status = ""): Promise<AdminPayment[]> {
  return request(`/admin/payments${status ? `?status=${status}` : ""}`, { workspace: false, context: "Could not load payments" });
}

export type { TranscriptSegment };
