/**
 * Stream helpers. The OpenAI SDK returns a global `fetch` Response whose `body`
 * is a web `ReadableStream`, but other code paths produce Node `Readable`s. This
 * normalises both into an `AsyncIterable<Buffer>` the providers can consume.
 */

/** Iterates a web ReadableStream or a Node Readable as Buffer chunks. */
export async function* streamToChunks(body: unknown): AsyncIterable<Buffer> {
  if (body == null) return;

  // Web ReadableStream (native fetch body).
  if (typeof (body as ReadableStream<Uint8Array>).getReader === 'function') {
    const reader = (body as ReadableStream<Uint8Array>).getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value && value.byteLength > 0) yield Buffer.from(value);
      }
    } finally {
      reader.releaseLock();
    }
    return;
  }

  // Anything async-iterable (Node Readable, async generator).
  if (typeof (body as AsyncIterable<Uint8Array>)[Symbol.asyncIterator] === 'function') {
    for await (const chunk of body as AsyncIterable<Uint8Array>) {
      if (chunk && chunk.byteLength > 0) yield Buffer.from(chunk);
    }
    return;
  }

  throw new TypeError('Unsupported stream body: neither a web ReadableStream nor async-iterable');
}
