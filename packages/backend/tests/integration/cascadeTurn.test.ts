import { describe, expect, it } from 'vitest';
import type { CascadeAudioOut } from '../../src/cascade/CascadePipeline.js';
import { CascadePipeline } from '../../src/cascade/CascadePipeline.js';
import { MockSttProvider } from '../../src/providers/stt/MockSttProvider.js';
import { MockTranslationProvider } from '../../src/providers/translation/MockTranslationProvider.js';
import { MockTtsProvider } from '../../src/providers/tts/MockTtsProvider.js';
import type { LatencyEvent, TranscriptEvent } from '@workbench/types';

function buildPipeline(): CascadePipeline {
  return new CascadePipeline(
    {
      stt: new MockSttProvider({
        script: ['The patient has hypertension.', 'We adjust the dosage.'],
      }),
      translation: new MockTranslationProvider(),
      tts: new MockTtsProvider({ chunkMs: 100, msPerChar: 5 }),
    },
    {
      sessionId: 's1',
      languagePair: 'en-es',
      stt: { language: 'en-US', sampleRate: 16000 },
      translation: { sourceLang: 'English', targetLang: 'Spanish' },
      tts: { voice: 'alloy', sampleRate: 16000 },
    },
  );
}

describe('CascadePipeline full turn (mock providers)', () => {
  it('streams source/target transcripts, audio, and latency for each sentence', async () => {
    const pipeline = buildPipeline();
    const sourceFinals: string[] = [];
    const targetFinals: string[] = [];
    const audioChunks: CascadeAudioOut[] = [];
    const latencies: LatencyEvent[] = [];

    pipeline.on('transcript', (e: TranscriptEvent) => {
      if (!e.isFinal) return;
      if (e.role === 'source') sourceFinals.push(e.text);
      else targetFinals.push(e.text);
    });
    pipeline.on('audio', (e) => audioChunks.push(e));
    pipeline.on('latency', (e) => latencies.push(e));

    pipeline.start();
    for (let i = 0; i < 12; i += 1) pipeline.pushAudio(Buffer.alloc(320));
    const log = await pipeline.stop();

    // Two sentences => two turns, each with a source and target final.
    expect(sourceFinals).toEqual([
      'The patient has hypertension.',
      'We adjust the dosage.',
    ]);
    expect(targetFinals).toHaveLength(2);
    expect(targetFinals[0]).toContain('The patient has hypertension.');

    // Audio streamed out for the turns.
    expect(audioChunks.length).toBeGreaterThan(0);
    expect(audioChunks[0]?.sampleRate).toBe(16000);

    // Latency: an e2e measurement was recorded per turn.
    const e2e = latencies.filter((l) => l.stage === 'e2e');
    expect(e2e).toHaveLength(2);
    expect(e2e.every((l) => l.ms >= 0 && l.mode === 'cascade')).toBe(true);

    // Session log captures both turns and a summary.
    expect(log.turns).toHaveLength(2);
    expect(log.summary.turnCount).toBe(2);
    expect(log.summary.p50.e2e).toBeGreaterThanOrEqual(0);
    expect(log.mode).toBe('cascade');
  });

  it('orders turns and emits turn.start/turn.end pairs', async () => {
    const pipeline = buildPipeline();
    const order: string[] = [];
    pipeline.on('turn.start', (id) => order.push(`start:${id}`));
    pipeline.on('turn.end', (id) => order.push(`end:${id}`));

    pipeline.start();
    for (let i = 0; i < 12; i += 1) pipeline.pushAudio(Buffer.alloc(320));
    await pipeline.stop();

    // Concurrency 1: each turn fully ends before the next starts.
    expect(order).toHaveLength(4);
    expect(order[0]?.startsWith('start:')).toBe(true);
    expect(order[1]?.startsWith('end:')).toBe(true);
    expect(order[2]?.startsWith('start:')).toBe(true);
    expect(order[3]?.startsWith('end:')).toBe(true);
  });
});
