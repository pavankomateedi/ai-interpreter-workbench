interface AudioVisualizerProps {
  level: number;
  active: boolean;
}

const BARS = 16;

/**
 * Lightweight mic-input meter driven by the RMS level the capture worklet posts.
 * Purely cosmetic confirmation that audio is flowing — no decoding needed since
 * the worklet already computes RMS from the raw float samples (ADR-006).
 */
export function AudioVisualizer({ level, active }: AudioVisualizerProps) {
  const normalized = Math.min(1, level * 4);
  return (
    <div className="flex h-10 items-end gap-1" aria-hidden="true">
      {Array.from({ length: BARS }).map((_, i) => {
        const center = 1 - Math.abs(i - (BARS - 1) / 2) / (BARS / 2);
        const height = active ? Math.max(0.08, normalized * center) : 0.08;
        return (
          <span
            key={i}
            className="w-1.5 rounded-full bg-indigo-400 transition-[height] duration-75"
            style={{ height: `${Math.round(height * 100)}%` }}
          />
        );
      })}
    </div>
  );
}
