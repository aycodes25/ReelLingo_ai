import type { LanguageOption } from "@/lib/types";

interface LanguagePickerProps {
  label: string;
  options: LanguageOption[];
  value: string;
  onChange: (code: string) => void;
}

export default function LanguagePicker({ label, options, value, onChange }: LanguagePickerProps) {
  const groups = Array.from(new Set(options.map((option) => option.group)));
  return (
    <label className="language-field">
      <span className="field-label">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {groups.map((group) => (
          <optgroup key={group} label={group}>
            {options.filter((option) => option.group === group).map((option) => (
              <option key={option.code} value={option.code}>
                {option.name} · {option.region}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <span className="field-flag" aria-hidden="true">{flagEmoji(options.find((option) => option.code === value)?.flag || "NG")}</span>
    </label>
  );
}

function flagEmoji(countryCode: string): string {
  return String.fromCodePoint(...countryCode.toUpperCase().split("").map((letter) => 127397 + letter.charCodeAt(0)));
}
