import { BadgeCheck, AudioLines, LockKeyhole } from "lucide-react";

export default function VoiceMatchStatus({ enabled }: { enabled: boolean }) {
  return (
    <div className={`voice-option ${enabled ? "" : "is-disabled"}`}>
      <span className="voice-icon"><AudioLines size={18} /></span>
      <span className="voice-copy">
        <strong>Keep the original speaker's voice</strong>
        <small>{enabled ? "A temporary clone is made from this video's speech" : "Requires an ElevenLabs API key"}</small>
      </span>
      {enabled ? <BadgeCheck className="voice-lock" size={17} /> : <LockKeyhole className="voice-lock" size={15} />}
    </div>
  );
}