import type { LanguagePair, LanguagePairCode } from '@workbench/types';

interface LanguageSelectorProps {
  pairs: LanguagePair[];
  value: LanguagePairCode;
  onChange: (code: LanguagePairCode) => void;
}

/** Selects the source→target language pair. Changes apply live mid-session. */
export function LanguageSelector({ pairs, value, onChange }: LanguageSelectorProps) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] uppercase tracking-wide text-slate-400">Language pair</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as LanguagePairCode)}
        className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none"
      >
        {pairs.map((p) => (
          <option key={p.code} value={p.code}>
            {p.source.name} → {p.target.name}
          </option>
        ))}
      </select>
    </label>
  );
}
