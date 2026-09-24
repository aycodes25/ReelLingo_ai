interface VoiceToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export default function VoiceToggle({ checked, onChange }: VoiceToggleProps) {
  return (
    <label className="flex items-center gap-3">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-5 w-5 accent-violet-500"
      />
      <span className="text-gray-100">Clone my exact voice (Recommended)</span>
    </label>
  );
}
