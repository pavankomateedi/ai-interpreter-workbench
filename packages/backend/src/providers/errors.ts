/**
 * The provider error hierarchy. Every provider implementation MUST wrap SDK and
 * transport errors in one of these subclasses before they propagate out of the
 * provider (see CONTRIBUTING "Error Handling"). This is what lets the circuit
 * breaker and the cascade pipeline reason about failures uniformly — they switch
 * on `error.code`, never on a provider-specific error shape.
 *
 * Retries and fallback live in the circuit breaker layer, never inside a
 * provider (ADR-007).
 */

import type { ErrorCode } from '@workbench/types';

export abstract class ProviderError extends Error {
  abstract readonly code: ErrorCode;
  /** Whether the session can continue (skip this turn) or must be torn down. */
  abstract readonly recoverable: boolean;

  constructor(
    message: string,
    /** Logical provider id, e.g. `stt:openai`. */
    readonly provider: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** HTTP 429 / quota exhaustion. Recoverable: open the breaker, try a fallback. */
export class ProviderRateLimitError extends ProviderError {
  readonly code = 'provider_rate_limit';
  readonly recoverable = true;
}

/** No response within the configured timeout. Recoverable: skip the turn. */
export class ProviderTimeoutError extends ProviderError {
  readonly code = 'provider_timeout';
  readonly recoverable = true;
}

/** WebSocket/HTTP connection failure mid-stream. Recoverable: reconnect/fallback. */
export class ProviderConnectionError extends ProviderError {
  readonly code = 'provider_connection';
  readonly recoverable = true;
}

/** HTTP 401/403 — bad or missing API key. Not recoverable without operator action. */
export class ProviderAuthError extends ProviderError {
  readonly code = 'provider_auth';
  readonly recoverable = false;
}

/** Provider returned a 2xx but with no usable transcript/translation/audio. */
export class ProviderEmptyResultError extends ProviderError {
  readonly code = 'provider_empty_result';
  readonly recoverable = true;
}

/**
 * Best-effort classification of an unknown error thrown by a provider SDK into
 * the hierarchy. Providers call this in their `catch` blocks so they don't each
 * reinvent status-code mapping.
 */
export function classifyProviderError(err: unknown, provider: string): ProviderError {
  if (err instanceof ProviderError) return err;

  const status = extractStatus(err);
  const message = err instanceof Error ? err.message : String(err);
  const cause = { cause: err };

  if (status === 429) return new ProviderRateLimitError(message, provider, cause);
  if (status === 401 || status === 403) return new ProviderAuthError(message, provider, cause);
  if (status === 408 || /time?out/i.test(message)) {
    return new ProviderTimeoutError(message, provider, cause);
  }
  if (/econn|socket|network|disconnect|closed/i.test(message)) {
    return new ProviderConnectionError(message, provider, cause);
  }
  // Default to connection error: recoverable, so a single bad turn never tears
  // down a 5-minute session.
  return new ProviderConnectionError(message, provider, cause);
}

function extractStatus(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const record = err as Record<string, unknown>;
  if (typeof record.status === 'number') return record.status;
  if (typeof record.statusCode === 'number') return record.statusCode;
  const response = record.response as Record<string, unknown> | undefined;
  if (response && typeof response.status === 'number') return response.status;
  return undefined;
}
