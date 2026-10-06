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

test.describe('SheetGrid (the host-facing component)', () => {
  type Handle = import('../../src/index').SheetGridHandle;
  type Snapshot = import('../../src/index').SheetSnapshot;
  const open = async (page: import('@playwright/test').Page, query = ''): Promise<void> => {
    await page.goto(`/demo/simple.html${query}`);
    await page.waitForFunction(() => (window as unknown as { __handle?: Handle }).__handle?.controller != null);
  };

  test('renders toolbar, formula bar, grid and status bar and works end to end', async ({ page }) => {
    await open(page);
    await expect(page.getByTestId('toolbar')).toBeVisible();
    await expect(page.getByTestId('formula-bar')).toBeVisible();
    await expect(page.getByTestId('status-bar')).toBeVisible();
    await page.getByTestId('grid').click({ position: { x: 120, y: 60 } });
    await page.keyboard.type('hello');
    await page.keyboard.press('Enter');
    // The click landed on the second row of column A; Enter then moved the selection down.
    const value = await page.evaluate(() => (window as unknown as { __handle: Handle }).__handle.sheet.getCellByView(1, 0).value);
    expect(value).toBe('hello');
  });

  test('onChange is batched, carries a snapshot, ignores selection, and sees freezing', async ({ page }) => {
    await open(page);
    await page.evaluate(() => {
      const h = (window as unknown as { __handle: Handle }).__handle;
      h.sheet.selection.selectCell(3, 3);
      h.sheet.setCellInput(0, 0, '1');
      h.sheet.setCellInput(1, 0, '2');
      h.sheet.setCellInput(2, 0, '=A1+A2');
    });
    await expect.poll(() => page.evaluate(() => (window as unknown as { __changes: unknown[] }).__changes.length)).toBe(1); // three edits, one call
    const snapshot = (await page.evaluate(() => (window as unknown as { __changes: Snapshot[] }).__changes[0])) as Snapshot;
    expect(snapshot.cells.map((c) => c.slice(0, 3))).toEqual([[0, 0, 0], [1, 0, 0], [2, 0, 0]]);
    expect(snapshot.cells[2]?.[4]).toBe('=A1+A2');
    await page.evaluate(() => (window as unknown as { __handle: Handle }).__handle.sheet.selection.selectCell(7, 7));
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => (window as unknown as { __changes: unknown[] }).__changes.length)).toBe(1); // selection is not a change
    await page.evaluate(() => (window as unknown as { __handle: Handle }).__handle.sheet.setFrozen(1, 0));
    await expect.poll(() => page.evaluate(() => (window as unknown as { __changes: unknown[] }).__changes.length)).toBe(2);
  });

  test('defaultValue restores a saved sheet, and a broken one starts blank and reports the error', async ({ page }) => {
    await open(page);
    const saved = await page.evaluate(() => {
      const h = (window as unknown as { __handle: Handle }).__handle;
      h.sheet.setCellInput(0, 0, 'restored');
      return JSON.stringify(h.getSnapshot());
    });
    await open(page, `?value=${encodeURIComponent(saved)}`);
    expect(await page.evaluate(() => (window as unknown as { __handle: Handle }).__handle.sheet.getCellByView(0, 0).value)).toBe('restored');
    await open(page, `?value=${encodeURIComponent('{"version":99}')}`);
    expect(await page.evaluate(() => (window as unknown as { __handle: Handle }).__handle.sheet.model.cellCount)).toBe(0);
    expect(await page.evaluate(() => (window as unknown as { __errors: string[] }).__errors)).toEqual([expect.stringContaining('version')]);
  });

  test('load() replaces the sheet and rejects bad data without touching the current one', async ({ page }) => {
    await open(page);
    const result = await page.evaluate(() => {
      const h = (window as unknown as { __handle: Handle }).__handle;
      h.sheet.setCellInput(0, 0, 'before');
      const snapshot = h.getSnapshot();
      h.sheet.setCellInput(0, 0, 'after');
      let rejected = '';
      try {
        h.load({ nonsense: true });
      } catch (e) {
        rejected = (e as Error).name;
      }
      const stillThere = h.sheet.getCellByView(0, 0).value;
      h.load(snapshot);
      return { rejected, stillThere };
    });
    expect(result).toEqual({ rejected: 'SnapshotError', stillThere: 'after' });
    await expect.poll(() => page.evaluate(() => (window as unknown as { __handle: Handle }).__handle.sheet.getCellByView(0, 0).value)).toBe('before');
  });

  test('readOnly: nothing can be typed, pasted, formatted or filled; viewing controls still work', async ({ page }) => {
    await open(page, '?readonly=1');
    await page.evaluate(() => (window as unknown as { __handle: Handle }).__handle.sheet.model.setCell(0, 0, { value: 3, styleId: 0 }));
    await page.evaluate(() => (window as unknown as { __handle: Handle }).__handle.sheet.model.setCell(1, 0, { value: 1, styleId: 0 }));
    await page.getByTestId('grid').click({ position: { x: 120, y: 60 } });
    await page.keyboard.type('typed');
    await page.keyboard.press('Enter');
    await page.keyboard.press('F2');
    await page.keyboard.press('Delete');
    await page.getByTestId('grid').dblclick({ position: { x: 120, y: 60 } });
    const state = await page.evaluate(() => {
      const h = (window as unknown as { __handle: Handle }).__handle;
      return { editing: h.controller!.editor.editing, a1: h.sheet.getCellByView(0, 0).value, buffer: h.controller!.editor.textarea.value, readOnly: h.sheet.readOnly };
    });
    expect(state).toEqual({ editing: false, a1: 3, buffer: '', readOnly: true });
    await expect(page.getByRole('button', { name: 'Bold' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Format as currency' })).toBeDisabled();
    await expect(page.getByLabel('Row count')).toBeDisabled();
    await expect(page.getByLabel('Formula bar')).toHaveAttribute('readonly', '');
    await expect(page.getByRole('button', { name: 'Sort A to Z' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Copy' })).toBeEnabled();
    await page.getByRole('button', { name: 'Sort A to Z' }).click();
    expect(await page.evaluate(() => (window as unknown as { __handle: Handle }).__handle.sheet.getCellByView(0, 0).value)).toBe(1); // sorting is a view change
    await page.getByTestId('grid').click({ button: 'right', position: { x: 120, y: 60 } });
    await expect(page.getByRole('menuitem', { name: 'Cut' })).toBeDisabled();
    await expect(page.getByRole('menuitem', { name: 'Clear contents' })).toBeDisabled();
    await expect(page.getByRole('menuitem', { name: /Sort sheet by column A, A → Z/ })).toBeEnabled();
    expect(await page.evaluate(() => (window as unknown as { __changes: unknown[] }).__changes.length)).toBe(0);
  });
});
