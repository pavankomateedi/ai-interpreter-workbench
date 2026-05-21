/**
 * The cascade orchestrator: audio in -> STT -> SentenceBoundaryDetector ->
 * Translation -> TTS -> audio out, wired as a typed event bus rather than a
 * blocking promise chain (ADR-003). Each detected sentence is one ordered "turn"
 * processed on a concurrency-1 queue so target audio never interleaves and TTS
 * cannot outrun playback. Every stage emits a normalised event matching the
 * shared wire schema, so the UI is mode-agnostic (ADR-004).
 *
 * Per-turn latency reference points:
 *   - stt_first_word / stt_final: measured from the audio segment's start
 *   - translation_* / tts_first_chunk / e2e: measured from sentence-ready
 *     (≈ speech end), which is the benchmark's "speech end -> first audio out".
 */

import { randomUUID } from 'node:crypto';
import PQueue from 'p-queue';
import type {
  ErrorEvent,
  LatencyEvent,
  LatencyMap,
  LatencyStage,
  LanguagePairCode,
  SessionLog,
  TranscriptEvent,
  TurnLog,
} from '@workbench/types';
import type { ISttProvider, SttConfig } from '../providers/stt/ISttProvider.js';
import type {
  ITranslationProvider,
  TranslationConfig,
} from '../providers/translation/ITranslationProvider.js';
import type { ITtsProvider, TtsConfig } from '../providers/tts/ITtsProvider.js';
import { ProviderError } from '../providers/errors.js';
import { AsyncQueue } from '../lib/asyncQueue.js';
import { TypedEmitter, type EventMap } from '../lib/typedEmitter.js';
import { SentenceBoundaryDetector } from './SentenceBoundaryDetector.js';
import { LatencyTracker } from './LatencyTracker.js';

export interface CascadeAudioOut {
  readonly audio: Uint8Array;
  readonly sampleRate: number;
  readonly turnId: string;
}

export interface CascadePipelineEvents extends EventMap {
  transcript: (event: TranscriptEvent) => void;
  latency: (event: LatencyEvent) => void;
  audio: (event: CascadeAudioOut) => void;
  'turn.start': (turnId: string) => void;
  'turn.end': (turnId: string) => void;
  error: (event: ErrorEvent) => void;
  done: (log: SessionLog) => void;
}

export interface CascadePipelineDeps {
  readonly stt: ISttProvider;
  readonly translation: ITranslationProvider;
  readonly tts: ITtsProvider;
}

export interface CascadePipelineConfig {
  readonly sessionId: string;
  readonly languagePair: LanguagePairCode;
  readonly stt: SttConfig;
  readonly translation: TranslationConfig;
  readonly tts: TtsConfig;
}

interface SttSegmentMetrics {
  readonly sttFirstWordMs: number;
  readonly sttFinalMs: number;
}

export class CascadePipeline extends TypedEmitter<CascadePipelineEvents> {
  private readonly audioQueue = new AsyncQueue<Buffer>();
  private readonly sbd = new SentenceBoundaryDetector();
  private readonly turnQueue = new PQueue({ concurrency: 1 });
  private readonly latencyTracker = new LatencyTracker();
  private readonly turns: TurnLog[] = [];
  private readonly turnLatencies = new Map<string, LatencyMap>();

  private sttDone: Promise<void> = Promise.resolve();
  private startedAt = 0;
  private endedAt = 0;
  private turnCounter = 0;
  private stopped = false;

  // Segment timing for STT metrics.
  private segmentStartAt = 0;
  private firstPartialAt: number | null = null;
  private readonly liveSourceId: string;

  constructor(
    private readonly deps: CascadePipelineDeps,
    private readonly config: CascadePipelineConfig,
  ) {
    super();
    this.liveSourceId = `${config.sessionId}:live`;
  }

  /** Begins consuming audio. Call before pushing audio chunks. */
  start(): void {
    this.startedAt = Date.now();
    this.segmentStartAt = this.startedAt;
    this.sttDone = this.runStt();
  }

  /** Feeds a captured PCM-16 audio chunk into the pipeline. */
  pushAudio(chunk: Buffer): void {
    if (!this.stopped) this.audioQueue.push(chunk);
  }

  /**
   * Ends input, drains in-flight turns, closes providers, and returns the
   * session log. Safe to call once.
   */
  async stop(): Promise<SessionLog> {
    if (this.stopped) return this.buildSessionLog();
    this.stopped = true;
    this.audioQueue.end();
    await this.sttDone;

    // Flush any sentence still buffered when the speaker stopped.
    for (const sentence of this.sbd.flush()) {
      this.enqueueTurn(this.nextTurnId(), sentence, undefined);
    }
    await this.turnQueue.onIdle();
    await this.closeProviders();

    this.endedAt = Date.now();
    const log = this.buildSessionLog();
    this.emit('done', log);
    return log;
  }

  private async runStt(): Promise<void> {
    try {
      for await (const event of this.deps.stt.transcribeStream(this.audioQueue, this.config.stt)) {
        const now = Date.now();
        if (event.type === 'partial') {
          if (this.firstPartialAt === null) this.firstPartialAt = now;
          this.emit('transcript', {
            role: 'source',
            text: event.text,
            isFinal: false,
            turnId: this.liveSourceId,
            timestamp: now,
          });
          continue;
        }

        // Final STT segment: derive STT metrics, split into sentences.
        const metrics: SttSegmentMetrics = {
          sttFirstWordMs: (this.firstPartialAt ?? now) - this.segmentStartAt,
          sttFinalMs: now - this.segmentStartAt,
        };
        const sentences = this.sbd.append(event.text);
        if (event.speechFinal) sentences.push(...this.sbd.flush());

        let first = true;
        for (const sentence of sentences) {
          const turnId = this.nextTurnId();
          this.emit('transcript', {
            role: 'source',
            text: sentence,
            isFinal: true,
            turnId,
            timestamp: Date.now(),
          });
          this.enqueueTurn(turnId, sentence, first ? metrics : undefined);
          first = false;
        }

        // Next segment starts now.
        this.segmentStartAt = Date.now();
        this.firstPartialAt = null;
      }
    } catch (err) {
      this.emitError(err, undefined, false);
    }
  }

  private enqueueTurn(
    turnId: string,
    sourceText: string,
    sttMetrics: SttSegmentMetrics | undefined,
  ): void {
    void this.turnQueue.add(() => this.runTurn(turnId, sourceText, sttMetrics));
  }

  private async runTurn(
    turnId: string,
    sourceText: string,
    sttMetrics: SttSegmentMetrics | undefined,
  ): Promise<void> {
    const turnStart = Date.now();
    this.emit('turn.start', turnId);

    if (sttMetrics) {
      this.recordLatency('stt_first_word', turnId, sttMetrics.sttFirstWordMs);
      this.recordLatency('stt_final', turnId, sttMetrics.sttFinalMs);
    }

    let targetText = '';
    try {
      let firstToken = true;
      for await (const ev of this.deps.translation.translateStream(
        sourceText,
        this.config.translation,
      )) {
        if (ev.type === 'token') {
          if (firstToken) {
            firstToken = false;
            this.recordLatency('translation_first_token', turnId, Date.now() - turnStart);
          }
          targetText += ev.text;
          this.emit('transcript', {
            role: 'target',
            text: targetText,
            isFinal: false,
            turnId,
            timestamp: Date.now(),
          });
        } else {
          targetText = ev.text.length > 0 ? ev.text : targetText;
          this.recordLatency('translation_final', turnId, Date.now() - turnStart);
          this.emit('transcript', {
            role: 'target',
            text: targetText,
            isFinal: true,
            turnId,
            timestamp: Date.now(),
          });
        }
      }
    } catch (err) {
      this.emitError(err, turnId, true);
      this.recordTurn(turnId, sourceText, targetText, turnStart);
      this.emit('turn.end', turnId);
      return;
    }

    try {
      let firstChunk = true;
      for await (const ev of this.deps.tts.synthesizeStream(targetText, this.config.tts)) {
        if (ev.type === 'chunk') {
          if (firstChunk) {
            firstChunk = false;
            const e2e = Date.now() - turnStart;
            this.recordLatency('tts_first_chunk', turnId, e2e);
            this.recordLatency('e2e', turnId, e2e);
          }
          this.emit('audio', { audio: ev.audio, sampleRate: ev.sampleRate, turnId });
        }
      }
    } catch (err) {
      this.emitError(err, turnId, true);
    }

    this.recordTurn(turnId, sourceText, targetText, turnStart);
    this.emit('turn.end', turnId);
  }

  private recordLatency(stage: LatencyStage, turnId: string, ms: number): void {
    const event: LatencyEvent = {
      stage,
      turnId,
      ms: Math.max(0, Math.round(ms)),
      mode: 'cascade',
      timestamp: Date.now(),
    };
    this.latencyTracker.add(event);
    const map = { ...(this.turnLatencies.get(turnId) ?? {}) } as Record<LatencyStage, number>;
    map[stage] = event.ms;
    this.turnLatencies.set(turnId, map);
    this.emit('latency', event);
  }

  private recordTurn(
    turnId: string,
    sourceText: string,
    targetText: string,
    startedAt: number,
  ): void {
    this.turns.push({
      turnId,
      sourceText,
      targetText,
      latencies: this.turnLatencies.get(turnId) ?? {},
      startedAt,
      endedAt: Date.now(),
    });
  }

  private emitError(err: unknown, turnId: string | undefined, recoverable: boolean): void {
    if (err instanceof ProviderError) {
      this.emit('error', {
        code: err.code,
        message: err.message,
        recoverable: err.recoverable,
        ...(turnId ? { turnId } : {}),
      });
      return;
    }
    this.emit('error', {
      code: 'internal',
      message: err instanceof Error ? err.message : String(err),
      recoverable,
      ...(turnId ? { turnId } : {}),
    });
  }

  private async closeProviders(): Promise<void> {
    await Promise.allSettled([
      this.deps.stt.close(),
      this.deps.translation.close(),
      this.deps.tts.close(),
    ]);
  }

  private buildSessionLog(): SessionLog {
    return {
      sessionId: this.config.sessionId,
      mode: 'cascade',
      languagePair: this.config.languagePair,
      startedAt: this.startedAt,
      endedAt: this.endedAt || Date.now(),
      turns: this.turns,
      summary: this.latencyTracker.summary(),
    };
  }

  private nextTurnId(): string {
    this.turnCounter += 1;
    return `${this.config.sessionId}:t${this.turnCounter}:${randomUUID().slice(0, 8)}`;
  }
}
