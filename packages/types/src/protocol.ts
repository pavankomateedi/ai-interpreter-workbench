/**
 * The WebSocket wire protocol between the browser and the backend.
 *
 * Both `/ws/cascade` and `/ws/realtime` speak this same protocol — the only
 * difference is which backend handler is on the other end. This is what lets the
 * frontend session hooks share a single message codec (see ADR-004). Audio is
 * carried as base64-encoded PCM-16 strings because JSON cannot hold binary.
 */

import type {
  ErrorEvent,
  LatencyEvent,
  Mode,
  ProviderStatusEvent,
  TranscriptEvent,
} from './events.js';
import type { LanguagePairCode } from './language.js';
import type { SessionLog } from './session.js';

// ── Client -> Server ──────────────────────────────────────────────────────────

/** Opens a session. Sent once immediately after the socket connects. */
export interface StartMessage {
  readonly type: 'start';
  readonly sessionId: string;
  readonly mode: Mode;
  readonly languagePair: LanguagePairCode;
}

/** A chunk of captured microphone audio (base64 PCM-16 @ 16 kHz mono). */
export interface AudioInMessage {
  readonly type: 'audio';
  readonly chunk: string;
}

/** Switches the active language pair without tearing down the socket. */
export interface LanguageUpdateMessage {
  readonly type: 'language.update';
  readonly languagePair: LanguagePairCode;
}

/** Ends the session and requests the final session log. */
export interface StopMessage {
  readonly type: 'stop';
}

export type ClientMessage =
  | StartMessage
  | AudioInMessage
  | LanguageUpdateMessage
  | StopMessage;

// ── Server -> Client ──────────────────────────────────────────────────────────

/** Acknowledges {@link StartMessage}; the session is now accepting audio. */
export interface ReadyMessage {
  readonly type: 'ready';
  readonly sessionId: string;
  readonly mode: Mode;
  readonly languagePair: LanguagePairCode;
}

export interface TranscriptMessage {
  readonly type: 'transcript';
  readonly event: TranscriptEvent;
}

/** A chunk of synthesised target-language audio for playback (base64 PCM-16). */
export interface AudioOutMessage {
  readonly type: 'audio';
  readonly chunk: string;
  readonly sampleRate: number;
  readonly turnId: string;
}

export interface LatencyMessage {
  readonly type: 'latency';
  readonly event: LatencyEvent;
}

export interface TurnStartMessage {
  readonly type: 'turn.start';
  readonly turnId: string;
}

export interface TurnEndMessage {
  readonly type: 'turn.end';
  readonly turnId: string;
}

export interface ProviderStatusMessage {
  readonly type: 'provider.status';
  readonly event: ProviderStatusEvent;
}

export interface ErrorMessage {
  readonly type: 'error';
  readonly error: ErrorEvent;
}

/** Sent in response to {@link StopMessage} with the full session log. */
export interface SessionLogMessage {
  readonly type: 'session.log';
  readonly log: SessionLog;
}

export type ServerMessage =
  | ReadyMessage
  | TranscriptMessage
  | AudioOutMessage
  | LatencyMessage
  | TurnStartMessage
  | TurnEndMessage
  | ProviderStatusMessage
  | ErrorMessage
  | SessionLogMessage;
