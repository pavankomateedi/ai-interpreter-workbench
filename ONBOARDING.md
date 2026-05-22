# Onboarding / Continuation Guide — AI Interpreter Workbench

Pick-up context for continuing this project in a fresh session. Last updated 2026-05-22.

## What it is

A browser SPA that runs **live speech interpretation two ways and compares them**:
- **Realtime mode** — OpenAI Realtime API (`gpt-realtime`), voice↔voice via a backend WS proxy.
- **Cascade mode** — streaming **STT → Translation → TTS** with swappable providers and per-stage latency.

Boostlingo engineering take-home. All 8 functional must-haves are built: SPA mic capture + playback, both modes, mode toggle (mid/pre-session), language pairs (EN↔ES + fr/de/pt), live source/target transcripts, per-stage latency display, and the comparison write-up (`docs/comparison.md`).

## Where things live

- **Local repo (standalone, tracks GitHub):** `c:\Pavan\AI Projects\Guantlet\Week4 - Boostlingo\Boostlingo`
- **GitHub (public):** <https://github.com/pavankomateedi/ai-interpreter-workbench> — `main`, CI green.
- **Live deploy:** <http://ai-interpreter-workbench.us-east-2.elasticbeanstalk.com> (AWS Elastic Beanstalk).
- **Iterate loop:** edit → `git commit` → `git push`. Redeploy with the snippet in `DEPLOY.md §0`.

> ⚠️ The local folder is its **own git repo**. It sits inside a separate parent repo at `C:\Pavan\AI Projects` (incidental — our history was isolated out of it via `git subtree split`). Always run git from inside the `Boostlingo` folder.

## Architecture (TypeScript pnpm monorepo)

- `packages/types` — shared wire protocol + events (build first: `pnpm --filter @workbench/types build`).
- `packages/backend` — Fastify; `/ws/cascade` + `/ws/realtime` (one protocol), REST (`/api/config|health|sessions|admin`). Provider interfaces (`ISttProvider`/`ITranslationProvider`/`ITtsProvider`) + impls (OpenAI/Deepgram STT, Claude/OpenAI translation, OpenAI TTS, Mocks), `CascadePipeline` (event-bus, p-queue, sentence-boundary detector), circuit breakers + resilient fallback chains, `RealtimeSession` (event normalisation). In production the backend also serves the built SPA (single origin).
- `packages/frontend` — React 18 + Vite + Tailwind. AudioWorklet capture (16 kHz PCM), `useInterpreterSession` hook, transcript/latency/visualizer components.
- `packages/eval` — BLEU/chrF/WER metrics + golden data + runner with CI gates.

## Run & verify

```bash
pnpm install
pnpm dev          # backend :3001 + frontend :5173  (open http://localhost:5173)
# verify
pnpm lint && pnpm -r exec tsc --noEmit
pnpm --filter @workbench/backend test:coverage   # 36 tests, ~90% on critical paths
pnpm --filter @workbench/eval test                # 11 metric tests
pnpm build
pnpm test:e2e     # 5 Playwright tests (needs: pnpm exec playwright install chromium)
pnpm eval:run     # offline harness (skips gates without keys)
```

**Mock/offline mode:** with no API keys the cascade runs end-to-end with deterministic mock providers (scripted transcript, `[sp] ...` translation). Realtime mode requires `OPENAI_API_KEY`.

## Deploy facts (AWS EB)

- Account 119112823258, region us-east-2, IAM user `YourAIAWSCLIUser`. `aws.exe` at `C:\Program Files\Amazon\AWSCLIV2\aws.exe` (not on PATH in fresh shells). No `eb` CLI — deploy via raw `aws` CLI.
- App `interpreter-workbench`, env `interpreter-workbench-env` (`e-vajwgqm8ig`), single `t3.small`, AL2023 Docker. Bundle = `git archive HEAD` → S3 `elasticbeanstalk-us-east-2-119112823258`.
- **EB WebSocket gotcha (solved):** the container port is EXPOSEd but not host-published, so EB nginx proxies over the Docker bridge `172.17.0.2:3001`, not `127.0.0.1`. Handled in `.platform/nginx/conf.d/elasticbeanstalk/websocket.conf`. Without it `/ws/*` 502s.

## Outstanding / next steps

1. **Set real API keys on the live env** (still mock mode) — run the `update-environment --option-settings` command in `DEPLOY.md §0` with `OPENAI_API_KEY` + `ANTHROPIC_API_KEY` (run it yourself so keys aren't logged).
2. **Exercise live providers with real keys** — the OpenAI realtime-transcription WS, Claude/OpenAI translation, OpenAI TTS, and the `gpt-realtime` proxy are written but only smoke-tested in mock mode. The OpenAI Realtime transcription event schema is the highest-risk spot.
3. **Optional:** GitHub Actions push-to-deploy (`.github/workflows/deploy.yml` no-ops until repo secrets `AWS_ACCESS_KEY_ID`/`SECRET` + vars `AWS_REGION`/`EB_APPLICATION_NAME`/`EB_ENVIRONMENT_NAME` are set); HTTPS (load-balanced env + ACM cert, or CloudFront).
4. **Docker image never built locally** (Docker Desktop daemon was off); EB builds it on-instance fine, but `docker build -t interpreter-workbench .` is worth running once.
5. **Cost:** a `t3.small` is billing now — `aws elasticbeanstalk terminate-environment --environment-id e-vajwgqm8ig` when done.

## Conventions

ESM throughout (NodeNext, `.js` import specifiers in backend). Conventional Commits, scoped, <400 lines/commit. Strict TS, `no-explicit-any`. Don't revert the backend entry-point detection to `import.meta.url.endsWith(...)` — it broke `tsx watch` (now uses a realpath compare).
