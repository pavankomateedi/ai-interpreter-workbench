/**
 * Sentence-level BLEU-4 with add-epsilon smoothing and brevity penalty. Reported
 * as a corpus average over the dataset. Smoothing keeps a single missing higher-
 * order n-gram from zeroing the whole score on short interpretation utterances.
 */

import { tokenize } from './tokenize.js';

function ngramCounts(tokens: string[], n: number): Map<string, number> {
  const counts = new Map<string, number>();
  for (let i = 0; i + n <= tokens.length; i++) {
    const gram = tokens.slice(i, i + n).join(' ');
    counts.set(gram, (counts.get(gram) ?? 0) + 1);
  }
  return counts;
}

export function sentenceBleu(reference: string, candidate: string, maxN = 4): number {
  const ref = tokenize(reference);
  const cand = tokenize(candidate);
  if (cand.length === 0 || ref.length === 0) return 0;

  let logPrecisionSum = 0;
  for (let n = 1; n <= maxN; n++) {
    const candGrams = ngramCounts(cand, n);
    const refGrams = ngramCounts(ref, n);
    let matches = 0;
    let total = 0;
    for (const [gram, count] of candGrams) {
      total += count;
      matches += Math.min(count, refGrams.get(gram) ?? 0);
    }
    // Add-epsilon smoothing (Chen & Cherry method 1) for zero matches.
    const precision = total === 0 ? 0 : matches > 0 ? matches / total : 1 / (2 * total);
    logPrecisionSum += Math.log(precision || 1e-9);
  }

  const brevityPenalty =
    cand.length > ref.length ? 1 : Math.exp(1 - ref.length / Math.max(1, cand.length));
  return brevityPenalty * Math.exp(logPrecisionSum / maxN);
}

export function corpusBleu(pairs: ReadonlyArray<{ reference: string; candidate: string }>): number {
  if (pairs.length === 0) return 0;
  const sum = pairs.reduce((acc, p) => acc + sentenceBleu(p.reference, p.candidate), 0);
  return sum / pairs.length;
}
