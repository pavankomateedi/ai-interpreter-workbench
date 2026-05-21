/**
 * OpenAI TTS provider. Requests raw PCM (`response_format: 'pcm'`) so the audio
 * can be relayed straight to the browser without a decode step. OpenAI's PCM
 * output is 24 kHz signed 16-bit mono regardless of the requested rate, so each
 * chunk advertises that rate and the frontend plays it back accordingly.
 */

import OpenAI from 'openai';
import type { ITtsProvider, TtsConfig, TtsEvent } from './ITtsProvider.js';
import { classifyProviderError, ProviderEmptyResultError } from '../errors.js';
import { streamToChunks } from '../../lib/streams.js';

/** OpenAI TTS always returns PCM at this rate. */
const OPENAI_TTS_SAMPLE_RATE = 24_000;

export interface OpenAiTtsOptions {
  readonly apiKey: string;
  readonly model?: string;
  readonly id?: string;
}

export class OpenAiTtsProvider implements ITtsProvider {
  readonly id: string;
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(options: OpenAiTtsOptions) {
    this.id = options.id ?? 'tts:openai';
    this.client = new OpenAI({ apiKey: options.apiKey });
    this.model = options.model ?? 'tts-1';
  }

  async *synthesizeStream(text: string, config: TtsConfig): AsyncIterable<TtsEvent> {
    if (text.trim().length === 0) {
      yield { type: 'final' };
      return;
    }

    let emitted = false;
    try {
      const response = await this.client.audio.speech.create({
        model: config.model ?? this.model,
        voice: config.voice as OpenAI.Audio.SpeechCreateParams['voice'],
        input: text,
        response_format: 'pcm',
      });

      for await (const chunk of streamToChunks(response.body)) {
        emitted = true;
        yield {
          type: 'chunk',
          audio: new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength),
          sampleRate: OPENAI_TTS_SAMPLE_RATE,
        };
      }
    } catch (err) {
      throw classifyProviderError(err, this.id);
    }

    if (!emitted) {
      throw new ProviderEmptyResultError('OpenAI TTS produced no audio', this.id);
    }
    yield { type: 'final' };
  }

  async close(): Promise<void> {
    // Stateless HTTP client; nothing to release.
  }
}
