# CLAUDE.md — Agent-Directed Development Log

This document describes how Claude (Anthropic) was used as a coding agent throughout the development of the AI Interpreter Workbench. It covers the agent workflow, the types of directives given, decisions made collaboratively, and lessons learned about directing an AI coding agent on a real-time audio/AI application.

---

## Agent Setup

**Tool used:** Claude (claude-sonnet-4-6) via Anthropic's Cowork desktop application, which provides file system access, shell execution, and web search. This qualifies as an agentic coding assistant as required by the assignment brief.

**Session approach:** Rather than using Claude for tab-completion or isolated code snippets, the entire project was planned and executed with Claude as the primary implementation agent — similar to how a senior engineer would brief a junior developer: give context, specify interfaces, review output, and course-correct.

**Key principle used throughout:** Never ask the agent to "figure out the architecture" — give it a specific, well-reasoned design and have it implement the details. The agent is excellent at filling in correct, idiomatic TypeScript given a clear structure; it is less reliable when asked to make major architectural trade-offs without guidance.

---

## Development Phases & Agent Directives

### Phase 1 — Architecture & Scaffolding

**What I directed Claude to do:**

> "Create a pnpm monorepo with three packages: backend (Fastify + TypeScript), frontend (React + Vite + TypeScript), and eval. The backend needs three provider interface files for STT, translation, and TTS before any implementations — I want to define the contracts first and implement against them."

**Why this order:** Defining interfaces before implementations forced the agent to think about the data flow (what does `transcribeStream()` return? what events does the cascade pipeline emit?) without being distracted by Deepgram SDK specifics. This prevented the common agent failure mode of building an implementation and then retrofitting an interface that doesn't generalize.

**Agent output reviewed and corrected:**
- Initial `ISttProvider` returned `AsyncIterable<string>` — changed to `AsyncIterable<SttEvent>` (a discriminated union) so consumers can distinguish partial words from sentence finals without string parsing.
- `CascadePipeline` constructor initially accepted concrete provider classes — corrected to accept interface types so tests can inject mocks without mocking modules.

---

### Phase 2 — Provider Implementations

**Directive for Deepgram:**

> "Implement DeepgramSttProvider against the ISttProvider interface. Use the @deepgram/sdk v3 streaming client. The provider must: (1) emit SttPartial events for is_final=false transcripts, (2) emit SttFinal events for speech_final=true transcripts, (3) wrap all SDK errors in ProviderError subclasses (ProviderRateLimitError, ProviderTimeoutError, ProviderConnectionError), (4) close the WebSocket cleanly on provider.close(). Do not add any retry logic here — retries belong in the circuit breaker layer."

**Why this specificity:** Telling the agent exactly what error types to use and where retry logic does/does not belong prevented it from building a tangled implementation that did both — a common mistake when agents try to be "helpful" by adding resilience inside providers rather than at the pipeline level.

**Directive for Claude Translation:**

> "Implement ClaudeTranslationProvider using the Anthropic SDK streaming messages API. The system prompt must: specify source and target language, instruct the model to output only the translation with no preamble or explanation, and specify domain (medical/legal/general) when provided. Sentence boundaries in the output should be preserved — do not merge sentences."

**Agent failure caught:** The first implementation set `max_tokens: 1024` unconditionally. For short utterances this is fine; for longer ones it would truncate. Changed to dynamically set `max_tokens` based on estimated input token count × 1.5 × language expansion ratio.

---

### Phase 3 — Cascade Pipeline Orchestration

**Directive:**

> "Build CascadePipeline as an event emitter. It consumes an STT stream, feeds SttFinal events through SentenceBoundaryDetector, feeds detected sentences to ITranslationProvider, feeds translation output to ITtsProvider. Emit the six latency events defined in the types/index.ts LatencyEvent union. The pipeline must not block: each stage processes asynchronously in parallel where possible. Use an async queue (p-queue) to prevent TTS from getting too far ahead of playback."

**What the agent got right immediately:** The async event emitter pattern, p-queue integration, and latency timestamp collection were all correct on the first attempt. This is the kind of mechanical "wire these parts together" work where agents excel.

**What required iteration:**
- Sentence boundary detection initially split on every `.` — broke on "Dr. Smith" and decimal numbers. Directed agent to use a regex that also requires a capital letter after the period and excludes known abbreviations.
- Initial pipeline did not handle the case where the STT stream ends mid-sentence (utterance with no terminal punctuation). Added a `flush()` method that forces the current buffer through translation.

---

### Phase 4 — Realtime Mode Proxy

**Directive:**

> "Build RealtimeSession as a WebSocket proxy. The backend creates an ephemeral token via POST to OpenAI's /v1/realtime/sessions using the master API key. It returns only the client_secret.value to the frontend. The backend then opens its own WebSocket to wss://api.openai.com/v1/realtime and relays frames bidirectionally between the frontend client and OpenAI. Parse incoming OpenAI events to extract transcript text and latency timestamps — do not pass raw OpenAI frames to the frontend; normalize them to the same event schema the cascade pipeline uses."

**Key design decision made here:** Initially the agent proposed forwarding raw OpenAI Realtime events directly to the frontend. Rejected this — it would couple the frontend to OpenAI's specific event schema, making it impossible to swap the Realtime provider without rewriting the UI. Normalizing events to the shared schema means the frontend is genuinely provider-agnostic.

---

### Phase 5 — Frontend SPA

**Directive:**

> "Build the React SPA. The mode toggle and language selector are stateless controlled components — lift all session state to App.tsx. The session hooks (useRealtimeMode, useCascadeMode) both accept onTranscript, onLatency, and onAudio callbacks — they don't know about the UI. The LatencyDashboard receives an array of LatencyEvent objects and computes P50/P95 internally. Use a ring buffer of size 10 for rolling averages. AudioWorklet: the processor runs at 128-frame blocks; downsample to 16 kHz PCM16 before sending to the backend WebSocket."

**Where the agent needed the most guidance:** AudioWorklet message passing. The agent initially tried to post the raw Float32Array from the worklet — this fails because ArrayBuffers are transferred (not copied) across the worklet boundary. Directed to copy to a new buffer before posting.

**Agent-generated code accepted without changes:** All Tailwind styling, the transcript panel with independent scroll containers, the latency colour-coding logic (green/amber/red thresholds), and the session log export to JSON.

---

### Phase 6 — Tests

**Directive for provider compliance tests:**

> "Write a shared test suite (providerComplianceTests.ts) that takes any ISttProvider instance and asserts: (1) transcribeStream() returns AsyncIterable<SttEvent>, (2) events arrive in order SttPartial* then SttFinal, (3) calling close() terminates the stream cleanly. Run this suite against both MockSttProvider and DeepgramSttProvider (with nock intercepting HTTP). This forces the compliance tests to live in one place and apply to every provider automatically."

**Agent pattern used well:** The shared compliance suite pattern. The agent understood immediately why this was better than per-provider test files and implemented it cleanly.

**Directive for E2E tests:**

> "In Playwright, use page.addInitScript to inject a fake AudioWorklet that replays golden audio buffer GD-001 instead of real microphone input. This avoids needing hardware permissions in CI and makes tests deterministic."

---

### Phase 7 — Documentation

**Directive:**

> "Write ARCHITECTURE.md covering the four key decisions: (1) why TypeScript over .NET, (2) why provider interfaces were defined before implementations, (3) why the cascade pipeline uses an event emitter rather than a promise chain, (4) why the Realtime proxy normalises events rather than forwarding raw frames. For each decision, include what the alternative was and why it was rejected."

The agent drafted all documentation. I reviewed and added specific latency numbers from actual test runs and corrected one claim about Deepgram's `speech_final` vs `is_final` semantics.

---

## Effective Prompting Patterns

These patterns consistently produced better agent output on this project:

### 1. Interface-first
Specify the TypeScript interface before asking for the implementation. The agent fills in the body more accurately when the contract is explicit.

```
// Good directive:
"Implement this interface: [paste interface]. The implementation uses the Deepgram SDK..."

// Less effective:
"Build a Deepgram STT provider"
```

### 2. Name the things that should NOT be in the output
Explicitly stating what to exclude prevents the agent from "helping" with things that belong elsewhere.

```
// Good:
"Do not add retry logic — retries belong in the circuit breaker"
"Do not add logging — the caller handles logging"

// Less effective:
"Keep the provider simple"
```

### 3. State the failure mode you are designing against
The agent produces better error handling when it knows what can go wrong.

```
// Good:
"The Deepgram SDK can throw on connection loss, on auth failure (401), 
 and on rate limit (429). Map each to a specific ProviderError subclass."

// Less effective:
"Handle errors properly"
```

### 4. Give the agent a concrete example of the output format
For event-emitting code, showing the expected event shape eliminates ambiguity:

```
// Good:
"Emit events matching this discriminated union: [paste LatencyEvent type]"

// Less effective:
"Emit latency events"
```

### 5. Review diffs, not just the result
After each agent output, ask "what did you change?" rather than accepting the full file. This catches unintentional removals of error handling or type constraints the agent silently simplified.

---

## Decisions NOT Made by the Agent

The following decisions were made by the human engineer and handed to the agent as constraints:

- **Monorepo structure** — the agent was told to use pnpm workspaces, not asked to choose
- **Shared event schema** between cascade and realtime modes — the agent's first instinct was mode-specific schemas
- **Sentence boundary detector placement** — between STT and Translation, not inside Translation
- **Circuit breaker location** — wrapping provider calls, not inside providers
- **Provider interface granularity** — three interfaces (STT/Translation/TTS) not one (Interpreter)
- **AudioWorklet over MediaRecorder** — for lower-latency audio capture
- **Ring buffer size (10)** for rolling latency averages — based on expected turn frequency

---

## Agent Limitations Encountered

| Limitation | Mitigation |
|------------|------------|
| Agent occasionally merged adjacent async streams incorrectly (backpressure lost) | Always review stream-handling code manually; write tests that verify backpressure |
| Agent added `any` types when generics were complex | `strict: true` in tsconfig catches these; ESLint `@typescript-eslint/no-explicit-any` flags them |
| Agent sometimes hallucinated SDK method names (especially Deepgram v3 vs v2 API) | Always provide the SDK version in the directive; verify against the actual package docs |
| Agent's first Playwright test used `page.click()` on the mic button, which doesn't work in a headless context without the fake audio device | Switched to direct hook invocation via `page.evaluate()` |
| Agent produced verbose JSDoc comments that were accurate but repetitive | Acceptable trade-off — compressed in final review pass |

---

## Git Commit Strategy

Commits were structured to reflect the iterative agent workflow:

```
feat(scaffold): initialise pnpm monorepo with backend/frontend/eval packages
feat(types): define ISttProvider, ITranslationProvider, ITtsProvider interfaces
feat(providers): implement DeepgramSttProvider with streaming partials
feat(providers): implement ClaudeTranslationProvider with sentence-preserving output
feat(providers): implement OpenAiTtsProvider with streaming audio chunks
feat(providers): add Mock*Provider implementations for testing
feat(cascade): build CascadePipeline orchestrator with latency instrumentation
feat(cascade): add SentenceBoundaryDetector with abbreviation-aware splitting
feat(realtime): implement RealtimeSession WebSocket proxy with event normalisation
feat(frontend): scaffold React SPA with AudioWorklet capture and mode hooks
feat(frontend): add TranscriptPanel, LatencyDashboard, AudioVisualizer components
feat(frontend): wire mode toggle and language selector to session hooks
test(unit): add provider compliance suite and cascade pipeline unit tests
test(integration): add full-turn integration test with mock providers
test(e2e): add Playwright E2E tests with fake mic injection
docs: add README, CLAUDE.md, ARCHITECTURE.md, CONTRIBUTING.md
chore: configure CI pipeline with lint, test, build, and E2E stages
```

Each commit was made after a working state was verified — no "WIP" commits pushed to main.
