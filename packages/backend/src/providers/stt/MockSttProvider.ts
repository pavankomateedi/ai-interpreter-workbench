/**
 * Deterministic in-memory STT provider. Used by the test suite (so unit and
 * integration tests never touch the network) and by the offline demo path when
 * no STT key is configured. It honours the streaming contract — emitting
 * `partial` events before each `final` — and paces output against the incoming
 * audio so the pipeline behaves realistically.
 */

import type { ISttProvider, SttConfig, SttEvent } from './ISttProvider.js';

export interface MockSttOptions {
  readonly id?: string;
  /** Final sentences to emit, in order. Each becomes partials then a final. */
  readonly script?: readonly string[];
  /** How many partial events precede each final. */
  readonly partialsPerFinal?: number;
  /** Emit one scripted event per this many audio chunks consumed. */
  readonly chunksPerEvent?: number;
}

const DEFAULT_SCRIPT = [
  'The patient has hypertension.',
  'We need to adjust the dosage.',
];

export class MockSttProvider implements ISttProvider {
  readonly id: string;
  private readonly script: readonly string[];
  private readonly partialsPerFinal: number;
  private readonly chunksPerEvent: number;
  private closed = false;

  constructor(options: MockSttOptions = {}) {
    this.id = options.id ?? 'stt:mock';
    this.script = options.script ?? DEFAULT_SCRIPT;
    this.partialsPerFinal = options.partialsPerFinal ?? 2;
    this.chunksPerEvent = Math.max(1, options.chunksPerEvent ?? 1);
  }

  async *transcribeStream(
    audioStream: AsyncIterable<Buffer>,
    _config: SttConfig,
  ): AsyncIterable<SttEvent> {
    const events = this.buildEvents();
    let cursor = 0;
    let chunkCount = 0;

    for await (const _chunk of audioStream) {
      if (this.closed) return;
      chunkCount += 1;
      if (chunkCount % this.chunksPerEvent === 0 && cursor < events.length) {
        const event = events[cursor];
        if (event) {
          cursor += 1;
          yield event;
        }
      }
    }

    // Flush any events not yet emitted when the audio stream ends.
    for (; cursor < events.length; cursor += 1) {
      const event = events[cursor];
      if (event) yield event;
    }
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  private buildEvents(): SttEvent[] {
    const events: SttEvent[] = [];
    for (const sentence of this.script) {
      const words = sentence.split(' ');
      for (let i = 1; i <= this.partialsPerFinal; i += 1) {
        const upTo = Math.ceil((words.length * i) / (this.partialsPerFinal + 1));
        events.push({
          type: 'partial',
          text: words.slice(0, Math.max(1, upTo)).join(' '),
          confidence: 0.7 + 0.1 * i,
        });
      }
      events.push({ type: 'final', text: sentence, confidence: 0.95, speechFinal: true });
    }
    return events;
  }
}
