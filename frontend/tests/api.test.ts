import { describe, expect, it, vi } from "vitest";
import { ApiError, getJobs, getStoredToken, login, request, setStoredToken, setWorkspace } from "@/lib/api";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("API client", () => {
  it("keeps the session across tabs and stores the refresh token", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ user_id: "u1", access_token: "access-1", refresh_token: "refresh-1", expires_in: 3600 }));
    await login("creator@example.com", "password123");
    expect(localStorage.getItem("reellingo_access_token")).toBe("access-1");
    expect(localStorage.getItem("reellingo_refresh_token")).toBe("refresh-1");
  });

  it("moves an old sessionStorage token to persistent storage", () => {
    sessionStorage.setItem("reellingo_access_token", "legacy");
    expect(getStoredToken()).toBe("legacy");
    expect(sessionStorage.getItem("reellingo_access_token")).toBeNull();
  });

  it("refreshes an expired session once and retries the request", async () => {
    setStoredToken("expired", "refresh-1", 3600);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const href = String(url);
      const auth = new Headers(init?.headers).get("Authorization");
      if (href.endsWith("/auth/refresh")) return json({ access_token: "fresh", refresh_token: "refresh-2", expires_in: 3600 });
      return auth === "Bearer fresh" ? json([{ id: 1 }]) : json({ detail: "Sign in to continue." }, 401);
    });
    const jobs = await getJobs();
    expect(jobs).toEqual([{ id: 1 }]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(getStoredToken()).toBe("fresh");
  });

  it("sends the team workspace header", async () => {
    setStoredToken("token", null, 3600);
    setWorkspace("42");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(json([]));
    await getJobs();
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get("X-Workspace")).toBe("42");
  });

  it("exposes machine-readable error codes for upsell handling", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ detail: "Too long", code: "too_long", max_video_minutes: 10, can_trim: true }, 402));
    const error = await request("/jobs", { method: "POST", json: {} }).catch((caught: ApiError) => caught) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(402);
    expect(error.code).toBe("too_long");
    expect(error.data.max_video_minutes).toBe(10);
  });
});
