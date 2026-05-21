/**
 * Session log types. A {@link SessionLog} is the JSON artefact the user can
 * export from the UI — it captures every turn's transcripts and latencies plus
 * a P50/P95 summary, and is the unit the eval runner replays and scores.
 */

import type { LatencyStage, Mode } from './events.js';
import type { LanguagePairCode } from './language.js';

/** A partial map from latency stage to milliseconds (cascade fills all, realtime fills `e2e`). */
export type LatencyMap = Partial<Record<LatencyStage, number>>;

export interface TurnLog {
  readonly turnId: string;
  readonly sourceText: string;
  readonly targetText: string;
  readonly latencies: LatencyMap;
  readonly startedAt: number;
  readonly endedAt: number;
}

export interface LatencySummary {
  readonly turnCount: number;
  readonly p50: LatencyMap;
  readonly p95: LatencyMap;
}

export interface SessionLog {
  readonly sessionId: string;
  readonly mode: Mode;
  readonly languagePair: LanguagePairCode;
  readonly startedAt: number;
  readonly endedAt: number;
  readonly turns: readonly TurnLog[];
  readonly summary: LatencySummary;
}
