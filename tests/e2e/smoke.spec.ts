import { expect, test } from '@playwright/test';

test('demo page renders', async ({ page }) => {
  await page.goto('/demo/');
  await expect(page.getByTestId('demo')).toContainText('Grid demo');
});
