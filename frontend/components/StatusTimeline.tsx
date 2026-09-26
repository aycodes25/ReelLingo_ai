const STEPS = [
  { key: "extracting_audio", label: "Extracting audio" },
  { key: "transcribing", label: "Transcribing" },
  { key: "detecting_languages", label: "Listing spoken languages" },
  { key: "translating", label: "Translating" },
  { key: "dubbing", label: "Generating translated voice" },
  { key: "merging", label: "Replacing the original audio" },
  { key: "generating_subtitles", label: "Generating subtitles" },
];

interface StatusTimelineProps {
  currentStep: string;
}

export default function StatusTimeline({ currentStep }: StatusTimelineProps) {
  const currentIndex = STEPS.findIndex((step) => step.key === currentStep);

  return (
    <ol className="timeline">
      {STEPS.map((step, index) => {
        const isDone = currentIndex > index || currentStep === "done";
        const isActive = currentIndex === index;
        return (
          <li
            key={step.key}
            className={`timeline-step ${isActive ? "is-active" : isDone ? "is-done" : ""}`}
          >
            <span className="timeline-marker" aria-hidden="true">{isDone ? "✓" : isActive ? "•" : ""}</span>
            <span>{step.label}</span>
          </li>
        );
      })}
    </ol>
  );
}
