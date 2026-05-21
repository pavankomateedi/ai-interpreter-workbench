/**
 * Streaming text-to-speech provider contract.
 *
 * Emits raw PCM-16 audio chunks at `config.sampleRate` so the backend can relay
 * them straight to the browser's playback queue without a decode step. The
 * cascade synthesises one sentence at a time and the chunks stream out as they
 * are produced, so target audio starts playing mid-utterance (ADR-005).
 */

export interface TtsConfig {
  /** Provider voice id, e.g. `alloy`. */
  readonly voice: string;
  /** Desired output sample rate (Hz). */
  readonly sampleRate: number;
  /** Optional provider model override. */
  readonly model?: string;
  /** Abort if no audio arrives within this many ms. */
  readonly timeoutMs?: number;
}

export type TtsEvent =
  | { readonly type: 'chunk'; readonly audio: Uint8Array; readonly sampleRate: number }
  | { readonly type: 'final' };

export interface ITtsProvider {
  /** Logical id for status reporting and logging, e.g. `tts:openai`. */
  readonly id: string;

  /**
   * Synthesises speech for a sentence, streaming PCM-16 audio chunks.
   * @param text - The (translated) text to speak
   * @param config - Voice, sample rate, and model
   * @yields {TtsEvent} Audio chunks followed by a `final` marker
   * @throws {ProviderError} Any failure wrapped in the provider error hierarchy
   */
  synthesizeStream(text: string, config: TtsConfig): AsyncIterable<TtsEvent>;

  /** Releases any underlying resources. Idempotent. */
  close(): Promise<void>;
}
