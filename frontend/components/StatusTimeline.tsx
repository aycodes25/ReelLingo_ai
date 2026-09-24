const STEPS = [
  { key: "extracting_audio", label: "Extracting audio" },
  { key: "transcribing", label: "Transcribing" },
  { key: "translating", label: "Translating" },
  { key: "dubbing", label: "Synthesizing voice clone" },
  { key: "merging", label: "Stitching it all together" },
  { key: "generating_subtitles", label: "Generating subtitles" },
];

interface StatusTimelineProps {
  currentStep: string;
}

export default function StatusTimeline({ currentStep }: StatusTimelineProps) {
  const currentIndex = STEPS.findIndex((step) => step.key === currentStep);

  return (
    <ul className="space-y-3">
      {STEPS.map((step, index) => {
        const isDone = currentIndex > index || currentStep === "done";
        const isActive = currentIndex === index;
        return (
          <li
            key={step.key}
            className={`flex items-center gap-3 ${
              isActive ? "text-violet-400" : isDone ? "text-emerald-400" : "text-gray-500"
            }`}
          >
            <span>{isDone ? "✅" : isActive ? "⏳" : "◯"}</span>
            <span>{step.label}...</span>
          </li>
        );
      })}
    </ul>
  );
}
