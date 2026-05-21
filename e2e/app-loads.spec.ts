import { expect, test } from '@playwright/test';

test.describe('App shell', () => {
  test('renders controls and language pairs from backend config', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'AI Interpreter Workbench' })).toBeVisible();

    // Mode toggle shows both architectures.
    await expect(page.getByRole('button', { name: /Realtime/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Cascade/ })).toBeVisible();

    // Language selector is populated from /api/config (minimum EN<->ES).
    const selector = page.locator('select');
    await expect(selector).toBeVisible();
    await expect(selector.locator('option', { hasText: 'English → Spanish' })).toHaveCount(1);

    // Idle until a session starts.
    await expect(page.getByText('Idle')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start session' })).toBeEnabled();
  });
});
