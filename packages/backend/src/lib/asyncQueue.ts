/**
 * A push-based async iterable. Bridges callback/event-driven sources (like a
 * WebSocket `message` handler) into an `AsyncIterable` that provider generators
 * can `for await...of`. Supports completion (`end`) and failure (`fail`) so a
 * consumer's `for await` loop terminates or throws appropriately.
 */
export class AsyncQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = [];
  private readonly waiters: Array<(result: IteratorResult<T>) => void> = [];
  private readonly rejecters: Array<(reason: unknown) => void> = [];
  private ended = false;
  private failure: { error: unknown } | null = null;

  /** Enqueue a value. Ignored once the queue has ended or failed. */
  push(value: T): void {
    if (this.ended || this.failure) return;
    const waiter = this.waiters.shift();
    if (waiter) {
      this.rejecters.shift();
      waiter({ value, done: false });
    } else {
      this.values.push(value);
    }
  }

  /** Signal normal completion. Pending and future `next()` calls resolve `done`. */
  end(): void {
    if (this.ended || this.failure) return;
    this.ended = true;
    for (const waiter of this.waiters) waiter({ value: undefined, done: true });
    this.waiters.length = 0;
    this.rejecters.length = 0;
  }

  /** Signal failure. Pending and future `next()` calls reject with `error`. */
  fail(error: unknown): void {
    if (this.ended || this.failure) return;
    this.failure = { error };
    for (const reject of this.rejecters) reject(error);
    this.waiters.length = 0;
    this.rejecters.length = 0;
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    for (;;) {
      if (this.values.length > 0) {
        yield this.values.shift() as T;
        continue;
      }
      if (this.failure) throw this.failure.error;
      if (this.ended) return;
      const result = await new Promise<IteratorResult<T>>((resolve, reject) => {
        this.waiters.push(resolve);
        this.rejecters.push(reject);
      });
      if (result.done) return;
      yield result.value;
    }
  }
}
