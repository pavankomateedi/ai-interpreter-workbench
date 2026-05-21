/**
 * Loads the backend's `/api/config` once on startup. It tells the UI which
 * language pairs exist, whether Realtime mode is available (needs an OpenAI key),
 * the latency thresholds used for dashboard colour coding, and which models back
 * each mode — so this knowledge lives in one place (the backend) not duplicated
 * in the frontend.
 */

import type { LanguagePair, LanguagePairCode, Mode } from '@workbench/types';

export interface LatencyThresholds {
  realtimeE2e: number;
  cascadeE2e: number;
  sttFirstWord: number;
  translationFirstToken: number;
  ttsFirstChunk: number;
}

export interface WorkbenchConfig {
  modes: Mode[];
  realtimeAvailable: boolean;
  defaultLanguagePair: LanguagePairCode;
  languagePairs: LanguagePair[];
  providerAvailability: { openai: boolean; anthropic: boolean; deepgram: boolean };
  latencyThresholds: LatencyThresholds;
  audio: { sampleRate: number; chunkMs: number };
  models: { realtime: string; transcribe: string; tts: string; translation: string };
}

export async function fetchConfig(retries = 5, delayMs = 600): Promise<WorkbenchConfig> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch('/api/config');
      if (!response.ok) throw new Error(`Failed to load config: ${response.status}`);
      return (await response.json()) as WorkbenchConfig;
    } catch (err) {
      // The backend may still be starting (dev) — retry a few times before giving up.
      lastError = err;
      if (attempt < retries) await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Failed to load config');
}
