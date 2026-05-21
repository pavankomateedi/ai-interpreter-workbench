/**
 * chrF — character n-gram F-score (Popović, 2015). Character n-grams are robust
 * to the morphological variation common in Spanish/French/German translation and
 * correlate well with human judgement, so it complements BLEU. Uses orders 1..6
 * and beta=2 (recall weighted twice as heavily as precision).
 */

function charNgramCounts(text: string, n: number): Map<string, number> {
  const chars = [...text.replace(/\s+/g, ' ').trim()];
  const counts = new Map<string, number>();
  for (let i = 0; i + n <= chars.length; i++) {
    const gram = chars.slice(i, i + n).join('');
    counts.set(gram, (counts.get(gram) ?? 0) + 1);
  }
  return counts;
}

export function chrf(reference: string, candidate: string, maxN = 6, beta = 2): number {
  const ref = reference.toLowerCase().normalize('NFKC');
  const cand = candidate.toLowerCase().normalize('NFKC');
  if (ref.length === 0 || cand.length === 0) return 0;

  let matches = 0;
  let candTotal = 0;
  let refTotal = 0;

  for (let n = 1; n <= maxN; n++) {
    const candGrams = charNgramCounts(cand, n);
    const refGrams = charNgramCounts(ref, n);
    for (const [gram, count] of candGrams) {
      candTotal += count;
      matches += Math.min(count, refGrams.get(gram) ?? 0);
    }
    for (const count of refGrams.values()) refTotal += count;
  }

  if (candTotal === 0 || refTotal === 0) return 0;
  const precision = matches / candTotal;
  const recall = matches / refTotal;
  if (precision === 0 && recall === 0) return 0;
  const beta2 = beta * beta;
  return ((1 + beta2) * precision * recall) / (beta2 * precision + recall);
}
