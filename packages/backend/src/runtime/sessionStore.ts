/**
 * A small bounded in-memory store of recently completed session logs, so the
 * `GET /api/sessions/:id` endpoint can return a session's transcripts and
 * latencies after the socket has closed. Bounded to avoid unbounded growth over
 * a long-running process.
 */

import type { SessionLog } from '@workbench/types';

const MAX_STORED = 50;

const logs = new Map<string, SessionLog>();

export function storeSessionLog(log: SessionLog): void {
  logs.set(log.sessionId, log);
  while (logs.size > MAX_STORED) {
    const oldest = logs.keys().next().value;
    if (oldest === undefined) break;
    logs.delete(oldest);
  }
}

export function getSessionLog(sessionId: string): SessionLog | undefined {
  return logs.get(sessionId);
}

export function activeSessionCount(): number {
  return activeSessions;
}

let activeSessions = 0;

export function incrementActiveSessions(): void {
  activeSessions += 1;
}

export function decrementActiveSessions(): void {
  activeSessions = Math.max(0, activeSessions - 1);
}
