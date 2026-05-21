/**
 * Streaming speech-to-text provider contract.
 *
 * Designed from the caller's needs, not any one SDK's response shape (ADR-002):
 * the cascade pipeline needs a stream of partial words it can show immediately
 * and final segments it can feed to sentence-boundary detection. `speechFinal`
 * distinguishes "this word is final" (is_final) from "the speaker paused"
 * (speech_final) — the latter is the strongest natural flush signal.
 */

export interface SttConfig {
  /** BCP-47 locale of the spoken audio, e.g. `en-US`. */
  readonly language: string;
  /** Sample rate of the incoming PCM-16 audio (Hz). */
  readonly sampleRate: number;
  /** Optional provider model override. */
  readonly model?: string;
  /** Abort the stream if no event arrives within this many ms. */
  readonly timeoutMs?: number;
}

export type SttEvent =
  | {
      readonly type: 'partial';
      readonly text: string;
      readonly confidence: number;
    }
  | {
      readonly type: 'final';
      readonly text: string;
      readonly confidence: number;
      /** True when the provider detected end-of-speech (a natural pause). */
      readonly speechFinal: boolean;
    };

export interface ISttProvider {
  /** Logical id for status reporting and logging, e.g. `stt:openai`. */
  readonly id: string;

  /**
   * Transcribes a streaming audio input and yields STT events in order:
   * zero or more `partial` events followed by a `final` event per segment.
   * @param audioStream - PCM-16 audio at `config.sampleRate` in Buffer chunks
   * @param config - Language and model configuration
   * @yields {SttEvent} Partial or final transcript events
   * @throws {ProviderError} Any failure wrapped in the provider error hierarchy
   */
  transcribeStream(
    audioStream: AsyncIterable<Buffer>,
    config: SttConfig,
  ): AsyncIterable<SttEvent>;

  /** Releases the underlying connection/resources. Idempotent. */
  close(): Promise<void>;
}
