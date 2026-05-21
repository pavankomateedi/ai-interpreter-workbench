import { describe, expect, it } from 'vitest';
import { LatencyTracker, percentile } from '../../../src/cascade/LatencyTracker.js';
import type { LatencyEvent } from '@workbench/types';

function event(stage: LatencyEvent['stage'], turnId: string, ms: number): LatencyEvent {
  return { stage, turnId, ms, mode: 'cascade', timestamp: 0 };
}

describe('percentile', () => {
  it('returns 0 for empty input', () => {
    expect(percentile([], 50)).toBe(0);
  });

  it('computes nearest-rank percentiles', () => {
    const values = [10, 20, 30, 40, 50];
    expect(percentile(values, 50)).toBe(30);
    expect(percentile(values, 95)).toBe(50);
  });
});

describe('LatencyTracker', () => {
  it('summarises P50/P95 per stage and counts unique turns', () => {
    const tracker = new LatencyTracker();
    tracker.add(event('e2e', 't1', 100));
    tracker.add(event('e2e', 't2', 200));
    tracker.add(event('e2e', 't3', 300));
    tracker.add(event('tts_first_chunk', 't1', 50));

    const summary = tracker.summary();
    expect(summary.turnCount).toBe(3);
    expect(summary.p50.e2e).toBe(200);
    expect(summary.p95.e2e).toBe(300);
    expect(summary.p50.tts_first_chunk).toBe(50);
    // Stages with no data are omitted.
    expect(summary.p50.stt_first_word).toBeUndefined();
  });
});
