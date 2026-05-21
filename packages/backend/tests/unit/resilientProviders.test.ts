import { describe, expect, it, vi } from 'vitest';
import { CircuitBreaker } from '../../src/lib/circuitBreaker.js';
import {
  ResilientSttProvider,
  ResilientTranslationProvider,
  type Candidate,
} from '../../src/providers/resilient.js';
import { MockTranslationProvider } from '../../src/providers/translation/MockTranslationProvider.js';
import { MockSttProvider } from '../../src/providers/stt/MockSttProvider.js';
import { ProviderRateLimitError } from '../../src/providers/errors.js';
import type {
  ITranslationProvider,
  TranslationConfig,
  TranslationEvent,
} from '../../src/providers/translation/ITranslationProvider.js';

const OPTS = { enabled: true, errorThreshold: 1, windowMs: 1000, openDurationMs: 500 };

class FailingTranslationProvider implements ITranslationProvider {
  readonly id = 'translation:failing';
  // eslint-disable-next-line require-yield
  async *translateStream(_t: string, _c: TranslationConfig): AsyncIterable<TranslationEvent> {
    throw new ProviderRateLimitError('rate limited', this.id);
  }
  async close(): Promise<void> {}
}

const tConfig: TranslationConfig = { sourceLang: 'English', targetLang: 'Spanish' };

describe('ResilientTranslationProvider', () => {
  it('falls back to the next provider when the primary fails before yielding', async () => {
    const failing = new FailingTranslationProvider();
    const mock = new MockTranslationProvider();
    const candidates: Candidate<ITranslationProvider>[] = [
      { provider: failing, breaker: new CircuitBreaker(failing.id, OPTS) },
      { provider: mock, breaker: new CircuitBreaker(mock.id, OPTS) },
    ];
    const onStatus = vi.fn();
    const resilient = new ResilientTranslationProvider(candidates, onStatus);

    const events: TranslationEvent[] = [];
    for await (const ev of resilient.translateStream('Hello world.', tConfig)) {
      events.push(ev);
    }

    const final = events.find((e) => e.type === 'final');
    expect(final?.type).toBe('final');
    expect(events.length).toBeGreaterThan(1);
    // The failing provider's breaker recorded a failure and reported status.
    expect(onStatus).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'translation:failing' }),
    );
    expect(candidates[0]?.breaker.currentState).toBe('open');
  });

  it('skips a provider whose circuit is already open', async () => {
    const failing = new FailingTranslationProvider();
    const mock = new MockTranslationProvider();
    const openBreaker = new CircuitBreaker(failing.id, OPTS);
    openBreaker.forceOpen();
    const spy = vi.spyOn(failing, 'translateStream');
    const resilient = new ResilientTranslationProvider([
      { provider: failing, breaker: openBreaker },
      { provider: mock, breaker: new CircuitBreaker(mock.id, OPTS) },
    ]);

    const events: TranslationEvent[] = [];
    for await (const ev of resilient.translateStream('Hello.', tConfig)) events.push(ev);

    expect(spy).not.toHaveBeenCalled();
    expect(events.some((e) => e.type === 'final')).toBe(true);
  });
});

describe('ResilientSttProvider', () => {
  it('selects the first provider whose circuit allows the request', async () => {
    const mock = new MockSttProvider({ script: ['Hello there.'] });
    const resilient = new ResilientSttProvider([
      { provider: mock, breaker: new CircuitBreaker(mock.id, OPTS) },
    ]);

    async function* audio(): AsyncIterable<Buffer> {
      for (let i = 0; i < 6; i += 1) yield Buffer.alloc(320);
    }

    const finals: string[] = [];
    for await (const ev of resilient.transcribeStream(audio(), {
      language: 'en-US',
      sampleRate: 16000,
    })) {
      if (ev.type === 'final') finals.push(ev.text);
    }
    expect(finals).toContain('Hello there.');
  });
});
