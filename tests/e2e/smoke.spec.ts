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

  test('typing a date stores a date, and the date format menu restyles it', async ({ page }) => {
    await open(page);
    await page.getByTestId('grid').click({ position: { x: 120, y: 60 } });
    await page.keyboard.type('7/10/2026');
    await page.keyboard.press('Enter');
    const read = (): Promise<{ value: unknown; text: string }> =>
      page.evaluate(() => {
        const s = (window as unknown as { __handle: Handle }).__handle.sheet;
        return { value: s.getCellByView(1, 0).value, text: s.getDisplayText(1, 0) };
      });
    expect(await read()).toEqual({ value: 46302, text: '07/10/2026' });
    await page.evaluate(() => (window as unknown as { __handle: Handle }).__handle.sheet.selection.selectCell(1, 0));
    await page.getByRole('button', { name: 'More formats' }).click();
    await page.getByRole('menuitemradio', { name: /7 Oct 2026/ }).click();
    expect(await read()).toEqual({ value: 46302, text: '7 Oct 2026' });
  });

  test('data validation: the dialog sets a list, bad input is rejected, the dropdown picks a value', async ({ page }) => {
    await open(page);
    const cell = (): Promise<unknown> => page.evaluate(() => (window as unknown as { __handle: Handle }).__handle.sheet.getCellByView(0, 0).value);
    await page.evaluate(() => (window as unknown as { __handle: Handle }).__handle.sheet.selection.selectCell(0, 0));
    await page.getByRole('button', { name: 'Data validation' }).click();
    const dialog = page.getByTestId('validation-dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Items', { exact: true }).fill('Open, Done');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();

    // Typing something that is not on the list is refused with a message; the cell stays empty.
    await page.getByTestId('grid').click({ position: { x: 80, y: 30 } });
    await page.keyboard.type('Nope');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('status').filter({ hasText: 'not allowed' })).toBeVisible();
    expect(await cell()).toBeNull();

    // Alt+Down opens the list; Enter picks the first entry.
    await page.evaluate(() => (window as unknown as { __handle: Handle }).__handle.sheet.selection.selectCell(0, 0));
    await page.getByTestId('grid').click({ position: { x: 80, y: 30 } });
    await page.keyboard.press('Alt+ArrowDown');
    const menu = page.getByTestId('list-menu');
    await expect(menu).toBeVisible();
    await menu.getByRole('menuitemradio', { name: 'Done' }).click();
    expect(await cell()).toBe('Done');
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

test.describe('robustness', () => {
  type Handle = import('../../src/index').SheetGridHandle;
  type W = { __handle?: Handle; __handles?: Array<Handle | null>; __mount: () => void; __unmount: () => void; __leaks: () => Record<string, number> };

  test('mounting and unmounting repeatedly leaves no listeners, observers or timers behind', async ({ page }) => {
    // Counts what outlives a grid: listeners on window/document, ResizeObservers, intervals. Element listeners go away
    // with their element, so they are not counted.
    await page.addInitScript(() => {
      const open: Record<string, number> = {};
      const bump = (key: string, by: number): void => {
        open[key] = (open[key] ?? 0) + by;
      };
      const name = (t: unknown): string | null => (t === window ? 'window' : t === document ? 'document' : t === document.documentElement ? 'html' : t === document.body ? 'body' : null);
      const add = EventTarget.prototype.addEventListener;
      const remove = EventTarget.prototype.removeEventListener;
      const key = (t: unknown, type: string, o: unknown): string | null => {
        const n = name(t);
        const capture = typeof o === 'boolean' ? o : typeof o === 'object' && o !== null && (o as { capture?: boolean }).capture === true;
        return n === null ? null : `${n}:${type}:${capture}`;
      };
      const seen = new WeakMap<object, Set<string>>();
      EventTarget.prototype.addEventListener = function (type: string, listener: unknown, options?: unknown) {
        const k = key(this, type, options);
        if (k !== null && typeof listener === 'function') {
          const set = seen.get(listener as object) ?? new Set<string>();
          if (!set.has(k)) {
            set.add(k);
            seen.set(listener as object, set);
            bump(k, 1);
          }
        }
        return add.call(this, type, listener as EventListener, options as AddEventListenerOptions);
      };
      EventTarget.prototype.removeEventListener = function (type: string, listener: unknown, options?: unknown) {
        const k = key(this, type, options);
        if (k !== null && typeof listener === 'function') {
          const set = seen.get(listener as object);
          if (set?.delete(k) === true) bump(k, -1);
        }
        return remove.call(this, type, listener as EventListener, options as EventListenerOptions);
      };
      const OriginalObserver = window.ResizeObserver;
      window.ResizeObserver = class extends OriginalObserver {
        constructor(callback: ResizeObserverCallback) {
          super(callback);
          bump('resizeObserver', 1);
        }
        override disconnect(): void {
          bump('resizeObserver', -1);
          super.disconnect();
        }
      };
      const setIv = window.setInterval.bind(window);
      const clearIv = window.clearInterval.bind(window);
      const live = new Set<number>();
      window.setInterval = ((fn: TimerHandler, ms?: number, ...args: unknown[]) => {
        const id = setIv(fn, ms, ...args);
        live.add(id);
        return id;
      }) as typeof window.setInterval;
      window.clearInterval = ((id?: number) => {
        if (id !== undefined) live.delete(id);
        clearIv(id);
      }) as typeof window.clearInterval;
      (window as unknown as { __leaks: () => Record<string, number> }).__leaks = () => {
        const out: Record<string, number> = {};
        for (const [k, v] of Object.entries(open)) if (v !== 0) out[k] = v;
        if (live.size > 0) out.intervals = live.size;
        return out;
      };
    });
    await page.goto('/demo/simple.html');
    await page.waitForFunction(() => (window as unknown as W).__handle?.controller != null);
    await page.evaluate(() => (window as unknown as W).__unmount());
    await expect(page.getByTestId('grid')).toHaveCount(0);
    // React attaches its own (permanent) listeners to document.body the first time a portal is used, and Playwright
    // adds some too; those appear once. A leak is anything that keeps growing, so the baseline is taken after one
    // complete use-and-unmount cycle.
    let baseline: Record<string, number> = {};

    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => (window as unknown as W).__mount());
      await page.waitForFunction(() => (window as unknown as W).__handle?.controller != null);
      // Use it: select, drag a selection past the edge (auto-scroll timer), open a menu, arm the painter, edit.
      const a = await page.evaluate(() => {
        const g = (window as unknown as W).__handle!.controller!;
        const r = g.surface.host.getBoundingClientRect();
        return { x: r.left + 80, y: r.top + 50, w: r.width, h: r.height };
      });
      await page.mouse.click(a.x, a.y);
      await page.keyboard.type('x');
      await page.keyboard.press('Enter');
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      await page.mouse.move(a.x + 100, a.y + a.h, { steps: 3 }); // past the bottom edge: the auto-scroll timer starts
      await page.waitForTimeout(80);
      await page.mouse.up();
      await page.getByRole('button', { name: 'Insert', exact: true }).click(); // a menu is open
      await page.getByRole('button', { name: 'Paint format' }).click(); // closes it and arms the painter
      if (i === 4) {
        // The worst case: unmounted in the middle of a drag.
        await page.mouse.move(a.x, a.y);
        await page.mouse.down();
        await page.mouse.move(a.x + 100, a.y + a.h, { steps: 3 });
        await page.waitForTimeout(80);
      }
      await page.evaluate(() => (window as unknown as W).__unmount());
      await expect(page.getByTestId('grid')).toHaveCount(0);
      // Still holding the button after an unmount mid-drag: nothing may be left waiting for the release (the
      // release itself would let a leaked handler clean up after itself and hide the leak).
      if (i === 4) expect(await page.evaluate(() => (window as unknown as W).__leaks())).toEqual(baseline);
      await page.mouse.up();
      if (i === 0) baseline = await page.evaluate(() => (window as unknown as W).__leaks());
    }
    expect(await page.evaluate(() => (window as unknown as W).__leaks())).toEqual(baseline);
  });

  test('two grids on one page keep separate data, selection and editing', async ({ page }) => {
    await page.goto('/demo/simple.html?count=2');
    await page.waitForFunction(() => (window as unknown as W).__handles?.filter((h) => h?.controller != null).length === 2);
    const first = page.getByTestId('sheet-0').getByTestId('grid');
    const second = page.getByTestId('sheet-1').getByTestId('grid');
    await first.click({ position: { x: 120, y: 60 } });
    await page.keyboard.type('one');
    await page.keyboard.press('Enter');
    await second.click({ position: { x: 120, y: 60 } });
    await page.keyboard.type('two');
    await page.keyboard.press('Enter');
    const values = await page.evaluate(() => {
      const [a, b] = (window as unknown as W).__handles as Handle[];
      return {
        a: a!.sheet.getCellByView(1, 0).value,
        b: b!.sheet.getCellByView(1, 0).value,
        aSelection: [a!.sheet.selection.activeRow, a!.sheet.selection.activeCol],
        bSelection: [b!.sheet.selection.activeRow, b!.sheet.selection.activeCol],
        aCells: a!.sheet.model.cellCount,
        bCells: b!.sheet.model.cellCount,
      };
    });
    expect(values).toEqual({ a: 'one', b: 'two', aSelection: [2, 0], bSelection: [2, 0], aCells: 1, bCells: 1 });
    expect(await page.getByTestId('toolbar').count()).toBe(2);
  });

  test('React StrictMode (double mount) leaves a working grid', async ({ page }) => {
    await page.goto('/demo/simple.html');
    await page.waitForFunction(() => (window as unknown as W).__handle?.controller != null);
    // Remount quickly and use the grid: it must not be half torn down.
    await page.evaluate(() => {
      const w = window as unknown as W;
      w.__unmount();
      w.__mount();
    });
    await page.waitForFunction(() => (window as unknown as W).__handle?.controller != null);
    await page.getByTestId('grid').click({ position: { x: 120, y: 60 } });
    await page.keyboard.type('ok');
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => (window as unknown as W).__handle!.sheet.getCellByView(1, 0).value)).toBe('ok');
  });
});

test.describe('failures stay contained', () => {
  type Handle = import('../../src/index').SheetGridHandle;
  type W = { __handle?: Handle; __crash?: boolean; __errors?: string[] };

  test('a render error shows a fallback with Try again, reports it, and the page survives', async ({ page }) => {
    await page.goto('/demo/simple.html');
    await page.waitForFunction(() => (window as unknown as W).__handle?.controller != null);
    await page.evaluate(() => {
      (window as unknown as W).__crash = true;
      const sheet = (window as unknown as W).__handle!.sheet;
      sheet.selection.selectCell(0, 0);
      sheet.formatSelection({ color: '#ff0000' }); // makes the toolbar render the "reset color" string, which now throws
    });
    await expect(page.getByRole('alert')).toContainText('Something went wrong');
    expect(await page.evaluate(() => (window as unknown as W).__errors)).toContain('boom');
    await page.evaluate(() => {
      (window as unknown as W).__crash = false;
    });
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByTestId('toolbar')).toBeVisible();
    await expect(page.getByTestId('grid')).toBeVisible();
  });

  test('an oversized paste is refused and the toolbar says so', async ({ page }) => {
    await page.goto('/demo/simple.html');
    await page.waitForFunction(() => (window as unknown as W).__handle?.controller != null);
    await page.evaluate(() => {
      (window as unknown as W).__handle!.sheet.pasteMatrix(3000, 1000, () => ({ value: 1, styleId: 0 }));
    });
    await expect(page.getByRole('status').filter({ hasText: 'Nothing was pasted' })).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as W).__handle!.sheet.model.cellCount)).toBe(0);
  });
});

test.describe('accessibility', () => {
  type Handle = import('../../src/index').SheetGridHandle;
  type W = { __handle?: Handle };
  const ready = async (page: import('@playwright/test').Page, query = ''): Promise<void> => {
    await page.goto(`/demo/simple.html${query}`);
    await page.waitForFunction(() => (window as unknown as W).__handle?.controller != null);
  };
  const announced = (page: import('@playwright/test').Page) => page.getByTestId('grid-announcer');

  test('the grid is an application region with a name, a description and a hint', async ({ page }) => {
    await ready(page);
    const grid = page.getByTestId('grid');
    await expect(grid).toHaveAttribute('role', 'application');
    await expect(grid).toHaveAttribute('aria-roledescription', 'spreadsheet');
    await expect(grid).toHaveAttribute('aria-label', 'Spreadsheet');
    const hintId = await grid.getAttribute('aria-describedby');
    await expect(page.locator(`[id="${hintId}"]`)).toContainText('arrow keys');
    // Pixels are hidden from assistive technology and the scroller is not a tab stop.
    await expect(grid.locator('canvas')).toHaveAttribute('aria-hidden', 'true');
    const tabStops = await grid.evaluate((el) => Array.from(el.querySelectorAll('*')).filter((n) => (n as HTMLElement).tabIndex >= 0).map((n) => n.tagName));
    expect(tabStops).toEqual(['TEXTAREA']);
  });

  test('moving the selection announces the cell, its value and ranges, once things settle', async ({ page }) => {
    await ready(page);
    await page.evaluate(() => {
      const h = (window as unknown as W).__handle!;
      h.sheet.setCellInput(0, 0, 'Total');
      h.sheet.setCellInput(1, 0, '=1+2');
    });
    await page.getByTestId('grid').click({ position: { x: 80, y: 34 } }); // A1
    await expect(announced(page)).toHaveText('A1, Total');
    await page.keyboard.press('ArrowDown');
    await expect(announced(page)).toHaveText('A2, 3, formula');
    await page.keyboard.press('ArrowRight');
    await expect(announced(page)).toHaveText('B2, empty');
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('Shift+ArrowRight');
    await expect(announced(page)).toHaveText(/^Selected B2 to C3, 4 cells\. Active cell B2, empty$/);
    await expect(announced(page)).toHaveAttribute('aria-live', 'polite');
  });

  test('starting an edit is announced, and typing text is not read out cell by cell', async ({ page }) => {
    await ready(page);
    await page.getByTestId('grid').click({ position: { x: 80, y: 34 } });
    await page.keyboard.press('F2');
    await expect(announced(page)).toHaveText('Editing A1');
    await page.keyboard.type('abc');
    await page.waitForTimeout(150);
    await expect(announced(page)).toHaveText('Editing A1');
    await page.keyboard.press('Enter');
    await expect(announced(page)).toHaveText('A2, empty');
  });

  test('Ctrl+Alt+Shift+Down leaves the grid for the next control, and Up for the previous one', async ({ page }) => {
    await ready(page);
    await page.getByTestId('grid').click({ position: { x: 80, y: 34 } });
    const mod = (await page.evaluate(() => /Mac|iPhone|iPad/.test(navigator.platform))) ? 'Meta' : 'Control';
    await page.keyboard.press(`${mod}+Alt+Shift+ArrowDown`);
    // The toolbar, formula bar and status bar come before the grid in the page; "next" after it is the last button.
    await expect(page.locator('#after-grid')).toBeFocused();
    await page.getByTestId('grid').click({ position: { x: 80, y: 34 } });
    await page.keyboard.press(`${mod}+Alt+Shift+ArrowUp`);
    const focused = await page.evaluate(() => document.activeElement?.closest('[data-testid=status-bar], [data-testid=formula-bar], [data-testid=toolbar]') !== null || document.activeElement?.id === 'before-grid');
    expect(focused).toBe(true);
    expect(await page.evaluate(() => document.activeElement === (window as unknown as W).__handle!.controller!.editor.textarea)).toBe(false);
  });

  test('the editor textarea and the announcements follow the UI language', async ({ page }) => {
    await page.goto('/demo/?mode=empty');
    await page.waitForFunction(() => window.__grid !== undefined);
    await page.getByLabel('Language').selectOption('vi');
    await expect(page.getByLabel('Ô soạn thảo')).toBeAttached();
    await expect(page.getByTestId('grid')).toHaveAttribute('aria-label', 'Bảng tính');
    await page.getByTestId('grid').click({ position: { x: 80, y: 34 } });
    await expect(page.getByTestId('grid-announcer')).toHaveText('A1, trống');
  });

  test('toolbar controls are reachable and named: every button has an accessible name and a role', async ({ page }) => {
    await ready(page);
    const unnamed = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-testid=toolbar] button, [data-testid=toolbar] input')).filter((el) => {
        const label = el.getAttribute('aria-label') ?? el.getAttribute('title') ?? el.textContent ?? '';
        return label.trim() === '';
      }).length,
    );
    expect(unnamed).toBe(0);
    await expect(page.getByRole('toolbar')).toBeVisible();
  });
});

test.describe('accessibility: content changes', () => {
  type Handle = import('../../src/index').SheetGridHandle;
  type W = { __handle?: Handle };

  test('a change to the active cell without moving the selection is announced (undo, data arriving)', async ({ page }) => {
    await page.goto('/demo/simple.html');
    await page.waitForFunction(() => (window as unknown as W).__handle?.controller != null);
    const announced = page.getByTestId('grid-announcer');
    await expect(announced).toHaveText('A1, empty');
    await page.evaluate(() => (window as unknown as W).__handle!.sheet.setCellInput(0, 0, 'Loaded'));
    await expect(announced).toHaveText('A1, Loaded');
    await page.evaluate(() => (window as unknown as W).__handle!.sheet.undo());
    await expect(announced).toHaveText('A1, empty');
  });
});
