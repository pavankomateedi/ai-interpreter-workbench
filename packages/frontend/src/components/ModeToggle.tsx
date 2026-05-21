import type { Mode } from '@workbench/types';

interface ModeToggleProps {
  mode: Mode;
  realtimeAvailable: boolean;
  onChange: (mode: Mode) => void;
}

const MODES: { id: Mode; label: string; blurb: string }[] = [
  { id: 'realtime', label: 'Realtime', blurb: 'OpenAI voice-to-voice' },
  { id: 'cascade', label: 'Cascade', blurb: 'STT → Translation → TTS' },
];

/**
 * Switches between the two interpretation architectures. Switching while a
 * session is live restarts it in the new mode (handled by the parent), enabling
 * the direct A/B comparison the brief asks for.
 */
export function ModeToggle({ mode, realtimeAvailable, onChange }: ModeToggleProps) {
  return (
    <div className="inline-flex rounded-lg border border-slate-700 bg-slate-900/60 p-1">
      {MODES.map((m) => {
        const disabled = m.id === 'realtime' && !realtimeAvailable;
        const active = mode === m.id;
        return (
          <button
            key={m.id}
            type="button"
            disabled={disabled}
            onClick={() => onChange(m.id)}
            title={disabled ? 'Realtime needs an OpenAI API key on the server' : m.blurb}
            className={[
              'flex flex-col items-start rounded-md px-4 py-2 text-left transition',
              active ? 'bg-indigo-600 text-white shadow' : 'text-slate-300 hover:bg-slate-800',
              disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer',
            ].join(' ')}
          >
            <span className="text-sm font-semibold">{m.label}</span>
            <span className="text-[11px] opacity-70">{m.blurb}</span>
          </button>
        );
      })}
    </div>
  );
}
