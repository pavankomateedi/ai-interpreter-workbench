/**
 * OpenAI translation provider (Chat Completions, streamed). A swappable sibling
 * to the Claude provider — implementing the same interface against a different
 * vendor proves the abstraction (swapping translation providers is one config
 * line, ADR-002) and gives the circuit breaker a fallback target.
 */

import OpenAI from 'openai';
import type {
  ITranslationProvider,
  TranslationConfig,
  TranslationEvent,
} from './ITranslationProvider.js';
import { classifyProviderError } from '../errors.js';

export interface OpenAiTranslationOptions {
  readonly apiKey: string;
  readonly model?: string;
  readonly id?: string;
}

export class OpenAiTranslationProvider implements ITranslationProvider {
  readonly id: string;
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(options: OpenAiTranslationOptions) {
    this.id = options.id ?? 'translation:openai';
    this.client = new OpenAI({ apiKey: options.apiKey });
    this.model = options.model ?? 'gpt-4o-mini';
  }

  async *translateStream(
    text: string,
    config: TranslationConfig,
  ): AsyncIterable<TranslationEvent> {
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      yield { type: 'final', text: '' };
      return;
    }

    let accumulated = '';
    try {
      const stream = await this.client.chat.completions.create({
        model: config.model ?? this.model,
        temperature: 0.2,
        stream: true,
        messages: [
          { role: 'system', content: buildSystemPrompt(config) },
          { role: 'user', content: trimmed },
        ],
      });

      for await (const part of stream) {
        const token = part.choices[0]?.delta?.content;
        if (token) {
          accumulated += token;
          yield { type: 'token', text: token };
        }
      }
    } catch (err) {
      throw classifyProviderError(err, this.id);
    }

    yield { type: 'final', text: accumulated.trim() };
  }

  async close(): Promise<void> {
    // Stateless HTTP client; nothing to release.
  }
}

function buildSystemPrompt(config: TranslationConfig): string {
  const domain = config.domain ?? 'general';
  const domainGuidance =
    domain === 'general' ? '' : ` Preserve exact ${domain} terminology; do not simplify it.`;
  return (
    `You are a professional live interpreter translating from ${config.sourceLang} to ` +
    `${config.targetLang}. Reply with ONLY the ${config.targetLang} translation — no ` +
    `preamble, quotes, or notes. Preserve sentence boundaries, proper nouns, and ` +
    `numbers.${domainGuidance}`
  );
}
