import type { Job } from "@/lib/types";

function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export default function TranscriptReview({ job }: { job: Job }) {
  if (!job.transcript?.length) return null;

  const translationByTime = new Map(
    (job.translated_segments || []).map((segment) => [`${segment.start}:${segment.end}`, segment.text]),
  );

  return (
    <section className="transcript-review" aria-labelledby="transcript-title">
      <div className="transcript-heading">
        <div>
          <p className="eyebrow">FULL VIDEO TRANSCRIPT</p>
          <h2 id="transcript-title">What we heard</h2>
          <p>{job.transcript.length} timestamped speech segments{job.duration_seconds ? ` · ${Math.round(job.duration_seconds)} seconds analyzed` : ""}</p>
        </div>
        <div className="detected-language-list" aria-label="Languages detected in this video">
          {job.detected_languages.map((language) => (
            <span key={language.code}>{language.name}</span>
          ))}
        </div>
      </div>
      <details className="transcript-details" open>
        <summary>Original transcript and translated text</summary>
        <ol className="transcript-segments">
          {job.transcript.map((segment, index) => (
            <li key={`${segment.start}-${segment.end}-${index}`}>
              <span className="transcript-time">{formatTime(segment.start)}</span>
              <div className="transcript-copy">
                <p><span>{job.detected_languages.find((language) => language.code === segment.language)?.name || segment.language}</span>{segment.text}</p>
                {(() => {
                  const translation = translationByTime.get(`${segment.start}:${segment.end}`);
                  return translation ? <p className="translated-line"><span>{job.target_language.toUpperCase()}</span>{translation}</p> : null;
                })()}
              </div>
            </li>
          ))}
        </ol>
      </details>
    </section>
  );
}
