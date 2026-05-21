/**
 * Compares the most recent stored eval run against the committed baselines and
 * prints the per-metric deltas. Read-only — does not change baselines.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ensureResultsDir, loadBaselines } from './dataset.js';
import type { EvalResult } from './reporters/jsonReporter.js';

function latestResult(): EvalResult | null {
  const dir = ensureResultsDir();
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort();
  const last = files.at(-1);
  if (!last) return null;
  return JSON.parse(readFileSync(resolve(dir, last), 'utf8')) as EvalResult;
}

function main(): void {
  const latest = latestResult();
  if (!latest) {
    console.log('No stored eval results. Run `pnpm eval:run` with EVAL_STORE_ENABLED=true first.');
    return;
  }
  const baselines = loadBaselines();
  console.log(`\nLatest run: ${latest.translator} @ ${latest.timestamp}`);
  console.log(`Baseline:   ${baselines.translator} @ ${baselines.updatedAt}\n`);
  for (const key of ['bleu', 'chrf', 'wer'] as const) {
    const now = latest.metrics[key];
    const base = baselines.metrics[key];
    const delta = round(now - base);
    const sign = delta >= 0 ? '+' : '';
    console.log(`  ${key.toUpperCase().padEnd(5)} ${now}  (baseline ${base}, ${sign}${delta})`);
  }
  console.log('');
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

main();
