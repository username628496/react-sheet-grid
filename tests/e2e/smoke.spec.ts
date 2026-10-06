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

test.describe('the default demo keeps your work across reloads', () => {
  test('values, formulas, formatting and the row count survive a reload', async ({ page }) => {
    await page.goto('/demo/');
    await page.waitForFunction(() => window.__grid !== undefined);
    await page.evaluate(() => {
      const s = window.__sheet!;
      s.setCellInput(0, 0, '5');
      s.setCellInput(1, 0, '=A1*2');
      s.selection.selectCell(0, 0);
      s.toggleStyle('bold');
      s.cols.setSize(1, 160);
    });
    await page.getByLabel('Row count').fill('80');
    await page.getByLabel('Row count').press('Enter');
    await expect(page.getByTestId('save-status')).toHaveText('Saved');

    await page.reload();
    await page.waitForFunction(() => window.__grid !== undefined);
    const restored = await page.evaluate(() => {
      const s = window.__sheet!;
      return {
        a1: s.getCellByView(0, 0).value,
        a2: s.getCellByView(1, 0).value,
        formula: s.getEditText(1, 0),
        bold: s.styles.get(s.getCellByView(0, 0).styleId).bold,
        rows: s.rowCount,
        undoable: s.history.canUndo,
      };
    });
    expect(restored).toEqual({ a1: 5, a2: 10, formula: '=A1*2', bold: true, rows: 80, undoable: false });
    await expect(page.getByLabel('Row count')).toHaveValue('80');
  });

  test('Reset discards the saved sheet', async ({ page }) => {
    await page.goto('/demo/');
    await page.waitForFunction(() => window.__grid !== undefined);
    await page.evaluate(() => window.__sheet!.setCellInput(0, 0, 'gone soon'));
    await expect(page.getByTestId('save-status')).toHaveText('Saved');
    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'Reset' }).click();
    await page.waitForFunction(() => window.__grid !== undefined && window.__sheet!.model.cellCount === 0);
    expect(await page.evaluate(() => window.__sheet!.rowCount)).toBe(50);
  });

  test('a corrupt save starts a blank sheet and says so', async ({ page }) => {
    await page.goto('/demo/');
    await page.waitForFunction(() => window.__grid !== undefined);
    await page.evaluate(
      () =>
        new Promise<void>((resolve, reject) => {
          const open = indexedDB.open('react-data-grid-demo', 1);
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const tx = open.result.transaction('sheets', 'readwrite');
            tx.objectStore('sheets').put({ version: 99 }, 'default');
            tx.oncomplete = () => resolve();
          };
        }),
    );
    await page.reload();
    await page.waitForFunction(() => window.__grid !== undefined);
    await expect(page.getByTestId('save-status')).toContainText('Started a blank sheet');
    expect(await page.evaluate(() => window.__sheet!.rowCount)).toBe(50);
  });

  test('the e2e and sample modes never touch the saved sheet', async ({ page }) => {
    await page.goto('/demo/?mode=empty');
    await page.waitForFunction(() => window.__grid !== undefined);
    await page.evaluate(() => window.__sheet!.setCellInput(0, 0, 'not saved'));
    await page.waitForTimeout(1000);
    await page.goto('/demo/');
    await page.waitForFunction(() => window.__grid !== undefined);
    expect(await page.evaluate(() => window.__sheet!.model.cellCount)).toBe(0);
  });
});

test.describe('language and theme', () => {
  test('switching to Vietnamese relabels the toolbar and the choice survives a reload', async ({ page }) => {
    await page.goto('/demo/');
    await page.waitForFunction(() => window.__grid !== undefined);
    await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();
    await page.getByLabel('Language').selectOption('vi');
    await expect(page.getByRole('button', { name: 'Hoàn tác' })).toBeVisible();
    await expect(page.getByLabel('Số dòng')).toHaveValue('50');
    await page.reload();
    await page.waitForFunction(() => window.__grid !== undefined);
    await expect(page.getByRole('button', { name: 'Đậm' })).toBeVisible();
  });

  test('the dark theme repaints the canvas', async ({ page }) => {
    await page.goto('/demo/');
    await page.waitForFunction(() => window.__grid !== undefined);
    const background = (): Promise<number[]> =>
      page.evaluate(async () => {
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const g = window.__grid!;
        const canvas = document.querySelector('[data-testid=grid] canvas') as HTMLCanvasElement;
        const dpr = window.devicePixelRatio || 1;
        const vp = g.surface.viewport;
        const x = Math.round((vp.colLeft(3) + 20) * dpr);
        const y = Math.round((vp.rowTop(6) + 8) * dpr);
        return Array.from(canvas.getContext('2d')!.getImageData(x, y, 1, 1).data).slice(0, 3);
      });
    await expect.poll(background).toEqual([255, 255, 255]); // the first paint may still be on its way
    await page.getByLabel('Theme').selectOption('dark');
    await expect.poll(background).toEqual([0x1b, 0x1d, 0x21]);
    await expect(page.getByTestId('toolbar')).toHaveCSS('background-color', 'rgb(35, 38, 43)');
    await page.getByLabel('Theme').selectOption('light');
    await expect.poll(background).toEqual([255, 255, 255]);
  });

  test('"auto" follows the operating system setting', async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: 'dark' });
    const page = await context.newPage();
    await page.goto('/demo/');
    await page.waitForFunction(() => window.__grid !== undefined);
    await expect(page.getByTestId('toolbar')).toHaveCSS('background-color', 'rgb(35, 38, 43)');
    await context.close();
  });
});
