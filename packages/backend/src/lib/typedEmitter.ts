/**
 * A thin, type-safe wrapper over Node's EventEmitter. Gives the cascade pipeline
 * a strongly-typed event bus so listeners and emit calls are checked against a
 * declared event map (CONTRIBUTING: discriminated, no `data: unknown`).
 */

import { EventEmitter } from 'node:events';

export type EventMap = Record<string, (...args: never[]) => void>;

export class TypedEmitter<T extends EventMap> {
  private readonly emitter = new EventEmitter();

  constructor() {
    // Pipelines fan out to several listeners (UI relay, session logger, metrics).
    this.emitter.setMaxListeners(50);
  }

  on<K extends keyof T & string>(event: K, listener: T[K]): this {
    this.emitter.on(event, listener as unknown as (...args: unknown[]) => void);
    return this;
  }

  once<K extends keyof T & string>(event: K, listener: T[K]): this {
    this.emitter.once(event, listener as unknown as (...args: unknown[]) => void);
    return this;
  }

  off<K extends keyof T & string>(event: K, listener: T[K]): this {
    this.emitter.off(event, listener as unknown as (...args: unknown[]) => void);
    return this;
  }

  emit<K extends keyof T & string>(event: K, ...args: Parameters<T[K]>): boolean {
    return this.emitter.emit(event, ...args);
  }

  removeAllListeners(): void {
    this.emitter.removeAllListeners();
  }
}
