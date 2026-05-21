/**
 * Streaming translation provider contract.
 *
 * Translation operates one sentence at a time: the cascade feeds it a complete
 * sentence detected by the SentenceBoundaryDetector and streams the translated
 * tokens out so TTS can begin before the full sentence is translated. The
 * interface takes `(text, config)` rather than a chat-message array so it is not
 * coupled to any one model's prompt format (ADR-002).
 */

export type TranslationDomain = 'general' | 'medical' | 'legal';

export interface TranslationConfig {
  /** Human-readable source language name, e.g. `English`. */
  readonly sourceLang: string;
  /** Human-readable target language name, e.g. `Spanish`. */
  readonly targetLang: string;
  /** Domain hint that tunes terminology handling. */
  readonly domain?: TranslationDomain;
  /** Optional provider model override. */
  readonly model?: string;
  /** Abort if no token arrives within this many ms. */
  readonly timeoutMs?: number;
}

export type TranslationEvent =
  | { readonly type: 'token'; readonly text: string }
  | { readonly type: 'final'; readonly text: string };

export interface ITranslationProvider {
  /** Logical id for status reporting and logging, e.g. `translation:claude`. */
  readonly id: string;

  /**
   * Translates a single source sentence, streaming the result token by token.
   * @param text - One complete source-language sentence
   * @param config - Source/target languages and domain
   * @yields {TranslationEvent} Incremental tokens then a `final` with full text
   * @throws {ProviderError} Any failure wrapped in the provider error hierarchy
   */
  translateStream(text: string, config: TranslationConfig): AsyncIterable<TranslationEvent>;

  /** Releases any underlying resources. Idempotent. */
  close(): Promise<void>;
}
