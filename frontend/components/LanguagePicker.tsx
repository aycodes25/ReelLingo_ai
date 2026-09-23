interface LanguageOption {
  code: string;
  label: string;
  flag: string;
}

interface LanguagePickerProps {
  label: string;
  options: LanguageOption[];
  value: string;
  onChange: (code: string) => void;
}

export default function LanguagePicker({ label, options, value, onChange }: LanguagePickerProps) {
  return (
    <div>
      <p className="mb-2 text-sm text-gray-400">{label}</p>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            key={option.code}
            type="button"
            onClick={() => onChange(option.code)}
            className={`rounded-full border px-4 py-2 text-sm ${
              value === option.code
                ? "border-violet-500 bg-violet-500/20 text-white"
                : "border-gray-700 text-gray-300"
            }`}
          >
            {option.flag} {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
