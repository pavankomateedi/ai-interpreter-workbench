import { expect, test } from '@playwright/test';

test.describe('Cascade session (mock providers, fake mic)', () => {
  test('streams source and target transcripts and a latency reading', async ({ page }) => {
    await page.goto('/');

    // Cascade is the default mode; start a session.
    await page.getByRole('button', { name: 'Start session' }).click();

    // The session goes live and the mock STT scripted transcript appears.
    await expect(page.getByText('Live', { exact: true })).toBeVisible();
    await expect(page.getByText(/hypertension/i).first()).toBeVisible();

    // A target-language line is produced (mock translation prefixes the text).
    await expect(page.getByText(/\[sp\]/i).first()).toBeVisible();

    // The per-stage latency dashboard records an end-to-end measurement.
    await expect(page.getByText('End-to-end', { exact: true })).toBeVisible();
    await expect(page.getByText(/\d+ ms/).first()).toBeVisible();

    // Stop and confirm export becomes available.
    await page.getByRole('button', { name: 'Stop' }).click();
    await expect(page.getByRole('button', { name: 'Export JSON' })).toBeEnabled();
  });
});
