/** Writes an eval run to a timestamped JSON file under the results directory. */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ensureResultsDir } from '../dataset.js';

export interface CaseResult {
  readonly id: string;
  readonly languagePair: string;
  readonly bleu: number;
  readonly chrf: number;
  readonly candidate: string;
  readonly reference: string;
}

export interface TranscriptionResult {
  readonly id: string;
  readonly wer: number;
}

export interface EvalResult {
  readonly timestamp: string;
  readonly translator: string;
  readonly live: boolean;
  readonly metrics: { bleu: number; chrf: number; wer: number };
  readonly translation: CaseResult[];
  readonly transcription: TranscriptionResult[];
}

export function writeResult(result: EvalResult): string {
  const dir = ensureResultsDir();
  const filename = `${result.timestamp.replace(/[:.]/g, '-')}.json`;
  const path = resolve(dir, filename);
  writeFileSync(path, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  return path;
}
