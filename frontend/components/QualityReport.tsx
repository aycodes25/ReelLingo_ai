import { CircleCheck, CircleAlert, ShieldCheck } from "lucide-react";
import type { QualityReport as Report } from "@/lib/types";

/** A plain-language summary of the automatic checks made on a finished project. */
export function QualityReport({ report }: { report: Report }) {
  const translation = report.translation;
  const dub = report.dub?.checked ? report.dub : null;
  if (!translation && !dub) return null;
  const mismatched = dub?.mismatched ?? [];
  return (
    <section className="card quality-report" aria-label="Quality check" style={{ marginBottom: 24, padding: 20 }}>
      <h2 style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 18, margin: "0 0 12px" }}><ShieldCheck size={18} />Quality check</h2>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
        {report.speakers && <li><CircleCheck size={14} /> {report.speakers.count} {report.speakers.count === 1 ? "speaker" : "speakers"} found{report.speakers.count > 1 ? ", each with their own voice" : ""}.</li>}
        {translation && (
          <li>
            {translation.errors === 0 ? <CircleCheck size={14} /> : <CircleAlert size={14} />}{" "}
            {translation.errors === 0
              ? `All ${translation.checked} lines were proofread: no translation errors found.`
              : `${translation.errors} translation ${translation.errors === 1 ? "issue" : "issues"} found in ${translation.checked} lines (${translation.major} serious, ${translation.minor} minor); ${translation.fixed} fixed automatically.`}
            {report.transcript && report.transcript.corrected > 0 && ` ${report.transcript.corrected} misheard ${report.transcript.corrected === 1 ? "line was" : "lines were"} corrected.`}
          </li>
        )}
        {dub && (
          <li>
            {dub.language_ok && dub.matched_percent != null && dub.matched_percent >= 85 ? <CircleCheck size={14} /> : <CircleAlert size={14} />}{" "}
            {dub.language_ok ? `The dubbed voice matched the script on ${dub.matched_percent ?? 0}% of lines.` : "The dubbed voice may not be in the language you chose. Please listen to it."}
            {dub.rushed > 0 && ` ${dub.rushed} ${dub.rushed === 1 ? "line is" : "lines are"} spoken a little fast.`}
          </li>
        )}
      </ul>
      {mismatched.length > 0 && (
        <details style={{ marginTop: 12 }}>
          <summary>Lines worth listening to ({mismatched.length})</summary>
          <p className="muted" style={{ margin: "8px 0" }}>Automatic listening can be wrong in some languages, so these are only suggestions.</p>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {mismatched.slice(0, 10).map((line) => <li key={line.line}>Line {line.line}: should say “{line.intended}”, sounded like “{line.heard || "…"}”</li>)}
          </ul>
        </details>
      )}
    </section>
  );
}
