/**
 * Deterministic in-memory TTS provider. Emits a fixed number of PCM-16 chunks
 * (a low-amplitude sine tone so playback is audible in the offline demo) then a
 * `final`. Chunk count scales with text length so longer sentences produce more
 * audio, which keeps latency instrumentation meaningful in tests.
 */

import type { ITtsProvider, TtsConfig, TtsEvent } from './ITtsProvider.js';

export interface MockTtsOptions {
  readonly id?: string;
  /** Milliseconds of audio to synthesise per source character. */
  readonly msPerChar?: number;
  /** Milliseconds of audio per emitted chunk. */
  readonly chunkMs?: number;
}

export class MockTtsProvider implements ITtsProvider {
  readonly id: string;
  private readonly msPerChar: number;
  private readonly chunkMs: number;

  constructor(options: MockTtsOptions = {}) {
    this.id = options.id ?? 'tts:mock';
    this.msPerChar = options.msPerChar ?? 60;
    this.chunkMs = options.chunkMs ?? 100;
  }

  async *synthesizeStream(text: string, config: TtsConfig): AsyncIterable<TtsEvent> {
    const totalMs = Math.max(this.chunkMs, text.length * this.msPerChar);
    const chunkCount = Math.ceil(totalMs / this.chunkMs);
    const samplesPerChunk = Math.round((config.sampleRate * this.chunkMs) / 1000);

    for (let i = 0; i < chunkCount; i += 1) {
      yield { type: 'chunk', audio: this.makeTone(samplesPerChunk, config.sampleRate, i) };
    }
    yield { type: 'final' };
  }

  async close(): Promise<void> {
    // No resources to release.
  }

  /** Generates a chunk of quiet 220 Hz sine PCM-16 (little-endian). */
  private makeTone(samples: number, sampleRate: number, chunkIndex: number): Uint8Array {
    const buffer = new Uint8Array(samples * 2);
    const view = new DataView(buffer.buffer);
    const freq = 220;
    const amplitude = 0.15 * 0x7fff;
    const phaseOffset = chunkIndex * samples;
    for (let i = 0; i < samples; i += 1) {
      const t = (phaseOffset + i) / sampleRate;
      const value = Math.round(amplitude * Math.sin(2 * Math.PI * freq * t));
      view.setInt16(i * 2, value, true);
    }
    return buffer;
  }
}
