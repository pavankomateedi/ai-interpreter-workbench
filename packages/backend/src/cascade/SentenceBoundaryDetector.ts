/**
 * Detects sentence boundaries in the growing STT transcript so the cascade can
 * begin translating and synthesising a sentence before the full utterance is
 * transcribed (ADR-005). A naive split on every `.` breaks on "Dr. Smith" and
 * decimals like "2.5 mg", so a boundary is only accepted when terminal
 * punctuation is followed by whitespace and a sentence-starting character, and
 * the preceding token is not a known abbreviation.
 */

export class SentenceBoundaryDetector {
  /** Common abbreviations that end in a period but do not end a sentence. */
  private static readonly ABBREVIATIONS = new Set([
    'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'vs', 'etc',
    'no', 'fig', 'al', 'inc', 'ltd', 'co', 'dept', 'approx',
  ]);

  /** Characters that can legitimately begin a sentence (incl. Spanish ¿¡). */
  private static readonly SENTENCE_START = /[A-ZÀ-ÖØ-Þ0-9"'“(¿¡]/;

  private buffer = '';

  /**
   * Appends newly transcribed text and returns any sentences completed by it.
   * The trailing incomplete fragment stays buffered for the next append.
   */
  append(text: string): string[] {
    const incoming = text.trim();
    if (incoming.length === 0) return [];
    this.buffer = this.buffer.length === 0 ? incoming : `${this.buffer} ${incoming}`;
    return this.extract();
  }

  /**
   * Forces the buffered fragment out as a final sentence — called when STT
   * signals end-of-speech (speech_final) so the last sentence of an utterance
   * with no terminal punctuation is not dropped (CLAUDE.md Phase 3 fix).
   */
  flush(): string[] {
    const remainder = this.buffer.trim();
    this.buffer = '';
    return remainder.length > 0 ? [remainder] : [];
  }

  /** Discards buffered state (e.g. on session reset). */
  reset(): void {
    this.buffer = '';
  }

  private extract(): string[] {
    const sentences: string[] = [];
    const regex = /([.!?]+)(["'”’)\]]*)(\s+)/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(this.buffer)) !== null) {
      const punct = match[1] ?? '';
      const endIndex = match.index + match[0].length;
      const charBefore = this.buffer[match.index - 1] ?? '';
      const nextChar = this.buffer[endIndex] ?? '';

      // "2.5" — a decimal point flanked by digits is never a boundary.
      const isDecimal =
        punct === '.' && /\d/.test(charBefore) && /\d/.test(nextChar);

      const precedingWord = this.buffer
        .slice(lastIndex, match.index)
        .split(/\s+/)
        .pop()
        ?.toLowerCase()
        .replace(/[^a-zà-þ]/g, '');
      const isAbbreviation =
        punct === '.' && precedingWord !== undefined &&
        SentenceBoundaryDetector.ABBREVIATIONS.has(precedingWord);

      const startsNewSentence = SentenceBoundaryDetector.SENTENCE_START.test(nextChar);

      if (isDecimal || isAbbreviation || !startsNewSentence) {
        continue;
      }

      const sentence = this.buffer.slice(lastIndex, endIndex).trim();
      if (sentence.length > 0) sentences.push(sentence);
      lastIndex = endIndex;
    }

    this.buffer = this.buffer.slice(lastIndex);
    return sentences;
  }
}
