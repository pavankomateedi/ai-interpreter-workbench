import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/cascade/**', 'src/providers/**'],
      thresholds: {
        // The brief asks for critical-path coverage, not full coverage. The
        // cascade pipeline and provider boundaries are the critical paths.
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80,
      },
    },
  },
});
