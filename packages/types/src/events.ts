/**
 * Mode-agnostic events that cross the WebSocket boundary.
 *
 * Both the cascade pipeline and the realtime proxy normalise their internal
 * provider events into these shapes before sending them to the browser, so the
 * UI layer never needs a `if (mode === 'realtime')` branch (see ADR-004).
 */

/** The two interpretation architectures the workbench compares. */
export type Mode = 'realtime' | 'cascade';

/** Which side of an interpretation turn a transcript line belongs to. */
export type TranscriptRole = 'source' | 'target';

/**
 * A transcript line. Partial lines (`isFinal: false`) are replaced in place in
 * the UI as they grow; final lines are committed to the transcript history.
 */
export interface TranscriptEvent {
  readonly role: TranscriptRole;
  readonly text: string;
  readonly isFinal: boolean;
  /** Correlates source/target/latency events belonging to the same turn. */
  readonly turnId: string;
  readonly timestamp: number;
}

/**
 * The per-stage latency metrics measured for each turn. Realtime mode only
 * emits `e2e`; cascade mode emits all six.
 */
export type LatencyStage =
  | 'stt_first_word'
  | 'stt_final'
  | 'translation_first_token'
  | 'translation_final'
  | 'tts_first_chunk'
  | 'e2e';

export interface LatencyEvent {
  readonly stage: LatencyStage;
  readonly turnId: string;
  /** Milliseconds elapsed from the turn's reference point to this stage. */
  readonly ms: number;
  readonly mode: Mode;
  readonly timestamp: number;
}

/** Health of a downstream provider, surfaced to the UI status bar. */
export type ProviderStatus = 'healthy' | 'degraded' | 'unavailable';

export interface ProviderStatusEvent {
  /** Logical provider id, e.g. `stt:openai`, `translation:claude`, `tts:openai`. */
  readonly provider: string;
  readonly status: ProviderStatus;
  /** Present when a circuit breaker is open or the provider is degraded. */
  readonly detail?: string;
}

/** A user-surfaced error. `recoverable` errors keep the session alive. */
export interface ErrorEvent {
  readonly code: ErrorCode;
  readonly message: string;
  readonly recoverable: boolean;
  readonly turnId?: string;
}

export type ErrorCode =
  | 'provider_rate_limit'
  | 'provider_timeout'
  | 'provider_connection'
  | 'provider_auth'
  | 'provider_empty_result'
  | 'circuit_open'
  | 'session_limit'
  | 'bad_request'
  | 'internal';
