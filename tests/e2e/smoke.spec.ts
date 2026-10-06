import { expect, test } from '@playwright/test';

test('demo renders a canvas grid', async ({ page }) => {
  await page.goto('/demo/');
  await expect(page.getByTestId('grid').locator('canvas')).toBeVisible();
});

test('the default demo is a blank 50 x 26 sheet', async ({ page }) => {
  await page.goto('/demo/');
  await page.waitForFunction(() => window.__sheet !== undefined);
  const size = await page.evaluate(() => ({ rows: window.__sheet!.rowCount, cols: window.__sheet!.colCount, cells: window.__sheet!.model.cellCount }));
  expect(size).toEqual({ rows: 50, cols: 26, cells: 0 });
  await expect(page.getByLabel('Row count')).toHaveValue('50');
  await expect(page.getByLabel('Column count')).toHaveValue('26');
});
