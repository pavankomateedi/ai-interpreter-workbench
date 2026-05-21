import { expect, test } from '@playwright/test';

test.describe('Mode availability and mic errors', () => {
  test('disables Realtime when the server has no OpenAI key', async ({ page }) => {
    await page.goto('/');
    // In the mock/offline test environment no OpenAI key is set, so Realtime is
    // unavailable and Cascade remains usable.
    await expect(page.getByRole('button', { name: /Realtime/ })).toBeDisabled();
    await expect(page.getByRole('button', { name: /Cascade/ })).toBeEnabled();
  });

  test('surfaces a clear error when mic permission is denied', async ({ page }) => {
    // Override getUserMedia to reject as if the user denied the prompt.
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = () =>
        Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'Start session' }).click();
    await expect(page.getByText(/microphone permission denied/i)).toBeVisible();
  });

  test('switches language pair from the selector', async ({ page }) => {
    await page.goto('/');
    await page.locator('select').selectOption('en-fr');
    await expect(page.locator('select')).toHaveValue('en-fr');
  });
});
