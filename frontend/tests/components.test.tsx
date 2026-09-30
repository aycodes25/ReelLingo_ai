import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import ProjectRow from "@/components/ProjectRow";
import TargetLanguages from "@/components/TargetLanguages";
import UpsellDialog from "@/components/UpsellDialog";
import { ApiError } from "@/lib/api";
import type { Job, LanguageOption } from "@/lib/types";

const languages: LanguageOption[] = [
  { code: "auto", name: "Auto-detect", region: "", flag: "", group: "Detect" },
  { code: "yo", name: "Yoruba", region: "", flag: "", group: "Africa" },
  { code: "en", name: "English", region: "", flag: "", group: "Global" },
  { code: "fr", name: "French", region: "", flag: "", group: "Global" },
  { code: "es", name: "Spanish", region: "", flag: "", group: "Global" },
];

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 3, status: "done", current_step: "done", source_language: "yo", target_language: "en", voice_clone: true, media_type: "video",
    output_video_url: null, output_video_download_url: "https://files/video.mp4", output_srt_url: null, output_srt_download_url: null,
    outputs: [], input_video_url: null, error_message: null, original_filename: "Lagos.mp4", source_url: null, processing_note: null,
    created_at: new Date().toISOString(), completed_at: null, demo_mode: false, transcript: null, translated_segments: null, has_transcript: true,
    detected_languages: [], speakers: null, metadata: null, options: {} as Job["options"], review_state: null, redub_count: 0, max_redubs: 5,
    batch_id: null, team_id: null, share_slug: null, share_url: null, youtube: null, duration_seconds: 30, files_expired: false, attempts: 1,
    ...overrides,
  };
}

describe("ProjectRow", () => {
  it("sends jobs awaiting review to the editor", () => {
    render(<ul><ProjectRow job={makeJob({ status: "awaiting_review", current_step: "review" })} languages={languages} /></ul>);
    expect(screen.getByText("Needs review")).toBeInTheDocument();
    const links = screen.getAllByRole("link", { name: /Review/ });
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) expect(link).toHaveAttribute("href", "/jobs/3/edit");
  });

  it("offers a real retry for failed jobs, but not once files expired", () => {
    const { rerender } = render(<ul><ProjectRow job={makeJob({ status: "failed" })} languages={languages} /></ul>);
    expect(screen.getByRole("button", { name: /Retry/ })).toBeInTheDocument();
    rerender(<ul><ProjectRow job={makeJob({ status: "failed", files_expired: true })} languages={languages} /></ul>);
    expect(screen.queryByRole("button", { name: /Retry/ })).not.toBeInTheDocument();
    expect(screen.getByText("Files expired")).toBeInTheDocument();
  });
});

describe("TargetLanguages", () => {
  it("adds languages up to the plan limit and never offers the source language", () => {
    const onChange = vi.fn();
    const { rerender } = render(<TargetLanguages options={languages} value={["en"]} onChange={onChange} max={2} exclude="yo" />);
    const select = screen.getByLabelText(/Target languages/) as HTMLSelectElement;
    expect(Array.from(select.options).map((option) => option.value)).not.toContain("yo");
    fireEvent.change(select, { target: { value: "fr" } });
    expect(onChange).toHaveBeenCalledWith(["en", "fr"]);
    rerender(<TargetLanguages options={languages} value={["en", "fr"]} onChange={onChange} max={2} exclude="yo" />);
    expect(screen.getByLabelText(/Target languages/)).toBeDisabled();
  });
});

describe("UpsellDialog", () => {
  it("offers trimming, a pay-as-you-go credit and an upgrade for long videos", () => {
    const onTrim = vi.fn();
    render(<UpsellDialog error={new ApiError("This video is 14 minutes long.", 402, { code: "too_long", max_video_minutes: 10, can_trim: true })} onClose={() => undefined} onTrim={onTrim} />);
    fireEvent.click(screen.getByRole("button", { name: /Dub the first 10 minutes/ }));
    expect(onTrim).toHaveBeenCalled();
    expect(screen.getByRole("link", { name: /pay-as-you-go credit/ })).toHaveAttribute("href", "/billing#payg");
    expect(screen.getByRole("link", { name: /Upgrade your plan/ })).toHaveAttribute("href", "/billing");
  });
});
