/**
 * Provider factory. Builds the per-session resilient provider chains for cascade
 * mode from the configured selection and the keys that are actually present.
 * Each chain ends in the corresponding Mock provider so a session degrades to
 * offline operation rather than failing outright (NFR offline resilience). The
 * shared BreakerRegistry gives every logical provider one process-wide breaker.
 */

import type { ProviderStatusEvent } from '@workbench/types';
import { env } from './env.js';
import { BreakerRegistry } from '../lib/circuitBreaker.js';
import type { ISttProvider } from '../providers/stt/ISttProvider.js';
import type { ITranslationProvider } from '../providers/translation/ITranslationProvider.js';
import type { ITtsProvider } from '../providers/tts/ITtsProvider.js';
import { OpenAiSttProvider } from '../providers/stt/OpenAiSttProvider.js';
import { DeepgramSttProvider } from '../providers/stt/DeepgramSttProvider.js';
import { MockSttProvider } from '../providers/stt/MockSttProvider.js';
import { ClaudeTranslationProvider } from '../providers/translation/ClaudeTranslationProvider.js';
import { OpenAiTranslationProvider } from '../providers/translation/OpenAiTranslationProvider.js';
import { MockTranslationProvider } from '../providers/translation/MockTranslationProvider.js';
import { OpenAiTtsProvider } from '../providers/tts/OpenAiTtsProvider.js';
import { MockTtsProvider } from '../providers/tts/MockTtsProvider.js';
import {
  ResilientSttProvider,
  ResilientTranslationProvider,
  ResilientTtsProvider,
  type Candidate,
  type StatusCallback,
} from '../providers/resilient.js';

export const breakerRegistry = new BreakerRegistry({
  enabled: env.CIRCUIT_BREAKER_ENABLED,
  errorThreshold: env.CIRCUIT_BREAKER_ERROR_THRESHOLD,
  windowMs: env.CIRCUIT_BREAKER_WINDOW_SECONDS * 1000,
  openDurationMs: env.CIRCUIT_BREAKER_OPEN_DURATION_SECONDS * 1000,
});

/** Which real providers have a key configured — surfaced on the health endpoint. */
export const providerAvailability = {
  openai: Boolean(env.OPENAI_API_KEY),
  anthropic: Boolean(env.ANTHROPIC_API_KEY),
  deepgram: Boolean(env.DEEPGRAM_API_KEY),
} as const;

function withBreaker<P extends { id: string }>(provider: P): Candidate<P> {
  return { provider, breaker: breakerRegistry.get(provider.id) };
}

function orderedUnique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function buildSttCandidates(): Candidate<ISttProvider>[] {
  const candidates: Candidate<ISttProvider>[] = [];
  for (const name of orderedUnique([env.STT_PROVIDER, 'openai', 'deepgram'])) {
    if (name === 'openai' && env.OPENAI_API_KEY) {
      candidates.push(
        withBreaker(
          new OpenAiSttProvider({ apiKey: env.OPENAI_API_KEY, model: env.OPENAI_TRANSCRIBE_MODEL }),
        ),
      );
    } else if (name === 'deepgram' && env.DEEPGRAM_API_KEY) {
      candidates.push(
        withBreaker(
          new DeepgramSttProvider({ apiKey: env.DEEPGRAM_API_KEY, model: env.DEEPGRAM_MODEL }),
        ),
      );
    }
  }
  candidates.push(withBreaker(new MockSttProvider()));
  return candidates;
}

function buildTranslationCandidates(): Candidate<ITranslationProvider>[] {
  const candidates: Candidate<ITranslationProvider>[] = [];
  for (const name of orderedUnique([env.TRANSLATION_PROVIDER, 'claude', 'openai'])) {
    if (name === 'claude' && env.ANTHROPIC_API_KEY) {
      candidates.push(
        withBreaker(
          new ClaudeTranslationProvider({ apiKey: env.ANTHROPIC_API_KEY, model: env.CLAUDE_MODEL }),
        ),
      );
    } else if (name === 'openai' && env.OPENAI_API_KEY) {
      candidates.push(withBreaker(new OpenAiTranslationProvider({ apiKey: env.OPENAI_API_KEY })));
    }
  }
  candidates.push(withBreaker(new MockTranslationProvider()));
  return candidates;
}

function buildTtsCandidates(): Candidate<ITtsProvider>[] {
  const candidates: Candidate<ITtsProvider>[] = [];
  if (env.TTS_PROVIDER === 'openai' && env.OPENAI_API_KEY) {
    candidates.push(
      withBreaker(new OpenAiTtsProvider({ apiKey: env.OPENAI_API_KEY, model: env.OPENAI_TTS_MODEL })),
    );
  }
  candidates.push(withBreaker(new MockTtsProvider()));
  return candidates;
}

export interface CascadeProviders {
  readonly stt: ISttProvider;
  readonly translation: ITranslationProvider;
  readonly tts: ITtsProvider;
}

/** Builds a fresh set of resilient providers for one cascade session. */
export function createCascadeProviders(onStatus?: StatusCallback): CascadeProviders {
  return {
    stt: new ResilientSttProvider(buildSttCandidates(), onStatus),
    translation: new ResilientTranslationProvider(buildTranslationCandidates(), onStatus),
    tts: new ResilientTtsProvider(buildTtsCandidates(), onStatus),
  };
}

/** Snapshot of all known breaker states, for the health/admin endpoints. */
export function breakerSnapshot(): ProviderStatusEvent[] {
  return breakerRegistry.snapshot();
}
