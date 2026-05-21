import { defineConfig, devices } from '@playwright/test';

/**
 * E2E config. Chromium's fake media device supplies microphone audio so the full
 * stack (AudioWorklet -> WebSocket -> cascade pipeline -> playback) is exercised
 * in a real browser without hardware. With no API keys the backend runs the mock
 * providers, so the cascade happy path is deterministic and offline.
 *
 * `webServer` boots the dev stack (backend + frontend) and waits for the SPA.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    permissions: ['microphone'],
    trace: 'on-first-retry',
    launchOptions: {
      args: [
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream',
        '--autoplay-policy=no-user-gesture-required',
      ],
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Start the backend and frontend separately so Playwright waits for the
  // backend's health endpoint before driving the SPA — otherwise the page can
  // load and fail its one-shot config fetch before the backend is listening.
  webServer: [
    {
      command: 'pnpm --filter @workbench/types build && pnpm --filter @workbench/backend dev',
      url: 'http://localhost:3001/api/health',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: 'pnpm --filter @workbench/frontend dev',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
