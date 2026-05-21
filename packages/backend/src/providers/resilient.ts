/**
 * Resilient provider wrappers: each takes an ordered chain of candidate
 * providers (primary -> fallbacks -> mock) and a circuit breaker per candidate,
 * and presents the same interface to the cascade pipeline. The pipeline is
 * oblivious to fallback — it just calls `translateStream` and gets a result
 * (ADR-007). Translation and TTS take re-runnable string input, so the wrapper
 * can fall through to the next provider on a start-time failure; STT consumes a
 * one-shot audio stream, so it can only select a healthy provider up front.
 */

import type { ProviderStatusEvent } from '@workbench/types';
import type { CircuitBreaker } from '../lib/circuitBreaker.js';
import { ProviderConnectionError } from './errors.js';
import type { ISttProvider, SttConfig, SttEvent } from './stt/ISttProvider.js';
import type {
  ITranslationProvider,
  TranslationConfig,
  TranslationEvent,
} from './translation/ITranslationProvider.js';
import type { ITtsProvider, TtsConfig, TtsEvent } from './tts/ITtsProvider.js';

export type StatusCallback = (event: ProviderStatusEvent) => void;

export interface Candidate<P> {
  readonly provider: P;
  readonly breaker: CircuitBreaker;
}

function report(callback: StatusCallback | undefined, candidate: Candidate<{ id: string }>): void {
  callback?.({
    provider: candidate.provider.id,
    status: candidate.breaker.status,
    ...(candidate.breaker.currentState !== 'closed'
      ? { detail: `circuit ${candidate.breaker.currentState}` }
      : {}),
  });
}

export class ResilientSttProvider implements ISttProvider {
  readonly id = 'stt:resilient';

  constructor(
    private readonly candidates: ReadonlyArray<Candidate<ISttProvider>>,
    private readonly onStatus?: StatusCallback,
  ) {}

  async *transcribeStream(
    audioStream: AsyncIterable<Buffer>,
    config: SttConfig,
  ): AsyncIterable<SttEvent> {
    const candidate = this.candidates.find((c) => c.breaker.canRequest());
    if (!candidate) {
      throw new ProviderConnectionError('No STT provider available (all circuits open)', this.id);
    }
    try {
      yield* candidate.provider.transcribeStream(audioStream, config);
      candidate.breaker.recordSuccess();
    } catch (err) {
      candidate.breaker.recordFailure();
      throw err;
    } finally {
      report(this.onStatus, candidate);
    }
  }

  async close(): Promise<void> {
    await Promise.allSettled(this.candidates.map((c) => c.provider.close()));
  }
}

export class ResilientTranslationProvider implements ITranslationProvider {
  readonly id = 'translation:resilient';

  constructor(
    private readonly candidates: ReadonlyArray<Candidate<ITranslationProvider>>,
    private readonly onStatus?: StatusCallback,
  ) {}

  async *translateStream(
    text: string,
    config: TranslationConfig,
  ): AsyncIterable<TranslationEvent> {
    let lastError: unknown;
    for (const candidate of this.candidates) {
      if (!candidate.breaker.canRequest()) continue;
      let yielded = false;
      try {
        for await (const ev of candidate.provider.translateStream(text, config)) {
          yielded = true;
          yield ev;
        }
        candidate.breaker.recordSuccess();
        report(this.onStatus, candidate);
        return;
      } catch (err) {
        candidate.breaker.recordFailure();
        report(this.onStatus, candidate);
        lastError = err;
        // Once output has streamed we cannot safely restart on another provider.
        if (yielded) throw err;
      }
    }
    throw lastError ?? new ProviderConnectionError('No translation provider available', this.id);
  }

  async close(): Promise<void> {
    await Promise.allSettled(this.candidates.map((c) => c.provider.close()));
  }
}

export class ResilientTtsProvider implements ITtsProvider {
  readonly id = 'tts:resilient';

  constructor(
    private readonly candidates: ReadonlyArray<Candidate<ITtsProvider>>,
    private readonly onStatus?: StatusCallback,
  ) {}

  async *synthesizeStream(text: string, config: TtsConfig): AsyncIterable<TtsEvent> {
    let lastError: unknown;
    for (const candidate of this.candidates) {
      if (!candidate.breaker.canRequest()) continue;
      let yielded = false;
      try {
        for await (const ev of candidate.provider.synthesizeStream(text, config)) {
          yielded = true;
          yield ev;
        }
        candidate.breaker.recordSuccess();
        report(this.onStatus, candidate);
        return;
      } catch (err) {
        candidate.breaker.recordFailure();
        report(this.onStatus, candidate);
        lastError = err;
        if (yielded) throw err;
      }
    }
    throw lastError ?? new ProviderConnectionError('No TTS provider available', this.id);
  }

  async close(): Promise<void> {
    await Promise.allSettled(this.candidates.map((c) => c.provider.close()));
  }
}
