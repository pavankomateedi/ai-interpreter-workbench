# Architecture Decision Records

This document captures the significant architectural decisions made during the development of the AI Interpreter Workbench, why they were made, and what alternatives were considered and rejected.

---

## ADR-001 — TypeScript Fullstack over .NET/C# Backend

**Status:** Accepted

**Context:**
The assignment lists .NET/C# as the preferred backend language. TypeScript (Node.js) was chosen instead.

**Decision:**
Use TypeScript on both frontend and backend, with a shared `packages/types` package defining domain types that compile to identical shapes on both sides of the WebSocket boundary.

**Rationale:**

1. **Single-language codebase.** WebSocket frame handling, audio buffer management, and provider streaming are non-trivial. Having one language reduces context switching and means the same engineer can trace a bug from the AudioWorklet processor through the WebSocket relay into the cascade pipeline without a language boundary.

2. **Shared type definitions.** The `LatencyEvent`, `TranscriptEvent`, and `SessionLog` types are defined once and imported by both the backend emitter and the frontend consumer. In a .NET + TypeScript stack, keeping these in sync requires a code-generation step (e.g., NSwag, TypeSpec) or manual synchronisation — both add friction.

3. **Ecosystem fit for real-time audio.** The Web Audio API and AudioWorklet are browser-native JavaScript/TypeScript. The `@deepgram/sdk`, `openai`, and `@anthropic-ai/sdk` all ship first-party TypeScript clients with full streaming support. The .NET ecosystem has these providers available but as community-maintained wrappers with less streaming maturity.

4. **Fastify performance.** Fastify benchmarks at ~30,000 req/s on a single core — well above what this workbench requires — and its `@fastify/websocket` plugin handles WebSocket upgrade correctly with minimal configuration. The schema validation plugin catches malformed provider responses at the framework level.

**Alternatives rejected:**

- **.NET + SignalR:** SignalR is excellent for .NET-native WebSocket management but would have required bridging the TypeScript frontend to a C# type system, adding serialisation overhead and a code-gen pipeline.
- **Python + FastAPI:** FastAPI's async streaming is excellent and the AI library ecosystem is rich. Rejected because the frontend is TypeScript regardless, so a Python backend adds a language boundary without meaningful benefit for this workbench's scale.

**Consequences:**

- Engineers familiar only with .NET will have a learning curve on the backend
- TypeScript's `strictNullChecks` requires explicit null handling at every provider boundary — this is a feature, not a bug, for audio pipeline code where null audio chunks cause silent failures

---

## ADR-002 — Provider Interfaces Defined Before Implementations

**Status:** Accepted

**Context:**
The cascade pipeline requires three pluggable components: STT, Translation, and TTS. The assignment specifically requires that swapping a provider should be "a contained change."

**Decision:**
Define `ISttProvider`, `ITranslationProvider`, and `ITtsProvider` as TypeScript interfaces — with their full event union types and error class hierarchy — before writing a single provider implementation. No implementation was written until the interfaces compiled cleanly and had passing unit tests against a `MockXxxProvider`.

**Rationale:**

An interface defined after its implementation tends to be shaped by the implementation's constraints rather than the caller's needs. For example:

- A Deepgram-first design might return `DeepgramResult` objects from `transcribeStream()` — fine until you swap to AssemblyAI, which has a different response shape
- An OpenAI-first translation design might accept `messages[]` rather than `(text: string, config: TranslationConfig)` — coupling the pipeline to OpenAI's chat format

By designing the interface first and asking "what does the cascade pipeline need from an STT provider?" the interfaces are genuinely provider-agnostic:

```typescript
// ISttProvider — what the pipeline needs, not what Deepgram provides
interface ISttProvider {
  transcribeStream(audioStream: AsyncIterable<Buffer>, config: SttConfig): AsyncIterable<SttEvent>;
  close(): Promise<void>;
}

type SttEvent =
  | { type: 'partial'; text: string; confidence: number }
  | { type: 'final'; text: string; confidence: number; speechFinal: boolean };
```

**Alternatives rejected:**

- **Single `IInterpreter` interface** wrapping the full STT→Translation→TTS pipeline: Too coarse. Prevents mixing and matching providers at different stages (e.g., Deepgram for STT + ElevenLabs for TTS while keeping Claude for translation).
- **Abstract base classes with shared implementation:** Rejected in favour of interfaces because providers have no meaningful shared behaviour — they differ in SDK client, auth, streaming protocol, and error types.

**Consequences:**

- New providers require implementing the full interface — no partial implementations
- Provider compliance tests (`TEST-PROV-001` through `TEST-PROV-006`) validate any implementation against the interface contract automatically
- Adding a provider for a new language pair requires only: implementing the interface + configuring a language pair entry

---

## ADR-003 — Event Emitter Pattern for Cascade Pipeline

**Status:** Accepted

**Context:**
The cascade pipeline needs to coordinate three async streams (STT output → Translation output → TTS output) while emitting latency events and handling backpressure.

**Decision:**
`CascadePipeline` extends Node.js `EventEmitter`. Stages communicate via typed events on the pipeline bus rather than direct async calls or promise chains.

**Rationale:**

**The promise chain alternative:**

```typescript
// Promise chain approach — rejected
async function runTurn(audio: Buffer): Promise<AudioChunk[]> {
  const transcript = await stt.transcribe(audio);          // blocks on STT
  const translation = await translator.translate(transcript); // blocks on translation
  const audio = await tts.synthesise(translation);           // blocks on TTS
  return audio;
}
```

This has two fatal flaws for streaming interpretation:
1. It blocks at every stage — no audio plays until the entire translation is complete
2. The `await` at each boundary means STT must fully finish before translation starts, adding the full STT duration to the perceived latency

**The event emitter approach:**

```typescript
// Event emitter approach — accepted
pipeline.on('stt:partial', (event) => { /* show partial transcript */ });
pipeline.on('stt:final', (event) => { /* feed to sentence boundary detector */ });
pipeline.on('sbd:sentence', (sentence) => { /* start translation of this sentence */ });
pipeline.on('translation:token', (token) => { /* stream to UI; check if sentence ready for TTS */ });
pipeline.on('tts:chunk', (chunk) => { /* enqueue for playback */ });
pipeline.on('latency', (event) => { /* record metric */ });
```

Each stage fires and forgets. Translation of sentence N can overlap with STT of the next utterance. TTS of translated sentence 1 can start while sentence 2 is still being translated. This pipelining is what makes cascade latency competitive with realtime.

**Backpressure:** A `PQueue` with `concurrency: 1` on the TTS stage prevents the audio playback queue from growing unboundedly if TTS is faster than the speaker can listen.

**Alternatives rejected:**

- **RxJS Observable chains:** Correct approach but adds a significant dependency and learning curve. The Node.js EventEmitter is sufficient for this pipeline's fan-out requirements.
- **Message queue (Redis/BullMQ):** Over-engineered for a single-process workbench. Appropriate for a distributed production service.
- **Callback chains:** Error handling with nested callbacks is harder to reason about than typed events with a single `pipeline.on('error', ...)` handler.

**Consequences:**

- Pipeline state is distributed across event handlers — debugging requires logging at each event
- Unit testing requires asserting on emitted events (use `EventEmitter` + `once()` in tests)
- The event schema is effectively a public API — changes must be backwards-compatible

---

## ADR-004 — Realtime Proxy Normalises Events Rather Than Forwarding Raw Frames

**Status:** Accepted

**Context:**
The Realtime mode uses OpenAI's WebSocket API, which emits events like `response.audio.delta`, `conversation.item.input_audio_transcription.completed`, and `response.audio_transcript.delta`. The frontend needs transcripts and audio from both Realtime and Cascade modes.

**Decision:**
The backend Realtime proxy parses every incoming OpenAI event and emits normalised events matching the same schema the cascade pipeline uses:

```typescript
// OpenAI Realtime raw event (not forwarded to frontend):
{ type: 'conversation.item.input_audio_transcription.completed', transcript: '...' }

// Normalised event (forwarded to frontend):
{ type: 'transcript.source', text: '...', timestamp: Date.now() }

// Same type the cascade pipeline emits for source transcripts
```

**Rationale:**

If raw OpenAI frames were forwarded directly:

1. The frontend would need an `if (mode === 'realtime')` branch to parse `conversation.item.input_audio_transcription.completed` vs. `stt:final` from cascade
2. Adding a second Realtime provider (e.g., Gemini Live) would require frontend changes
3. The latency dashboard would need two implementations — one parsing OpenAI timestamps, one parsing cascade latency events

With normalised events, the frontend's `useRealtimeMode` and `useCascadeMode` hooks both call the same `onTranscript(event: TranscriptEvent)` callback. The UI layer is genuinely mode-agnostic.

**Alternatives rejected:**

- **Forward raw OpenAI events + parse in frontend:** Simpler backend but couples the frontend to OpenAI's schema. Rejected per the principle that provider specifics should not leak past the backend.
- **Transform events client-side using a "Realtime adapter":** Moves the same coupling to a frontend adapter class — equivalent complexity in the wrong layer.

**Consequences:**

- Backend must be updated when OpenAI adds new Realtime event types that carry useful data (e.g., emotion, confidence)
- The normalised schema must be versioned if the frontend and backend are deployed independently
- Latency measurement in Realtime mode is slightly less precise because the backend adds ~1ms of event parsing before forwarding — acceptable for the benchmarking use case

---

## ADR-005 — Sentence Boundary Detector as a Separate Pipeline Stage

**Status:** Accepted

**Context:**
The cascade pipeline must begin TTS synthesis before full utterance transcription is complete — otherwise cascade latency exceeds 3 seconds for any utterance longer than two sentences. The question is: where does sentence detection live?

**Decision:**
`SentenceBoundaryDetector` is a standalone class that sits between the STT stage and the Translation stage. It accumulates STT partials and emits `sentence` events when it detects a natural sentence boundary in the growing transcript.

**Rationale:**

**Alternative 1 — Detect boundaries inside Translation:**
The translation model could be prompted to emit a special token (e.g., `<SENTENCE_DONE>`) at sentence boundaries. Problem: translation models don't reliably honour this in streaming mode, and it couples the TTS trigger to translation latency — exactly what we're trying to avoid.

**Alternative 2 — Use Deepgram's utterance segmentation:**
Deepgram emits `utterance_end` events. Problem: these only fire at speech pauses (> 1000 ms silence), which is too coarse. A speaker who says "The patient has hypertension. We need to adjust the dosage." in a single breath would have both sentences translated and synthesised as one block.

**Alternative 3 — SentenceBoundaryDetector (chosen):**
A lightweight regex-based detector that watches the growing STT partial stream for:
- Terminal punctuation (`.`, `?`, `!`) followed by a capital letter
- Conjunctions that signal a new independent clause
- Known abbreviation exclusions (`Dr.`, `Mrs.`, `etc.`, decimal numbers)

This fires 200–400 ms before Deepgram's `utterance_end` event on average, which translates directly to earlier TTS synthesis and lower perceived latency.

**Consequences:**

- The SBD introduces occasional false boundaries (e.g., "I think... well, actually") — these result in short TTS utterances that sound slightly unnatural but are intelligible
- The SBD regex requires maintenance as edge cases are discovered in production — `EVAL-SBD-001` tracks false boundary rate
- False negatives (missed boundaries) cause TTS to wait for the next boundary, increasing latency for long run-on sentences

---

## ADR-006 — AudioWorklet over MediaRecorder for Audio Capture

**Status:** Accepted

**Context:**
Microphone audio must be captured and streamed to the backend for both cascade (STT) and realtime (OpenAI Realtime API) modes.

**Decision:**
Use the Web Audio API's `AudioWorklet` to capture raw 32-bit float PCM frames at the browser's native sample rate, downsample to 16 kHz PCM-16 in the worklet processor, and send 100 ms chunks via the WebSocket.

**Rationale:**

`MediaRecorder` produces encoded audio (WebM/Opus by default) in chunks whose timing is controlled by the browser and codec, not the application. Chunk sizes vary, and the encoded format requires the backend to decode before feeding to Deepgram.

`AudioWorklet` runs in a dedicated audio thread at the browser's audio rendering quantum (128 frames = ~2.9 ms at 44.1 kHz). This gives:

- **Deterministic chunk size:** 100 ms = exactly 1,600 samples at 16 kHz — consistent with Deepgram's expected chunk size
- **Raw PCM-16:** Deepgram and OpenAI Realtime both accept raw PCM-16, avoiding a decode step
- **Lower latency:** The worklet fires every 128 frames regardless of codec buffering
- **RMS level access:** The raw float samples allow the audio visualizer to compute RMS without decoding

**Consequences:**

- AudioWorklet is more complex to implement than MediaRecorder (worklet processor file, message passing, ArrayBuffer transfer)
- Some browsers (Safari < 15.4) have partial AudioWorklet support — polyfill required
- The worklet processor must be compiled separately and loaded via `audioContext.audioWorklet.addModule()`

---

## ADR-007 — Backend-Side Circuit Breakers, Not Client-Side

**Status:** Accepted

**Context:**
Provider APIs (Deepgram, Claude, OpenAI TTS) can fail transiently. The application must recover gracefully.

**Decision:**
Circuit breakers wrap provider calls on the backend, not in the frontend hooks. The frontend only sees either a successful turn event or a `SkippedTurn` event — it never retries provider calls directly.

**Rationale:**

If circuit breaker logic lived in the frontend hooks:
- Each browser tab would have its own independent circuit breaker state
- A rate limit affecting all users would not open the breaker until every tab independently hit it
- Provider status (degraded/healthy) could not be surfaced in a central admin dashboard

With backend circuit breakers:
- One open circuit breaker protects all active sessions
- The `interp_circuit_breaker_state` metric is accurate across all users
- Fallback provider selection (e.g., Claude → GPT-4o-mini) happens transparently without frontend changes

**Consequences:**

- Backend is stateful — circuit breaker state lives in process memory
- For multi-instance deployments, circuit breakers would need to be backed by Redis for shared state (out of scope for this workbench)
- The backend must expose an admin endpoint (`POST /admin/circuit-breaker/:provider/open`) for manual intervention per the incident playbook
