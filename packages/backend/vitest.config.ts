import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      // The brief asks for critical-path coverage, not full coverage. The gated
      // paths are the deterministic core: the cascade pipeline, sentence-boundary
      // detection, the circuit breaker, the provider error/fallback boundary, and
      // the mock reference providers. The live SDK adapters (Deepgram/OpenAI/
      // Claude/Realtime) require network and are validated via the shared
      // compliance suite against mocks plus the manual/E2E smoke paths.
      include: [
        'src/cascade/**',
        'src/lib/circuitBreaker.ts',
        'src/lib/asyncQueue.ts',
        'src/providers/errors.ts',
        'src/providers/resilient.ts',
        'src/providers/**/Mock*.ts',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80,
      },
    },
  },
});
