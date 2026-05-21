/**
 * Backend-side circuit breakers (ADR-007). One breaker per logical provider id
 * protects every active session: a burst of failures opens the breaker, after
 * which calls are short-circuited (so a fallback provider is used) until a
 * cool-down elapses and a single probe is allowed (half-open). State lives in
 * process memory — adequate for this single-process workbench.
 */

import type { ProviderStatus, ProviderStatusEvent } from '@workbench/types';

export type CircuitState = 'closed' | 'open' | 'half_open';

export interface CircuitBreakerOptions {
  readonly enabled: boolean;
  readonly errorThreshold: number;
  readonly windowMs: number;
  readonly openDurationMs: number;
}

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failureTimes: number[] = [];
  private openedAt = 0;

  constructor(
    readonly id: string,
    private readonly options: CircuitBreakerOptions,
  ) {}

  /** Whether a request may proceed. Transitions open->half_open after cool-down. */
  canRequest(now: number = Date.now()): boolean {
    if (!this.options.enabled) return true;
    if (this.state === 'open') {
      if (now - this.openedAt >= this.options.openDurationMs) {
        this.state = 'half_open';
        return true;
      }
      return false;
    }
    return true;
  }

  recordSuccess(): void {
    if (!this.options.enabled) return;
    this.failureTimes = [];
    this.state = 'closed';
  }

  recordFailure(now: number = Date.now()): void {
    if (!this.options.enabled) return;
    if (this.state === 'half_open') {
      this.trip(now);
      return;
    }
    this.failureTimes.push(now);
    this.failureTimes = this.failureTimes.filter((t) => now - t <= this.options.windowMs);
    if (this.failureTimes.length >= this.options.errorThreshold) {
      this.trip(now);
    }
  }

  /** Manual operator override (admin endpoint / incident playbook). */
  forceOpen(): void {
    this.trip(Date.now());
  }

  forceClose(): void {
    this.state = 'closed';
    this.failureTimes = [];
  }

  get currentState(): CircuitState {
    return this.state;
  }

  get status(): ProviderStatus {
    if (this.state === 'closed') return 'healthy';
    if (this.state === 'half_open') return 'degraded';
    return 'unavailable';
  }

  private trip(now: number): void {
    this.state = 'open';
    this.openedAt = now;
    this.failureTimes = [];
  }
}

export class BreakerRegistry {
  private readonly breakers = new Map<string, CircuitBreaker>();

  constructor(private readonly options: CircuitBreakerOptions) {}

  get(id: string): CircuitBreaker {
    let breaker = this.breakers.get(id);
    if (!breaker) {
      breaker = new CircuitBreaker(id, this.options);
      this.breakers.set(id, breaker);
    }
    return breaker;
  }

  snapshot(): ProviderStatusEvent[] {
    return [...this.breakers.values()].map((b) => ({
      provider: b.id,
      status: b.status,
      ...(b.currentState !== 'closed' ? { detail: `circuit ${b.currentState}` } : {}),
    }));
  }

  forceOpen(id: string): boolean {
    const breaker = this.breakers.get(id) ?? this.get(id);
    breaker.forceOpen();
    return true;
  }

  forceClose(id: string): boolean {
    const breaker = this.breakers.get(id);
    if (!breaker) return false;
    breaker.forceClose();
    return true;
  }
}
