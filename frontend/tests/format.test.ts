import { describe, expect, it } from "vitest";
import { clock, formatMoney, languageName, progressPercent, projectTitle, segmentsToVtt, stageIndex, timestamp } from "@/lib/format";
import type { Job } from "@/lib/types";

const job = (overrides: Partial<Job>): Job => ({ id: 7, status: "processing", current_step: "queued", original_filename: null, detected_languages: [], ...overrides } as Job);

describe("pipeline progress", () => {
  it("places new steps in the right stage", () => {
    expect(stageIndex("importing")).toBe(0);
    expect(stageIndex("review")).toBe(2);
    expect(stageIndex("separating")).toBe(3);
    expect(stageIndex("mixing")).toBe(3);
    expect(stageIndex("lip_syncing")).toBe(5);
    expect(stageIndex("unknown")).toBe(0);
  });

  it("counts finished stages fully and the active one as half", () => {
    expect(progressPercent(job({ current_step: "translating" }))).toBe(36);
    expect(progressPercent(job({ status: "done", current_step: "done" }))).toBe(100);
  });
});

describe("formatting", () => {
  it("formats naira without kobo and dollars with cents", () => {
    expect(formatMoney(16000, "NGN")).toMatch(/16,000/);
    expect(formatMoney(9.5, "USD")).toBe("$9.50");
  });

  it("formats times and titles", () => {
    expect(clock(125)).toBe("02:05");
    expect(timestamp(3725)).toBe("01:02:05");
    expect(projectTitle(job({ original_filename: "lagos_market-tour.mp4" }))).toBe("lagos market tour");
    expect(languageName([], "auto")).toBe("Auto-detect");
  });

  it("writes WebVTT cues with millisecond timestamps", () => {
    expect(segmentsToVtt([{ start: 1.5, end: 3.25, text: "Hello", language: "en" }])).toBe("WEBVTT\n\n1\n00:00:01.500 --> 00:00:03.250\nHello\n");
  });
});

describe("what's happening right now", () => {
  it("explains the slow steps in plain words, for steps the pipeline really has", async () => {
    const { STEP_DETAIL, STEP_MESSAGES } = await import("@/lib/format");
    for (const step of Object.keys(STEP_DETAIL)) expect(STEP_MESSAGES[step], `${step} is a real step`).toBeTruthy();
    expect(STEP_DETAIL.separating).toMatch(/slowest step/);
    expect(STEP_DETAIL.separating).toMatch(/three times the length of your video/);
  });
});
