import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { QualityReport } from "@/components/QualityReport";

describe("QualityReport", () => {
  it("summarises speakers, translation fixes and the dub check in plain words", () => {
    render(<QualityReport report={{
      speakers: { count: 3, people: [] },
      transcript: { second_opinion: true, doubtful: 1, corrected: 2 },
      translation: { checked: 40, errors: 4, major: 1, minor: 3, fixed: 1, issues: [] },
      dub: { checked: true, language_ok: true, matched_percent: 96, rushed: 2, mismatched: [{ line: 7, intended: "Bawo", heard: "Kaabo", similarity: 0.2 }] },
    }} />);
    expect(screen.getByText(/3 speakers found, each with their own voice/)).toBeTruthy();
    expect(screen.getByText(/4 translation issues found in 40 lines \(1 serious, 3 minor\); 1 fixed automatically/)).toBeTruthy();
    expect(screen.getByText(/2 misheard lines were corrected/)).toBeTruthy();
    expect(screen.getByText(/matched the script on 96% of lines/)).toBeTruthy();
    expect(screen.getByText(/2 lines are spoken a little fast/)).toBeTruthy();
    expect(screen.getByText(/Lines worth listening to \(1\)/)).toBeTruthy();
  });

  it("warns when the dub may be in the wrong language and shows nothing when no checks ran", () => {
    const { container, rerender } = render(<QualityReport report={{ dub: { checked: true, language_ok: false, matched_percent: 10, rushed: 0 } }} />);
    expect(screen.getByText(/may not be in the language you chose/)).toBeTruthy();
    rerender(<QualityReport report={{}} />);
    expect(container.textContent).toBe("");
  });
});
