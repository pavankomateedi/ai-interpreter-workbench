/** Shared tokenisation for the text-quality metrics. Lowercases, normalises
 * Unicode, and splits on non-letter/number boundaries (keeping intra-word
 * apostrophes), which is adequate for BLEU/chrF/WER on the supported pairs. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0);
}
