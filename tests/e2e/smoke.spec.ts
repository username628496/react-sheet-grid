import { expect, test } from '@playwright/test';

test('demo renders a canvas grid', async ({ page }) => {
  await page.goto('/demo/');
  await expect(page.getByTestId('grid').locator('canvas')).toBeVisible();
});
