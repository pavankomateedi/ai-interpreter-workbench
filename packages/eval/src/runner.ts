/**
 * Eval runner. Translates every golden case with the configured translator,
 * scores BLEU + chrF against the human references, scores WER on the recorded
 * transcription fixtures, prints a report, and (against live providers) fails
 * the process if quality regresses past the configured CI gates. With no keys it
 * runs the full flow against the identity translator but skips the gates, so CI
 * still exercises the harness offline.
 *
 * Flags: `--update-baselines` writes the current aggregate to baselines.json.
 */

import { config as loadDotenv } from 'dotenv';
import { resolve } from 'node:path';
import { sentenceBleu } from './metrics/bleu.js';
import { chrf } from './metrics/chrf.js';
import { wordErrorRate } from './metrics/wer.js';
import {
  loadBaselines,
  loadDataset,
  REPO_ROOT,
  writeBaselines,
  type Baselines,
} from './dataset.js';
import { createTranslator } from './translate.js';
import { writeResult, type CaseResult, type EvalResult, type TranscriptionResult } from './reporters/jsonReporter.js';

loadDotenv({ path: resolve(REPO_ROOT, '.env') });

const LANG_NAMES: Record<string, string> = {
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  pt: 'Portuguese',
};

const BLEU_FAIL = Number(process.env.EVAL_BLEU_FAIL_THRESHOLD ?? '0.60');
const WER_FAIL = Number(process.env.EVAL_WER_FAIL_THRESHOLD ?? '0.20');
const STORE = process.env.EVAL_STORE_ENABLED === 'true';

async function main(): Promise<void> {
  const updateBaselines = process.argv.includes('--update-baselines');
  const dataset = loadDataset();
  const translator = createTranslator();

  console.log(`\nEval translator: ${translator.id} (live=${translator.live})\n`);

  const translation: CaseResult[] = [];
  for (const c of dataset.translation) {
    const [src, tgt] = c.languagePair.split('-');
    const candidate = await translator.translate(
      c.sourceText,
      LANG_NAMES[src ?? 'en'] ?? 'English',
      LANG_NAMES[tgt ?? 'es'] ?? 'Spanish',
      c.domain,
    );
    translation.push({
      id: c.id,
      languagePair: c.languagePair,
      bleu: round(sentenceBleu(c.referenceTranslation, candidate)),
      chrf: round(chrf(c.referenceTranslation, candidate)),
      candidate,
      reference: c.referenceTranslation,
    });
  }

  const transcription: TranscriptionResult[] = dataset.transcription.map((c) => ({
    id: c.id,
    wer: round(wordErrorRate(c.referenceTranscript, c.candidateTranscript)),
  }));

  const metrics = {
    bleu: round(mean(translation.map((t) => t.bleu))),
    chrf: round(mean(translation.map((t) => t.chrf))),
    wer: round(mean(transcription.map((t) => t.wer))),
  };

  const result: EvalResult = {
    timestamp: new Date().toISOString(),
    translator: translator.id,
    live: translator.live,
    metrics,
    translation,
    transcription,
  };

  printReport(result);

  if (updateBaselines) {
    const baselines: Baselines = {
      updatedAt: result.timestamp,
      translator: translator.id,
      metrics,
    };
    writeBaselines(baselines);
    console.log('\nBaselines updated.\n');
    return;
  }

  if (STORE) {
    const path = writeResult(result);
    console.log(`\nResults written to ${path}`);
  }

  evaluateGates(result);
}

function evaluateGates(result: EvalResult): void {
  const baselines = loadBaselines();
  console.log(
    `\nBaseline (${baselines.translator}): BLEU ${baselines.metrics.bleu} · ` +
      `chrF ${baselines.metrics.chrf} · WER ${baselines.metrics.wer}`,
  );

  if (!result.live) {
    console.log('\nSkipping CI gates: no live provider key configured (identity translator).\n');
    return;
  }

  const failures: string[] = [];
  if (result.metrics.bleu < BLEU_FAIL) {
    failures.push(`BLEU ${result.metrics.bleu} < ${BLEU_FAIL}`);
  }
  if (result.metrics.wer > WER_FAIL) {
    failures.push(`WER ${result.metrics.wer} > ${WER_FAIL}`);
  }

  if (failures.length > 0) {
    console.error(`\n✗ Eval gate failed: ${failures.join('; ')}\n`);
    process.exit(1);
  }
  console.log('\n✓ Eval gates passed.\n');
}

function printReport(result: EvalResult): void {
  console.log('Translation quality (BLEU / chrF):');
  for (const c of result.translation) {
    console.log(`  ${c.id} [${c.languagePair}]  BLEU ${c.bleu}  chrF ${c.chrf}`);
  }
  console.log('\nTranscription fixtures (WER):');
  for (const t of result.transcription) {
    console.log(`  ${t.id}  WER ${t.wer}`);
  }
  console.log(
    `\nAggregate: BLEU ${result.metrics.bleu} · chrF ${result.metrics.chrf} · WER ${result.metrics.wer}`,
  );
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

main().catch((err: unknown) => {
  console.error('Eval run failed:', err);
  process.exit(1);
});
