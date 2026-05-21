/**
 * Aggregates per-turn latency events into a session summary. The pipeline
 * computes each stage's millisecond delta against its reference point and hands
 * the resulting LatencyEvent here; this class only stores and summarises (P50 /
 * P95 per stage), keeping the timing logic in one place (the pipeline) and the
 * statistics in another (here).
 */

import type { LatencyEvent, LatencyMap, LatencyStage, LatencySummary } from '@workbench/types';

const STAGES: readonly LatencyStage[] = [
  'stt_first_word',
  'stt_final',
  'translation_first_token',
  'translation_final',
  'tts_first_chunk',
  'e2e',
];

export class LatencyTracker {
  private readonly byStage = new Map<LatencyStage, number[]>();
  private turnIds = new Set<string>();

  add(event: LatencyEvent): void {
    const list = this.byStage.get(event.stage) ?? [];
    list.push(event.ms);
    this.byStage.set(event.stage, list);
    this.turnIds.add(event.turnId);
  }

  summary(): LatencySummary {
    const p50: Record<string, number> = {};
    const p95: Record<string, number> = {};
    for (const stage of STAGES) {
      const values = this.byStage.get(stage);
      if (values && values.length > 0) {
        p50[stage] = percentile(values, 50);
        p95[stage] = percentile(values, 95);
      }
    }
    return {
      turnCount: this.turnIds.size,
      p50: p50 as LatencyMap,
      p95: p95 as LatencyMap,
    };
  }
}

/** Nearest-rank percentile, rounded to whole milliseconds. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return Math.round(sorted[index] as number);
}
