/**
 * The eval's translation backend. Mirrors the cascade's translation prompt but
 * calls the SDKs directly (non-streaming) for deterministic, comparable scoring.
 * Prefers Claude, falls back to OpenAI, and finally to an identity passthrough
 * so the runner still executes offline (the runner then skips the CI fail-gate,
 * since identity output is not a meaningful quality signal).
 */

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

export interface Translator {
  readonly id: string;
  /** Whether this backend produces real translations (gates only apply if true). */
  readonly live: boolean;
  translate(text: string, sourceLang: string, targetLang: string, domain: string): Promise<string>;
}

function systemPrompt(sourceLang: string, targetLang: string, domain: string): string {
  const domainGuidance =
    domain === 'general' ? '' : ` Preserve exact ${domain} terminology; do not simplify it.`;
  return (
    `Translate from ${sourceLang} to ${targetLang}. Reply with ONLY the ${targetLang} ` +
    `translation — no preamble, quotes, or notes.${domainGuidance}`
  );
}

export function createTranslator(): Translator {
  const anthropicKey = process.env.EVAL_API_KEY_ANTHROPIC ?? process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.EVAL_API_KEY_OPENAI ?? process.env.OPENAI_API_KEY;

  if (anthropicKey) {
    const client = new Anthropic({ apiKey: anthropicKey });
    const model = process.env.CLAUDE_MODEL ?? 'claude-haiku-4-5';
    return {
      id: `claude:${model}`,
      live: true,
      async translate(text, sourceLang, targetLang, domain) {
        const message = await client.messages.create({
          model,
          max_tokens: 512,
          system: systemPrompt(sourceLang, targetLang, domain),
          messages: [{ role: 'user', content: text }],
        });
        const block = message.content[0];
        return block && block.type === 'text' ? block.text.trim() : '';
      },
    };
  }

  if (openaiKey) {
    const client = new OpenAI({ apiKey: openaiKey });
    const model = 'gpt-4o-mini';
    return {
      id: `openai:${model}`,
      live: true,
      async translate(text, sourceLang, targetLang, domain) {
        const completion = await client.chat.completions.create({
          model,
          temperature: 0.2,
          messages: [
            { role: 'system', content: systemPrompt(sourceLang, targetLang, domain) },
            { role: 'user', content: text },
          ],
        });
        return completion.choices[0]?.message?.content?.trim() ?? '';
      },
    };
  }

  return {
    id: 'identity:mock',
    live: false,
    async translate(text) {
      return text;
    },
  };
}
