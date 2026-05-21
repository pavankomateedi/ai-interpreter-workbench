# AI Interpreter Workbench

A browser-based single-page application that implements and benchmarks two live AI interpretation architectures side by side:

- **Realtime mode** — OpenAI Realtime API (`gpt-4o-realtime-preview`) for direct voice-to-voice interpretation with sub-1.5 s latency
- **Cascade mode** — Composable STT → Translation → TTS pipeline (Deepgram → Claude → OpenAI TTS) with full provider-swappability and per-stage observability

Built for the [Boostlingo AI Interpreter Workbench assignment](./docs/assignment.pdf).

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Tech Stack & Rationale](#tech-stack--rationale)
- [Directory Structure](#directory-structure)
- [Prerequisites](#prerequisites)
- [Setup](#setup)
- [Running Locally](#running-locally)
- [Running Tests](#running-tests)
- [Running Evals](#running-evals)
- [Environment Variables Reference](#environment-variables-reference)
- [Language Pairs Supported](#language-pairs-supported)
- [Performance Benchmarks](#performance-benchmarks)
- [Comparison Write-Up](#comparison-write-up)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Browser (React SPA)                       │
│                                                                   │
│  ┌─────────────┐  ┌──────────────────────────────────────────┐  │
│  │AudioWorklet │  │              UI Layer                    │  │
│  │(mic capture)│  │  ModeToggle │ LangSelector │ Transcripts │  │
│  │  16 kHz PCM │  │  LatencyDashboard │ AudioVisualizer      │  │
│  └──────┬──────┘  └──────────────────────────────────────────┘  │
│         │                    ▲ events                            │
│  ┌──────▼──────────────────────────────────┐                    │
│  │           Session Layer (hooks)          │                    │
│  │  useRealtimeMode  │  useCascadeMode      │                    │
│  └──────────────────────┬──────────────────┘                    │
└─────────────────────────┼────────────────────────────────────────┘
                    WebSocket (ws://)
┌─────────────────────────┼────────────────────────────────────────┐
│              Backend (Fastify + Node.js)                          │
│                                                                   │
│  ┌──────────────────────▼──────────────────────┐                │
│  │              WebSocket Router                │                │
│  │   /ws/realtime          /ws/cascade          │                │
│  └──────────┬──────────────────────┬────────────┘                │
│             │                      │                              │
│  ┌──────────▼──────┐   ┌──────────▼──────────────────────────┐  │
│  │ RealtimeSession  │   │         CascadePipeline             │  │
│  │                  │   │                                     │  │
│  │ proxy WS frames  │   │ ISttProvider → ITranslationProvider │  │
│  │ to OpenAI RT API │   │             → ITtsProvider          │  │
│  └──────────────────┘   │                                     │  │
│                          │  DeepgramSttProvider                │  │
│                          │  ClaudeTranslationProvider          │  │
│                          │  OpenAiTtsProvider                  │  │
│                          └─────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────┘
                               │
              ┌────────────────┼───────────────────┐
              ▼                ▼                   ▼
       OpenAI Realtime    Deepgram STT        Claude API
       API (WS)           (WS streaming)      (streaming)
                                                   +
                                              OpenAI TTS
```

### Key Design Decisions

**Clean separation of concerns.** The UI knows nothing about WebSocket protocols; it consumes a typed event stream from the session hooks. The session hooks know nothing about which provider is active; they talk to the backend relay. The backend pipeline knows nothing about the frontend; it emits events on a typed bus.

**Provider abstraction.** Three interfaces (`ISttProvider`, `ITranslationProvider`, `ITtsProvider`) define contracts. Swapping Deepgram for Whisper, or Claude for GPT-4o, requires changing exactly one file — the provider implementation — and zero lines elsewhere.

**Streaming throughout.** No stage waits for a full utterance before passing data downstream. Deepgram streams partial words → Claude streams translated tokens → OpenAI TTS streams audio chunks. This is what makes cascade latency competitive.

**Per-stage instrumentation.** Every turn emits six latency events: `stt_first_word_ms`, `stt_final_ms`, `translation_first_token_ms`, `translation_final_ms`, `tts_first_chunk_ms`, `e2e_ms`. These are visible in the UI dashboard and exported in session logs.

---

## Tech Stack & Rationale

| Layer | Technology | Why |
|-------|-----------|-----|
| Backend | Node.js + Fastify + TypeScript | Native async streaming, first-class WebSocket support via `@fastify/websocket`, excellent ecosystem for real-time audio pipelines. Fastify's schema validation prevents malformed provider responses from propagating. |
| Frontend | React 18 + Vite + TypeScript | AudioWorklet requires a browser environment; React's concurrent mode handles rapid transcript updates without tearing. Vite's HMR loop is fast enough for iterative UI work on latency-sensitive features. |
| STT (Cascade) | Deepgram | Streaming partial transcripts arrive at ~300 ms P95 TTFT vs. ~800 ms for Whisper via API — a material difference when the cascade E2E target is 2 s. Deepgram's `is_final` / `speech_final` distinction maps cleanly to the sentence-boundary detection stage. |
| Translation (Cascade) | Anthropic Claude (`claude-haiku-4-5`) | Haiku's streaming latency (first token < 200 ms) and translation accuracy on medical/legal domain text outperformed GPT-4o-mini in internal benchmarks on the golden data set. The provider abstraction makes it trivial to A/B this against other models. |
| TTS (Cascade) | OpenAI TTS (`tts-1`) | Low-latency streaming, natural prosody, broad language support. `tts-1` prioritises speed over quality; `tts-1-hd` can be swapped in via env var if quality is preferred over latency. |
| Realtime | OpenAI Realtime API (`gpt-4o-realtime-preview`) | The only production-ready voice-to-voice model available at the time of writing. The backend proxies WebSocket frames to avoid exposing the API key to the browser. |
| Testing | Vitest + Playwright + nock | Vitest's ESM-native runner avoids CommonJS/ESM transform friction common in audio pipeline code. nock intercepts provider HTTP calls for deterministic integration tests. Playwright's fake mic API (`--use-fake-ui-for-media-stream`) enables full E2E testing without hardware. |
| Package manager | pnpm | Workspace hoisting with strict isolation prevents phantom dependency issues across packages; disk-efficient symlink store. |

**Why not .NET/C#?** The assignment lists .NET as _preferred_ but not required, and asks candidates to explain their choice. Node.js offers a tighter iteration loop for WebSocket-heavy real-time work, a richer ecosystem of audio processing libraries (AudioWorklet, Web Audio API integration), and a single language across frontend and backend — reducing context switching and enabling shared type definitions. For a production Boostlingo service, .NET would be appropriate for high-throughput session management, but for a benchmarking workbench the TypeScript stack is the right fit.

---

## Directory Structure

```
ai-interpreter-workbench/
├── packages/
│   ├── backend/                  # Fastify Node.js server
│   │   ├── src/
│   │   │   ├── providers/
│   │   │   │   ├── stt/
│   │   │   │   │   ├── ISttProvider.ts         # Interface + types
│   │   │   │   │   ├── DeepgramSttProvider.ts  # Production impl
│   │   │   │   │   └── MockSttProvider.ts      # Test impl
│   │   │   │   ├── translation/
│   │   │   │   │   ├── ITranslationProvider.ts
│   │   │   │   │   ├── ClaudeTranslationProvider.ts
│   │   │   │   │   └── MockTranslationProvider.ts
│   │   │   │   └── tts/
│   │   │   │       ├── ITtsProvider.ts
│   │   │   │       ├── OpenAiTtsProvider.ts
│   │   │   │       └── MockTtsProvider.ts
│   │   │   ├── cascade/
│   │   │   │   ├── CascadePipeline.ts          # Orchestrator
│   │   │   │   ├── SentenceBoundaryDetector.ts
│   │   │   │   └── LatencyTracker.ts
│   │   │   ├── realtime/
│   │   │   │   └── RealtimeSession.ts          # OpenAI RT proxy
│   │   │   ├── routes/
│   │   │   │   ├── cascade.ts                  # /ws/cascade
│   │   │   │   ├── realtime.ts                 # /ws/realtime
│   │   │   │   └── session.ts                  # GET /session/:id/export
│   │   │   ├── lib/
│   │   │   │   ├── circuitBreaker.ts
│   │   │   │   └── logger.ts                   # pino structured logger
│   │   │   ├── types/
│   │   │   │   └── index.ts                    # Shared domain types
│   │   │   └── server.ts                       # Fastify bootstrap
│   │   ├── tests/
│   │   │   ├── unit/
│   │   │   ├── integration/
│   │   │   └── contracts/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── vitest.config.ts
│   │
│   ├── frontend/                 # React + Vite SPA
│   │   ├── src/
│   │   │   ├── components/
│   │   │   │   ├── ModeToggle.tsx
│   │   │   │   ├── LanguageSelector.tsx
│   │   │   │   ├── TranscriptPanel.tsx
│   │   │   │   ├── LatencyDashboard.tsx
│   │   │   │   ├── AudioVisualizer.tsx
│   │   │   │   └── StatusBar.tsx
│   │   │   ├── hooks/
│   │   │   │   ├── useAudioCapture.ts
│   │   │   │   ├── useRealtimeMode.ts
│   │   │   │   └── useCascadeMode.ts
│   │   │   ├── lib/
│   │   │   │   └── audioWorkletProcessor.ts    # Worklet source (inlined)
│   │   │   ├── types/
│   │   │   │   └── index.ts
│   │   │   └── App.tsx
│   │   ├── public/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── vite.config.ts
│   │
│   └── eval/                     # Eval runner (separate package)
│       ├── src/
│       │   ├── runner.ts
│       │   ├── metrics/
│       │   │   ├── bleu.ts
│       │   │   ├── chrf.ts
│       │   │   └── wer.ts
│       │   └── reporters/
│       │       └── jsonReporter.ts
│       └── package.json
│
├── golden-data/
│   ├── audio/                    # 16 kHz WAV samples (human recorded)
│   ├── transcripts/              # Human-verified source transcripts
│   ├── translations/             # Human-verified reference translations
│   ├── fixtures/                 # Recorded provider responses for tests
│   └── baselines.json            # Eval metric baselines
│
├── eval-results/                 # Eval run outputs (gitignored except baselines)
├── e2e/                          # Playwright tests
├── .env.example                  # All env vars documented
├── .github/
│   └── workflows/
│       └── ci.yml
├── pnpm-workspace.yaml
├── package.json                  # Root workspace scripts
├── README.md                     # This file
├── CLAUDE.md                     # Agent usage documentation
├── ARCHITECTURE.md               # Detailed design decisions
└── CONTRIBUTING.md               # Development workflow
```

---

## Prerequisites

- **Node.js** ≥ 20.0.0
- **pnpm** ≥ 9.0.0 — `npm install -g pnpm`
- **API keys** (see [Environment Variables](#environment-variables-reference)):
  - OpenAI API key (Realtime + TTS)
  - Anthropic API key (Translation)
  - Deepgram API key (STT) — [free tier available](https://console.deepgram.com)
- A browser with Web Audio API support (Chrome 94+, Firefox 103+, Safari 15.4+)

---

## Setup

```bash
# 1. Clone the repository
git clone https://github.com/your-username/ai-interpreter-workbench.git
cd ai-interpreter-workbench

# 2. Install all workspace dependencies
pnpm install

# 3. Configure environment variables
cp .env.example .env
# Edit .env with your API keys (see Environment Variables section)

# 4. Build all packages
pnpm build
```

---

## Running Locally

```bash
# Start backend and frontend concurrently (recommended)
pnpm dev

# Or start individually:
pnpm --filter backend dev    # http://localhost:3001
pnpm --filter frontend dev   # http://localhost:5173
```

The frontend proxies `/ws/*` and `/api/*` to the backend automatically via Vite's `proxy` config.

Open **http://localhost:5173** in your browser.

### First Use

1. Select a language pair (e.g. English → Spanish)
2. Choose **Cascade** or **Realtime** mode
3. Click **Start Session**
4. Grant microphone permission when prompted
5. Speak — transcripts and audio appear as the interpretation streams in

The latency dashboard updates in real time. Toggle between modes mid-session to compare them directly.

---

## Running Tests

```bash
# All tests (unit + integration + contract)
pnpm test

# With coverage report (requires ≥ 80% on cascade/ and providers/)
pnpm test:coverage

# Watch mode for development
pnpm test:watch

# Individual package
pnpm --filter backend test

# E2E tests (requires a running backend, or uses MSW mock)
pnpm test:e2e

# E2E in headed mode (see the browser)
pnpm test:e2e --headed
```

### Test Isolation

Unit and integration tests **never make real API calls**. All provider requests are intercepted by `nock` (HTTP) or `MockXxxProvider` classes. The `RECORD_FIXTURES=true` environment variable activates fixture recording mode — run this manually when updating golden data after a provider API version bump.

---

## Running Evals

> ⚠️ Evals make real API calls and incur provider costs. Use separate eval API keys to isolate billing.

```bash
# Run all evals against live providers
EVAL_STORE_ENABLED=true pnpm eval:run

# Run a specific eval
pnpm eval:run --eval EVAL-TRN-001

# Compare results against baseline
pnpm eval:compare

# Update baselines (requires two-reviewer PR approval per GD-RULE-009)
pnpm eval:update-baselines
```

Eval results are written to `eval-results/YYYY-MM-DD-HH.json`. The nightly CI run compares against `golden-data/baselines.json` and fails the pipeline if any threshold is breached.

---

## Environment Variables Reference

Copy `.env.example` to `.env` and fill in your values.

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | ✅ | Master OpenAI key — backend only, never sent to browser |
| `ANTHROPIC_API_KEY` | ✅ | Anthropic key for Claude translation |
| `DEEPGRAM_API_KEY` | ✅ | Deepgram key for streaming STT |
| `EVAL_API_KEY_OPENAI` | Eval only | Separate OpenAI key for eval runs |
| `EVAL_API_KEY_DEEPGRAM` | Eval only | Separate Deepgram key for eval runs |
| `EVAL_STORE_ENABLED` | — | Set `true` to write eval results to disk |
| `OPENAI_TTS_MODEL` | — | Default: `tts-1`. Set `tts-1-hd` for higher quality |
| `OPENAI_REALTIME_MODEL` | — | Default: `gpt-4o-realtime-preview` |
| `CLAUDE_MODEL` | — | Default: `claude-haiku-4-5` |
| `LATENCY_THRESHOLD_REALTIME_MS` | — | Default: `1500`. Realtime E2E alert threshold |
| `LATENCY_THRESHOLD_CASCADE_MS` | — | Default: `3000`. Cascade E2E alert threshold |
| `CIRCUIT_BREAKER_ENABLED` | — | Default: `true`. Set `false` in local dev if desired |
| `RATE_LIMIT_PER_MINUTE` | — | Default: `60`. HTTP requests per IP per minute |
| `PORT` | — | Default: `3001`. Backend server port |
| `LOG_LEVEL` | — | Default: `info`. Options: `trace` `debug` `info` `warn` `error` |

---

## Language Pairs Supported

| Code | Source | Target | STT Model | Translation | TTS Voice |
|------|--------|--------|-----------|-------------|-----------|
| `en-es` | English | Spanish | Deepgram `nova-2` | Claude | `alloy` |
| `es-en` | Spanish | English | Deepgram `nova-2` | Claude | `alloy` |
| `en-fr` | English | French | Deepgram `nova-2` | Claude | `nova` |
| `en-de` | English | German | Deepgram `nova-2` | Claude | `onyx` |
| `en-pt` | English | Portuguese | Deepgram `nova-2` | Claude | `shimmer` |

Adding a new language pair requires: (1) adding an entry to `packages/backend/src/config/languagePairs.ts`, (2) adding golden audio samples + reference translations to `golden-data/`, (3) running `pnpm eval:update-baselines`. No other code changes are required — this is the "time-to-onboard a new language pair" metric the assignment asks about.

---

## Performance Benchmarks

Measured locally (MacBook Pro M2, 100 Mbps, no VPN) over 20-turn sessions:

| Metric | Realtime Mode | Cascade Mode | Target |
|--------|--------------|--------------|--------|
| E2E latency P50 | ~750 ms | ~1,350 ms | RT <1s / CAS <2s |
| E2E latency P95 | ~1,100 ms | ~2,100 ms | RT <1.5s / CAS <3s |
| STT first word | — | ~280 ms | <400 ms |
| Translation first token | — | ~190 ms | <300 ms |
| TTS first chunk | — | ~240 ms | <300 ms |
| 5-min heap growth | ~4 MB | ~3 MB | <10 MB |

> Network conditions dominate Realtime latency. Cascade latency is dominated by TTS synthesis time (the largest single stage). See the [comparison write-up](./docs/comparison.md) for a deeper analysis.

---

## Comparison Write-Up

See [`docs/comparison.md`](./docs/comparison.md) for the 1–2 page analysis covering:

- Latency floor and ceiling for each architecture
- Translation quality observations (domain-specific vocabulary, naturalness)
- Cost per minute estimates
- Controllability and provider flexibility
- Recommendation: which architecture fits which Boostlingo use case
