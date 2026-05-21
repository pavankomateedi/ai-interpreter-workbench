/**
 * Deepgram streaming STT provider. Deepgram's `is_final` / `speech_final`
 * distinction maps directly onto our SttEvent: interim results become `partial`
 * events, `is_final` results become `final` events, and `speech_final` (a
 * detected pause) sets `speechFinal: true` — the strongest natural flush signal
 * for the sentence-boundary detector. No retry logic lives here; that belongs to
 * the circuit breaker (ADR-007 / CLAUDE.md Phase 2).
 */

import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk';
import type { ListenLiveClient } from '@deepgram/sdk';
import type { ISttProvider, SttConfig, SttEvent } from './ISttProvider.js';
import { AsyncQueue } from '../../lib/asyncQueue.js';
import { classifyProviderError, ProviderConnectionError } from '../errors.js';

export interface DeepgramSttOptions {
  readonly apiKey: string;
  readonly model?: string;
  readonly id?: string;
}

export class DeepgramSttProvider implements ISttProvider {
  readonly id: string;
  private readonly apiKey: string;
  private readonly model: string;
  private connection: ListenLiveClient | null = null;

  constructor(options: DeepgramSttOptions) {
    this.id = options.id ?? 'stt:deepgram';
    this.apiKey = options.apiKey;
    this.model = options.model ?? 'nova-2';
  }

  async *transcribeStream(
    audioStream: AsyncIterable<Buffer>,
    config: SttConfig,
  ): AsyncIterable<SttEvent> {
    const queue = new AsyncQueue<SttEvent>();
    const deepgram = createClient(this.apiKey);

    const connection = deepgram.listen.live({
      model: config.model ?? this.model,
      language: config.language.slice(0, 2),
      encoding: 'linear16',
      sample_rate: config.sampleRate,
      channels: 1,
      interim_results: true,
      punctuate: true,
      smart_format: true,
      endpointing: 300,
    });
    this.connection = connection;

    connection.on(LiveTranscriptionEvents.Transcript, (data: DeepgramTranscript) => {
      const alternative = data.channel?.alternatives?.[0];
      const text = alternative?.transcript ?? '';
      if (text.length === 0) return;
      const confidence = alternative?.confidence ?? 0;
      if (data.is_final) {
        queue.push({ type: 'final', text, confidence, speechFinal: Boolean(data.speech_final) });
      } else {
        queue.push({ type: 'partial', text, confidence });
      }
    });

    connection.on(LiveTranscriptionEvents.Error, (err: unknown) => {
      queue.fail(classifyProviderError(err, this.id));
    });

    connection.on(LiveTranscriptionEvents.Close, () => {
      queue.end();
    });

    // Pump audio into the connection once it is open, then iterate results. The
    // pump runs concurrently with the result iteration below.
    const pump = (async () => {
      try {
        await waitForOpen(connection);
        for await (const chunk of audioStream) {
          // Deepgram's send() types accept ArrayBuffer/Blob, not Node Buffer.
          connection.send(
            chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer,
          );
        }
        connection.requestClose();
      } catch (err) {
        queue.fail(classifyProviderError(err, this.id));
      }
    })();

    try {
      yield* queue;
    } finally {
      await pump.catch(() => undefined);
      this.connection = null;
    }
  }

  async close(): Promise<void> {
    this.connection?.requestClose();
    this.connection = null;
  }
}

function waitForOpen(connection: ListenLiveClient): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new ProviderConnectionError('Deepgram connection timed out', 'stt:deepgram')),
      5000,
    );
    connection.on(LiveTranscriptionEvents.Open, () => {
      clearTimeout(timer);
      resolve();
    });
    connection.on(LiveTranscriptionEvents.Error, (err: unknown) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/** Minimal shape of the Deepgram transcript event we read. */
interface DeepgramTranscript {
  readonly is_final?: boolean;
  readonly speech_final?: boolean;
  readonly channel?: {
    readonly alternatives?: ReadonlyArray<{
      readonly transcript?: string;
      readonly confidence?: number;
    }>;
  };
}
