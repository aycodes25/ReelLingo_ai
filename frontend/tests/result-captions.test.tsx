import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import ResultPage from "@/app/result/[id]/page";
import type { Job } from "@/lib/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => "/result/9",
  useParams: () => ({ id: "9" }),
}));

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 9, status: "done", current_step: "done", source_language: "yo", target_language: "en", voice_clone: true, media_type: "video",
    output_video_url: "https://files/dub.mp4", output_video_download_url: "https://files/dub.mp4?download=1", output_srt_url: null, output_srt_download_url: null,
    outputs: [{ kind: "video", label: "Dubbed video (MP4)", url: "https://files/dub.mp4", download_url: "https://files/dub.mp4?download=1" }],
    input_video_url: null, error_message: null, original_filename: "Lagos.mp4", source_url: null, processing_note: null,
    created_at: new Date().toISOString(), completed_at: null, demo_mode: false, transcript: [{ start: 0, end: 2, text: "bawo ni" }], translated_segments: [{ start: 0, end: 2, text: "hello" }],
    has_transcript: true, detected_languages: [], speakers: null, metadata: null, options: { mode: "dub" } as Job["options"], review_state: null, redub_count: 0, max_redubs: 5,
    batch_id: null, team_id: null, share_slug: null, share_url: null, youtube: null, duration_seconds: 30, files_expired: false, attempts: 1,
    minutes_charged: 0.5, clips_pending: false, captions_pending: false, youtube_languages: [], human_reviewed_at: null, review_note: null,
    ...overrides,
  } as Job;
}

function mockApi(job: Job, { captions = true, onCaptions, refuse }: { captions?: boolean; onCaptions?: (body: unknown) => Job; refuse?: { status: number; detail: string } } = {}) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input).replace("http://localhost:8000", "");
    const method = (init?.method || "GET").toUpperCase();
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ method, url, body });
    const respond = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
    if (method === "POST" && url === "/jobs/9/captions") return refuse ? respond({ detail: refuse.detail }, refuse.status) : respond(onCaptions ? onCaptions(body) : job, 202);
    if (url === "/jobs/9") return respond(job);
    if (url.startsWith("/jobs?")) return respond([]);
    if (url === "/languages") return respond([{ code: "en", name: "English", region: "", flag: "", group: "Global" }, { code: "yo", name: "Yoruba", region: "", flag: "", group: "Africa" }]);
    if (url === "/health") return respond({ status: "ok", mode: "live", capabilities: { languages: 2, voiceClone: true }, settings: { features: { captions, clips: true }, maintenance: { enabled: false, message: "" } } });
    if (url.startsWith("/integrations")) return respond({ youtube: { connected: false } });
    if (url === "/voices") return respond({ voices: [], limit: 1 });
    return respond({});
  });
  return calls;
}

afterEach(() => vi.restoreAllMocks());

describe("video with subtitles on the screen", () => {
  it("offers it on a finished project, and asks for the chosen style", async () => {
    const pending = makeJob({ captions_pending: true, status: "queued" });
    const calls = mockApi(makeJob(), { onCaptions: () => pending });
    render(<ResultPage />);

    expect(await screen.findByRole("heading", { name: /Video with subtitles on the screen/ })).toBeInTheDocument();
    expect(screen.getByText(/show while the video plays: on any phone, in WhatsApp, on TikTok or on a TV/)).toBeInTheDocument();
    expect(screen.getByText(/No minutes used\. The subtitles go on your dubbed video\./)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Subtitle style"), { target: { value: "bold" } });
    fireEvent.click(screen.getByRole("button", { name: "Add subtitles to my video" }));

    expect(await screen.findByText(/Adding the subtitles to your video/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Adding subtitles…" })).toBeDisabled();
    expect(calls.find((call) => call.method === "POST" && call.url === "/jobs/9/captions")?.body).toEqual({ style: "bold" });
  });

  it("shows the finished video, with a download button", async () => {
    const finished = makeJob({
      outputs: [
        { kind: "video", label: "Dubbed video (MP4)", url: "https://files/dub.mp4", download_url: "https://files/dub.mp4?download=1" },
        { kind: "captioned", label: "Video with subtitles on screen", url: "https://files/subs.mp4", download_url: "https://files/subs.mp4?download=1", style: "bold" },
      ] as Job["outputs"],
    });
    mockApi(finished);
    render(<ResultPage />);
    const download = await screen.findByRole("link", { name: /Download video with subtitles/ });
    expect(download).toHaveAttribute("href", "https://files/subs.mp4?download=1");
    expect(screen.getByRole("button", { name: "Make it again in this style" })).toBeInTheDocument();
    expect(screen.getByLabelText("Your video with subtitles on the screen")).toHaveAttribute("src", "https://files/subs.mp4");
  });

  it("tells the person why when it can't be done (for example a plan without it)", async () => {
    mockApi(makeJob(), { refuse: { status: 402, detail: "Subtitles on the video isn't included in your Free plan. Upgrade to use it." } });
    render(<ResultPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Add subtitles to my video" }));
    expect(await screen.findByText(/isn't included in your Free plan. Upgrade to use it. You can upgrade on the Billing page./)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add subtitles to my video" })).toBeEnabled();
  });

  it("is not offered for audio files, or when the admin has switched captions off", async () => {
    mockApi(makeJob({ media_type: "audio" }));
    const audio = render(<ResultPage />);
    await waitFor(() => expect(screen.queryByText(/Loading your video/)).not.toBeInTheDocument());
    expect(screen.queryByRole("heading", { name: /Video with subtitles on the screen/ })).not.toBeInTheDocument();
    audio.unmount();

    vi.restoreAllMocks();
    mockApi(makeJob(), { captions: false });
    render(<ResultPage />);
    await waitFor(() => expect(screen.queryByText(/Loading your video/)).not.toBeInTheDocument());
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(screen.queryByRole("heading", { name: /Video with subtitles on the screen/ })).not.toBeInTheDocument();
  });
});
