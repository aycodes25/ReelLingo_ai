import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import LaunchPanel from "@/components/LaunchPanel";
import NewProjectForm from "@/components/NewProjectForm";
import WaitingMusic from "@/components/WaitingMusic";
import type { ApiHealth, LanguageOption, Usage, WaitingMusicSettings } from "@/lib/types";

// ---------- a stand-in for the browser's audio engine ----------
const audio = { contexts: 0, closed: 0, oscillators: 0, played: [] as string[], paused: 0, instances: [] as FakeAudioContext[] };

class FakeAudioContext {
  currentTime = 0;
  destination = {};
  isClosed = false;
  constructor() { audio.contexts += 1; audio.instances.push(this); }
  createGain() { return { gain: { value: 0, linearRampToValueAtTime() {}, cancelScheduledValues() {}, setValueAtTime() {} }, connect() {} }; }
  createBiquadFilter() { return { type: "", frequency: { value: 0 }, connect() {} }; }
  createDelay() { return { delayTime: { value: 0 }, connect() {} }; }
  createOscillator() { audio.oscillators += 1; return { type: "", frequency: { value: 0 }, detune: { value: 0 }, connect() {}, start() {}, stop() {} }; }
  close() { audio.closed += 1; this.isClosed = true; return Promise.resolve(); }
}

class FakeAudio {
  loop = false;
  volume = 1;
  src: string;
  constructor(src: string) { this.src = src; audio.played.push(src); }
  play() { return Promise.resolve(); }
  pause() { audio.paused += 1; }
}

const music = (overrides: Partial<WaitingMusicSettings> = {}): WaitingMusicSettings => ({ enabled: true, autoplay: false, style: "calm", volume: 0.4, url: "", ...overrides });
const setActivated = (value: boolean) => Object.defineProperty(navigator, "userActivation", { configurable: true, value: { hasBeenActive: value } });

beforeEach(() => {
  Object.assign(audio, { contexts: 0, closed: 0, oscillators: 0, played: [], paused: 0, instances: [] });
  vi.stubGlobal("AudioContext", FakeAudioContext);
  vi.stubGlobal("Audio", FakeAudio);
  setActivated(false);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("waiting music", () => {
  it("is hidden when the admin has switched it off", () => {
    render(<WaitingMusic settings={music({ enabled: false })} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    const { container } = render(<WaitingMusic settings={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("plays generated music when the person asks, stops when they turn it off, and remembers the choice", async () => {
    render(<WaitingMusic settings={music()} />);
    fireEvent.click(screen.getByRole("button", { name: "Play calm music while you wait" }));
    expect(audio.contexts).toBe(1);
    expect(audio.oscillators).toBeGreaterThan(0);
    expect(localStorage.getItem("reellingo_waiting_music")).toBe("on");
    fireEvent.click(screen.getByRole("button", { name: "Turn the music off" }));
    expect(localStorage.getItem("reellingo_waiting_music")).toBe("off");
    await new Promise((resolve) => setTimeout(resolve, 900));
    expect(audio.instances[0].isClosed).toBe(true);
  });

  it("plays the admin's own track when one is set, and never a plain-http one", () => {
    render(<WaitingMusic settings={music({ url: "https://cdn.example/calm.mp3" })} />);
    fireEvent.click(screen.getByRole("button"));
    expect(audio.played).toEqual(["https://cdn.example/calm.mp3"]);
    expect(audio.contexts).toBe(0);
  });

  it("starts by itself only when the admin allows it, the browser allows it, and the person hasn't said no", () => {
    // Admin allows autoplay, but the browser hasn't had a click yet: show a button instead of silence or a surprise.
    const first = render(<WaitingMusic settings={music({ autoplay: true })} />);
    expect(audio.contexts).toBe(0);
    expect(screen.getByRole("button", { name: "Tap to play calm music" })).toBeInTheDocument();
    first.unmount();

    setActivated(true);
    const second = render(<WaitingMusic settings={music({ autoplay: true })} />);
    expect(audio.contexts).toBe(1);
    expect(screen.getByText("Music on")).toBeInTheDocument();
    second.unmount();

    // The person turned it off last time: respect that, even with autoplay on.
    localStorage.setItem("reellingo_waiting_music", "off");
    Object.assign(audio, { contexts: 0 });
    render(<WaitingMusic settings={music({ autoplay: true })} />);
    expect(audio.contexts).toBe(0);
  });

  it("starts when they chose it before, even if the admin's default is off", () => {
    setActivated(true);
    localStorage.setItem("reellingo_waiting_music", "on");
    render(<WaitingMusic settings={music({ autoplay: false })} />);
    expect(audio.contexts).toBe(1);
  });

  it("stops the music when the page is left", async () => {
    setActivated(true);
    localStorage.setItem("reellingo_waiting_music", "on");
    const { unmount } = render(<WaitingMusic settings={music()} />);
    expect(audio.contexts).toBe(1);
    unmount();
    await new Promise((resolve) => setTimeout(resolve, 900));
    expect(audio.instances[0].isClosed).toBe(true);
  });
});

describe("launch panel", () => {
  it("keeps the person busy and informed while the project starts", () => {
    vi.useFakeTimers();
    render(<LaunchPanel fromUpload music={music()} />);
    expect(screen.getByText("Upload complete. Getting your project ready…")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Getting your project ready" })).toBeInTheDocument(); // the spinning cube
    expect(screen.getByText("Checking your video").closest("li")).toHaveClass("is-active");
    expect(screen.getByText("This usually takes a few seconds.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play calm music while you wait" })).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(7000); });
    expect(screen.getByText("Checking your video").closest("li")).toHaveClass("is-done");
    expect(screen.getByText("Saving it securely").closest("li")).toHaveClass("is-done");
    expect(screen.getByText("Making sure you have enough minutes").closest("li")).toHaveClass("is-active");

    act(() => { vi.advanceTimersByTime(20000); });
    expect(screen.getByText(/Still working \(27s\)\. Larger videos take longer\. Please keep this page open\./)).toBeInTheDocument();
  });

  it("works without music (when the admin has it off)", () => {
    render(<LaunchPanel fromUpload={false} music={music({ enabled: false })} />);
    expect(screen.getByText("Getting your project ready…")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

// ---------- Warning before starting ----------

const languages: LanguageOption[] = [
  { code: "auto", name: "Auto-detect", region: "", flag: "", group: "Detect" },
  { code: "en", name: "English", region: "", flag: "", group: "Global" },
  { code: "fr", name: "French", region: "", flag: "", group: "Global" },
];
const usage = {
  tier: "starter", plan: { code: "starter", name: "Starter", max_targets: 2, voice_clone: true, lip_sync: false, saved_voices: 0, permissions: {} },
  minutes: { available: 16, plan_allowance: 16, plan_used: 0, plan_left: 16, topup_left: 0, resets_at: "", period_start: "" }, weights: { subtitles: 0.1, lipSync: 12, humanReview: 1, clips: 1 },
} as unknown as Usage;
const health = { status: "ok", mode: "live", capabilities: { languages: 3, voiceClone: true }, settings: { features: {}, waiting_music: music() } } as unknown as ApiHealth;

function mockServer(preflight: unknown) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    const body = url.endsWith("/jobs/preflight") ? preflight : url.endsWith("/voices") ? { voices: [] } : { youtube: { connected: false } };
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  });
}

describe("starting a project", () => {
  it("shows a clear reason and stops the Start button when the video can't get all the way through", async () => {
    mockServer({ ok: false, blockers: [{ code: "provider_credit", message: "We're topping up one of our services, so new videos are paused for a short while." }], warnings: [] });
    render(<NewProjectForm languages={languages} usage={usage} health={health} setupProblem={null} />);
    expect(await screen.findByText("This can't be started right now")).toBeInTheDocument();
    expect(screen.getByText(/new videos are paused for a short while/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Start Processing/ })).toBeDisabled();
  });

  it("asks with the choices that matter, and shows nothing when everything is fine", async () => {
    const fetchMock = mockServer({ ok: true, blockers: [], warnings: [] });
    render(<NewProjectForm languages={languages} usage={usage} health={health} setupProblem={null} />);
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/jobs/preflight"))).toBe(true));
    const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/jobs/preflight"));
    expect(JSON.parse(String((call?.[1] as RequestInit).body))).toMatchObject({ mode: "dub", target_languages: ["en"], voice_mode: "clone", lip_sync: false });
    expect(screen.queryByText("This can't be started right now")).not.toBeInTheDocument();
  });

  it("never blocks when the check itself can't be reached", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input).endsWith("/jobs/preflight")) throw new TypeError("Failed to fetch");
      return new Response(JSON.stringify({ voices: [], youtube: { connected: false } }), { status: 200 });
    });
    render(<NewProjectForm languages={languages} usage={usage} health={health} setupProblem={null} />);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 800)); });
    expect(screen.queryByText("This can't be started right now")).not.toBeInTheDocument();
  });
});
