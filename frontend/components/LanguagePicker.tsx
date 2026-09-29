import { ChevronDown } from "lucide-react";
import type { LanguageOption } from "@/lib/types";

interface LanguagePickerProps {
  id: string;
  label: string;
  options: LanguageOption[];
  value: string;
  onChange: (code: string) => void;
}

export default function LanguagePicker({ id, label, options, value, onChange }: LanguagePickerProps) {
  const groups = Array.from(new Set(options.map((option) => option.group)));
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>{label}</label>
      <div className="select-wrap">
        <select id={id} className="select" value={value} onChange={(event) => onChange(event.target.value)} disabled={!options.length}>
          {!options.length && <option>Loading languages…</option>}
          {groups.map((group) => (
            <optgroup key={group} label={group}>
              {options.filter((option) => option.group === group).map((option) => (
                <option key={option.code} value={option.code}>{option.name}</option>
              ))}
            </optgroup>
          ))}
        </select>
        <ChevronDown size={17} />
      </div>
    </div>
  );
}
