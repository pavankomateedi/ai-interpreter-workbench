/** Loads the golden dataset and resolves golden-data paths from the repo root. */

import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LanguagePairCode } from '@workbench/types';

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(here, '../../..');
export const GOLDEN_DIR = resolve(REPO_ROOT, 'golden-data');
export const RESULTS_DIR = resolve(REPO_ROOT, process.env.EVAL_RESULTS_DIR ?? 'eval-results');

export interface TranslationCase {
  readonly id: string;
  readonly languagePair: LanguagePairCode;
  readonly domain: 'general' | 'medical' | 'legal';
  readonly sourceText: string;
  readonly referenceTranslation: string;
}

export interface TranscriptionCase {
  readonly id: string;
  readonly languagePair: LanguagePairCode;
  readonly referenceTranscript: string;
  readonly candidateTranscript: string;
}

export interface Dataset {
  readonly translation: TranslationCase[];
  readonly transcription: TranscriptionCase[];
}

export function loadDataset(): Dataset {
  const raw = readFileSync(resolve(GOLDEN_DIR, 'dataset.json'), 'utf8');
  const parsed = JSON.parse(raw) as Dataset;
  return { translation: parsed.translation ?? [], transcription: parsed.transcription ?? [] };
}

export interface Baselines {
  updatedAt: string;
  translator: string;
  metrics: { bleu: number; chrf: number; wer: number };
}

export function loadBaselines(): Baselines {
  const raw = readFileSync(resolve(GOLDEN_DIR, 'baselines.json'), 'utf8');
  return JSON.parse(raw) as Baselines;
}

export function writeBaselines(baselines: Baselines): void {
  writeFileSync(
    resolve(GOLDEN_DIR, 'baselines.json'),
    `${JSON.stringify(baselines, null, 2)}\n`,
    'utf8',
  );
}

export function ensureResultsDir(): string {
  mkdirSync(RESULTS_DIR, { recursive: true });
  return RESULTS_DIR;
}
