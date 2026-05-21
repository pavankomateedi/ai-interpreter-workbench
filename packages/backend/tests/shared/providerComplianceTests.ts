/**
 * Shared provider compliance suites. Any STT/Translation/TTS implementation can
 * be validated against its interface contract by passing a factory to one of
 * these functions — the same assertions then apply to every provider
 * automatically (ADR-002 / CONTRIBUTING "Adding a New Provider"). This is why
 * the contract lives in one place rather than being re-asserted per provider.
 */

import { describe, expect, it } from 'vitest';
import type { ISttProvider, SttEvent } from '../../src/providers/stt/ISttProvider.js';
import type {
  ITranslationProvider,
  TranslationEvent,
} from '../../src/providers/translation/ITranslationProvider.js';
import type { ITtsProvider, TtsEvent } from '../../src/providers/tts/ITtsProvider.js';

async function* audioFixture(chunks = 8): AsyncIterable<Buffer> {
  for (let i = 0; i < chunks; i++) yield Buffer.alloc(320);
}

export function runSttCompliance(name: string, factory: () => ISttProvider): void {
  describe(`STT compliance: ${name}`, () => {
    it('exposes a stable id', () => {
      expect(typeof factory().id).toBe('string');
    });

    it('yields partial events before a final, in order', async () => {
      const provider = factory();
      const events: SttEvent[] = [];
      for await (const ev of provider.transcribeStream(audioFixture(), {
        language: 'en-US',
        sampleRate: 16000,
      })) {
        events.push(ev);
      }
      await provider.close();

      expect(events.length).toBeGreaterThan(0);
      const firstFinal = events.findIndex((e) => e.type === 'final');
      expect(firstFinal).toBeGreaterThanOrEqual(0);
      // Every event before the first final is a partial.
      for (let i = 0; i < firstFinal; i++) expect(events[i]?.type).toBe('partial');
      const final = events[firstFinal];
      expect(final?.type).toBe('final');
      if (final?.type === 'final') expect(final.text.length).toBeGreaterThan(0);
    });

    it('close() is idempotent', async () => {
      const provider = factory();
      await provider.close();
      await expect(provider.close()).resolves.not.toThrow();
    });
  });
}

export function runTranslationCompliance(
  name: string,
  factory: () => ITranslationProvider,
): void {
  describe(`Translation compliance: ${name}`, () => {
    it('streams tokens then a final with the full text', async () => {
      const provider = factory();
      const events: TranslationEvent[] = [];
      for await (const ev of provider.translateStream('Hello world.', {
        sourceLang: 'English',
        targetLang: 'Spanish',
      })) {
        events.push(ev);
      }
      await provider.close();

      const final = events.at(-1);
      expect(final?.type).toBe('final');
      if (final?.type === 'final') expect(final.text.length).toBeGreaterThan(0);
      expect(events.some((e) => e.type === 'token')).toBe(true);
    });

    it('handles empty input without throwing', async () => {
      const provider = factory();
      const events: TranslationEvent[] = [];
      for await (const ev of provider.translateStream('   ', {
        sourceLang: 'English',
        targetLang: 'Spanish',
      })) {
        events.push(ev);
      }
      expect(events.at(-1)?.type).toBe('final');
    });
  });
}

export function runTtsCompliance(name: string, factory: () => ITtsProvider): void {
  describe(`TTS compliance: ${name}`, () => {
    it('streams audio chunks then a final', async () => {
      const provider = factory();
      const events: TtsEvent[] = [];
      for await (const ev of provider.synthesizeStream('Hola mundo.', {
        voice: 'alloy',
        sampleRate: 16000,
      })) {
        events.push(ev);
      }
      await provider.close();

      const chunks = events.filter((e) => e.type === 'chunk');
      expect(chunks.length).toBeGreaterThan(0);
      for (const chunk of chunks) {
        if (chunk.type === 'chunk') {
          expect(chunk.audio.byteLength).toBeGreaterThan(0);
          expect(chunk.sampleRate).toBeGreaterThan(0);
        }
      }
      expect(events.at(-1)?.type).toBe('final');
    });
  });
}
