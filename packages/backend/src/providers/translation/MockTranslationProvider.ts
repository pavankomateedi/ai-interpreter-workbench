/**
 * Deterministic in-memory translation provider. Streams tokens so the pipeline
 * exercises its token-by-token path, and produces a stable, recognisable output
 * (`[<targetLang>] <reversed words>`) that tests can assert against without a
 * real translation model. Used in tests and in the offline demo path.
 */

import type {
  ITranslationProvider,
  TranslationConfig,
  TranslationEvent,
} from './ITranslationProvider.js';

export interface MockTranslationOptions {
  readonly id?: string;
  /** Optional fixed translations keyed by source text, for exact-match tests. */
  readonly dictionary?: Readonly<Record<string, string>>;
}

export class MockTranslationProvider implements ITranslationProvider {
  readonly id: string;
  private readonly dictionary: Readonly<Record<string, string>>;

  constructor(options: MockTranslationOptions = {}) {
    this.id = options.id ?? 'translation:mock';
    this.dictionary = options.dictionary ?? {};
  }

  async *translateStream(
    text: string,
    config: TranslationConfig,
  ): AsyncIterable<TranslationEvent> {
    const translated = this.dictionary[text] ?? this.pseudoTranslate(text, config);
    const tokens = translated.split(/(\s+)/).filter((t) => t.length > 0);
    for (const token of tokens) {
      yield { type: 'token', text: token };
    }
    yield { type: 'final', text: translated };
  }

  async close(): Promise<void> {
    // No resources to release.
  }

  private pseudoTranslate(text: string, config: TranslationConfig): string {
    const tag = config.targetLang.slice(0, 2).toLowerCase();
    return `[${tag}] ${text}`;
  }
}
