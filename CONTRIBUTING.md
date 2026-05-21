# Contributing to AI Interpreter Workbench

This guide covers the development workflow, commit conventions, testing requirements, and code style rules for contributing to this project.

---

## Prerequisites

See [README.md — Prerequisites](./README.md#prerequisites) for system requirements.

---

## Development Workflow

### Branching

```
main          ← protected; requires PR + CI green + 1 reviewer
feature/*     ← new features (e.g. feature/elevenlabs-tts-provider)
fix/*         ← bug fixes (e.g. fix/stt-partial-missing-on-silence)
test/*        ← test additions (e.g. test/e2e-language-pair-de)
chore/*       ← non-functional (e.g. chore/update-deepgram-sdk-v4)
docs/*        ← documentation only (e.g. docs/add-eval-comparison-results)
```

All work happens on feature branches. Open a PR to `main` when the branch is ready.

### Starting a Feature

```bash
git checkout -b feature/my-feature
pnpm install          # ensure deps are current
pnpm build            # verify baseline builds
pnpm test             # verify baseline tests pass
```

### Before Opening a PR

```bash
pnpm lint             # must exit 0
pnpm tsc --noEmit     # must exit 0 (both packages)
pnpm test             # must exit 0
pnpm test:coverage    # coverage must be ≥ 80% on cascade/ and providers/
```

---

## Commit Conventions

This project uses [Conventional Commits](https://www.conventionalcommits.org/). The CI pipeline enforces commit message format via `commitlint`.

### Format

```
<type>(<scope>): <short description>

[optional body — explain WHY, not WHAT]

[optional footer: BREAKING CHANGE, Closes #issue]
```

### Types

| Type | When to use |
|------|-------------|
| `feat` | New feature visible to users or downstream code |
| `fix` | Bug fix |
| `test` | Adding or updating tests (no production code change) |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `perf` | Performance improvement |
| `docs` | Documentation only |
| `chore` | Build system, dependency updates, tooling |
| `ci` | CI/CD pipeline changes |

### Scopes

| Scope | What it covers |
|-------|---------------|
| `scaffold` | Project structure, monorepo config |
| `types` | Shared TypeScript type definitions |
| `providers` | Any provider implementation or interface |
| `cascade` | CascadePipeline, SentenceBoundaryDetector, LatencyTracker |
| `realtime` | RealtimeSession, Realtime WebSocket proxy |
| `frontend` | Any React component, hook, or Vite config |
| `eval` | Eval runner, metrics, golden data |
| `tests` | Test utilities, fixtures, Playwright config |
| `docs` | README, ARCHITECTURE, CONTRIBUTING, CLAUDE |
| `ci` | GitHub Actions workflows |

### Examples

```
feat(providers): add ElevenLabs TTS provider with streaming support

Implements ITtsProvider against the ElevenLabs v2 streaming API.
Uses PCM output format (not MP3) to avoid decode overhead.
Closes #42

---

fix(cascade): flush partial buffer on utterance end

SentenceBoundaryDetector was not flushing when STT emitted speech_final
without terminal punctuation (common in spoken lists). This caused the
last sentence of an utterance to be dropped silently.

Fixes #38

---

test(providers): add ElevenLabs compliance suite to TEST-PROV-001

---

chore(deps): upgrade @deepgram/sdk to 3.5.1

Fixes a memory leak in the streaming WebSocket client introduced in 3.4.0.
See https://github.com/deepgram/deepgram-node-sdk/issues/XXX
```

### Rules

- **One logical change per commit.** Do not bundle a bug fix with a refactor.
- **No commit may exceed 400 changed lines** (excluding `pnpm-lock.yaml`, generated files, and `golden-data/`).
- **No "WIP" commits** on PRs — squash before opening.
- **No single "initial commit"** dump — the git history should tell the story of the build.

---

## Code Style

### TypeScript

- `strict: true` is non-negotiable. No `any` without a `// eslint-disable-next-line` comment explaining why.
- Prefer `readonly` on interface properties that the consumer should not mutate.
- Use discriminated unions for event types — never `type EventType = 'partial' | 'final'` with a separate `data: unknown` field.
- Exported functions must have JSDoc comments. Internal helpers don't.

```typescript
/**
 * Transcribes a streaming audio input and emits STT events.
 * @param audioStream - PCM-16 audio at 16 kHz in Buffer chunks
 * @param config - Language and model configuration
 * @yields {SttEvent} Partial or final transcript events
 * @throws {ProviderRateLimitError} When the provider returns HTTP 429
 * @throws {ProviderTimeoutError} When no response is received within config.timeoutMs
 */
async *transcribeStream(
  audioStream: AsyncIterable<Buffer>,
  config: SttConfig,
): AsyncIterable<SttEvent> { ... }
```

### Error Handling

- **Never swallow errors silently.** Either handle (retry, fallback, skip) or re-throw as a typed error.
- Provider errors must be wrapped in the `ProviderError` hierarchy before propagating out of the provider class.
- Pipeline errors are emitted on the `pipeline.on('error', ...)` bus — never thrown.
- Frontend errors that affect the user experience must surface as a toast notification (not just console.error).

### Async

- Prefer `async/await` over raw `.then()` chains.
- Always `await` or `void` a Promise — never fire-and-forget without explicit intent.
- Use `for await...of` over manual `AsyncIterator` — it handles cleanup on break/return automatically.
- Close all streams in a `finally` block or via `using` (TypeScript 5.2+ explicit resource management).

### Naming

| Pattern | Convention |
|---------|-----------|
| Interfaces | `ISttProvider`, `ITranslationProvider` (I-prefix for interfaces) |
| Event union types | `SttEvent`, `LatencyEvent`, `TranscriptEvent` |
| Error classes | `ProviderRateLimitError`, `ProviderTimeoutError` |
| Provider implementations | `DeepgramSttProvider`, `ClaudeTranslationProvider` |
| React hooks | `useAudioCapture`, `useRealtimeMode` |
| Constants | `LATENCY_THRESHOLD_MS`, `MAX_QUEUE_SIZE` (SCREAMING_SNAKE for module-level consts) |

---

## Adding a New Provider

### 1. Implement the interface

```typescript
// packages/backend/src/providers/stt/WhisperSttProvider.ts
import type { ISttProvider, SttConfig, SttEvent } from './ISttProvider.js';

export class WhisperSttProvider implements ISttProvider {
  async *transcribeStream(
    audioStream: AsyncIterable<Buffer>,
    config: SttConfig,
  ): AsyncIterable<SttEvent> {
    // implementation
  }

  async close(): Promise<void> {
    // cleanup
  }
}
```

### 2. Run the compliance suite

```typescript
// packages/backend/tests/unit/providers/whisperStt.test.ts
import { providerComplianceTests } from '../../shared/providerComplianceTests.js';
import { WhisperSttProvider } from '../../../src/providers/stt/WhisperSttProvider.js';

providerComplianceTests('WhisperSttProvider', () => new WhisperSttProvider({
  apiKey: 'test-key',
}));
```

The compliance suite automatically validates the interface contract. All tests must pass before the provider is usable.

### 3. Register the provider

```typescript
// packages/backend/src/config/providers.ts
export const sttProviders = {
  deepgram: () => new DeepgramSttProvider({ apiKey: env.DEEPGRAM_API_KEY }),
  whisper:  () => new WhisperSttProvider({ apiKey: env.OPENAI_API_KEY }),
} satisfies Record<string, () => ISttProvider>;
```

### 4. Add golden data coverage

Add at least one golden audio sample to `golden-data/audio/` with a corresponding reference transcript and translation. Run `pnpm eval:update-baselines` to establish the new provider's baseline metrics.

### 5. Document the provider

Add a row to the language pairs table in `README.md` and document any provider-specific configuration in `.env.example`.

---

## Adding a New Language Pair

1. Add an entry to `packages/backend/src/config/languagePairs.ts`:
   ```typescript
   'en-ja': {
     source: { code: 'en', name: 'English', deepgramModel: 'nova-2' },
     target: { code: 'ja', name: 'Japanese', ttsVoice: 'shimmer' },
   },
   ```
2. Add golden audio samples: `golden-data/audio/en-ja-*.wav` (see [Golden Data Rules](./docs/requirements.docx))
3. Add reference transcripts and translations to `golden-data/transcripts/` and `golden-data/translations/`
4. Run `pnpm eval:run --pair en-ja` to measure initial quality
5. Run `pnpm eval:update-baselines` to commit the baseline
6. Add a row to the language pair table in `README.md`

No other code changes are required.

---

## Testing Requirements

### When to write tests

| Change | Required tests |
|--------|---------------|
| New provider implementation | Provider compliance suite (automatic via `providerComplianceTests`) |
| New pipeline stage | Unit test for the stage + integration test in `TEST-INT-001` variant |
| Bug fix | Regression test that fails before the fix and passes after |
| New UI component | Playwright E2E test if component is interactive |
| New error scenario | Error path unit test asserting the correct `ProviderError` subclass |
| New language pair | Eval run with golden data |

### What tests are NOT required

- Tests for pure UI styling (Tailwind classes)
- Tests for third-party SDK internals
- Tests for `console.log` output
- Tests for constants or enum values

### Test file naming

```
packages/backend/tests/
  unit/
    providers/             # one file per provider
      deepgramStt.test.ts
      claudeTranslation.test.ts
    cascade/
      cascadePipeline.test.ts
      sentenceBoundaryDetector.test.ts
      latencyTracker.test.ts
    realtime/
      realtimeSession.test.ts
  integration/
    cascadeTurn.test.ts    # full-turn with mock providers
    providerSwap.test.ts
    sessionExport.test.ts
  contracts/
    deepgramSchema.test.ts
    claudeSchema.test.ts
    openaiTtsSchema.test.ts

e2e/
  cascade-happy-path.spec.ts
  realtime-happy-path.spec.ts
  mode-switch.spec.ts
  mic-permission-denied.spec.ts
  stability-5min.spec.ts
```

---

## PR Checklist

Before requesting review, verify:

- [ ] `pnpm lint` exits 0
- [ ] `pnpm tsc --noEmit` exits 0
- [ ] `pnpm test` exits 0
- [ ] Coverage ≥ 80% on `cascade/` and `providers/` (check `pnpm test:coverage` report)
- [ ] New provider: compliance suite added and passing
- [ ] New feature: at least one integration test covering the happy path
- [ ] Bug fix: regression test added
- [ ] Commit messages follow Conventional Commits format
- [ ] No commit exceeds 400 changed lines
- [ ] `.env.example` updated if new env vars added
- [ ] `ARCHITECTURE.md` updated if a significant design decision was made
- [ ] `CLAUDE.md` updated if the agent was directed to implement this feature

---

## Code Review Guidelines

### For reviewers

- **Focus on contracts, not style.** ESLint handles style. Review whether the provider interface is being respected, error types are correct, and streaming is non-blocking.
- **Check the error path.** Ask: "what happens if the provider returns 429 here?" Most bugs in streaming pipelines are in error paths.
- **Check resource cleanup.** Ask: "is every stream closed on error and on clean shutdown?" Memory leaks in streaming code are silent until a 5-minute session.
- **Approve when:** CI is green, tests cover the new behaviour, and error paths are handled.

### For authors

- Keep PRs small. 200 lines of focused change is easier to review than 800 lines of "feature complete."
- Link to the requirement ID (e.g. "Implements FR-CAS-001") in the PR description.
- If you made a design decision that isn't obvious, add a comment in the code or update `ARCHITECTURE.md` — don't expect the reviewer to reverse-engineer intent from the diff.
