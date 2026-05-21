import { describe, expect, it } from 'vitest';
import { CircuitBreaker } from '../../src/lib/circuitBreaker.js';

const OPTS = { enabled: true, errorThreshold: 3, windowMs: 1000, openDurationMs: 500 };

describe('CircuitBreaker', () => {
  it('stays closed below the failure threshold', () => {
    const cb = new CircuitBreaker('x', OPTS);
    cb.recordFailure(0);
    cb.recordFailure(100);
    expect(cb.canRequest(200)).toBe(true);
    expect(cb.status).toBe('healthy');
  });

  it('opens once the threshold is hit within the window and blocks requests', () => {
    const cb = new CircuitBreaker('x', OPTS);
    cb.recordFailure(0);
    cb.recordFailure(100);
    cb.recordFailure(200);
    expect(cb.currentState).toBe('open');
    expect(cb.canRequest(300)).toBe(false);
    expect(cb.status).toBe('unavailable');
  });

  it('ignores failures that fall outside the rolling window', () => {
    const cb = new CircuitBreaker('x', OPTS);
    cb.recordFailure(0);
    cb.recordFailure(100);
    cb.recordFailure(2000); // first two are now outside the 1000ms window
    expect(cb.currentState).toBe('closed');
  });

  it('transitions to half-open after the cool-down and closes on success', () => {
    const cb = new CircuitBreaker('x', OPTS);
    cb.recordFailure(0);
    cb.recordFailure(100);
    cb.recordFailure(200);
    expect(cb.canRequest(300)).toBe(false);
    // After openDuration the next canRequest probes (half-open).
    expect(cb.canRequest(800)).toBe(true);
    expect(cb.currentState).toBe('half_open');
    cb.recordSuccess();
    expect(cb.currentState).toBe('closed');
  });

  it('re-opens immediately if the half-open probe fails', () => {
    const cb = new CircuitBreaker('x', OPTS);
    cb.recordFailure(0);
    cb.recordFailure(100);
    cb.recordFailure(200);
    cb.canRequest(800); // -> half_open
    cb.recordFailure(810);
    expect(cb.currentState).toBe('open');
  });

  it('is a no-op passthrough when disabled', () => {
    const cb = new CircuitBreaker('x', { ...OPTS, enabled: false });
    cb.recordFailure(0);
    cb.recordFailure(1);
    cb.recordFailure(2);
    cb.recordFailure(3);
    expect(cb.canRequest()).toBe(true);
    expect(cb.currentState).toBe('closed');
  });
});
