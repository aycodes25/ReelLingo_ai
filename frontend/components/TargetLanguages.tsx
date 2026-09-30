"use client";

import { ChevronDown, Plus, X } from "lucide-react";
import type { LanguageOption } from "@/lib/types";

interface TargetLanguagesProps {
  options: LanguageOption[];
  value: string[];
  onChange: (codes: string[]) => void;
  max: number;
  exclude?: string;
}

/** Picks one or more target languages; each extra language becomes its own dub from a single upload. */
export default function TargetLanguages({ options, value, onChange, max, exclude }: TargetLanguagesProps) {
  const available = options.filter((option) => option.code !== "auto" && option.code !== exclude && !value.includes(option.code));
  const groups = Array.from(new Set(available.map((option) => option.group)));
  const nameOf = (code: string) => options.find((option) => option.code === code)?.name || code.toUpperCase();
  const atLimit = value.length >= max;

  return (
    <div className="field">
      <div className="field-label-row">
        <label className="field-label" htmlFor="target-add">Target language{max > 1 ? "s" : ""}</label>
        <span className="field-hint">{value.length}/{max} per upload</span>
      </div>
      <div className="lang-chips" aria-live="polite">
        {value.map((code) => (
          <span key={code} className="lang-select-chip">
            {nameOf(code)}
            {value.length > 1 && (
              <button type="button" aria-label={`Remove ${nameOf(code)}`} onClick={() => onChange(value.filter((item) => item !== code))}><X size={13} /></button>
            )}
          </span>
        ))}
      </div>
      <div className="select-wrap">
        <select
          id="target-add"
          className="select"
          value=""
          disabled={!options.length || (atLimit && max > 1)}
          onChange={(event) => {
            const code = event.target.value;
            if (!code) return;
            onChange(max === 1 ? [code] : [...value, code].slice(0, max));
          }}
        >
          <option value="">{!options.length ? "Loading languages…" : max === 1 ? "Change language…" : atLimit ? "Language limit reached — upgrade for more" : "Add another language…"}</option>
          {groups.map((group) => (
            <optgroup key={group} label={group}>
              {available.filter((option) => option.group === group).map((option) => <option key={option.code} value={option.code}>{option.name}</option>)}
            </optgroup>
          ))}
        </select>
        {max > 1 && !atLimit ? <Plus size={17} /> : <ChevronDown size={17} />}
      </div>
    </div>
  );
}
