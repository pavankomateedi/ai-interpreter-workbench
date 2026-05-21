/**
 * Word Error Rate — the STT quality metric. WER = (substitutions + deletions +
 * insertions) / reference word count, via word-level Levenshtein distance. Used
 * to score a transcription hypothesis against a human-verified reference.
 */

import { tokenize } from './tokenize.js';

export function wordErrorRate(reference: string, hypothesis: string): number {
  const ref = tokenize(reference);
  const hyp = tokenize(hypothesis);
  if (ref.length === 0) return hyp.length === 0 ? 0 : 1;

  // Levenshtein distance over word tokens.
  const prev = new Array<number>(hyp.length + 1);
  const curr = new Array<number>(hyp.length + 1);
  for (let j = 0; j <= hyp.length; j++) prev[j] = j;

  for (let i = 1; i <= ref.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= hyp.length; j++) {
      const cost = ref[i - 1] === hyp[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        (prev[j] ?? 0) + 1, // deletion
        (curr[j - 1] ?? 0) + 1, // insertion
        (prev[j - 1] ?? 0) + cost, // substitution / match
      );
    }
    for (let j = 0; j <= hyp.length; j++) prev[j] = curr[j] ?? 0;
  }

  return (prev[hyp.length] ?? 0) / ref.length;
}
