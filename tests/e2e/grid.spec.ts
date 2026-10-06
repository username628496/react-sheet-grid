import { expect, test } from '@playwright/test';
import { cellCenter, cellValue, clickCell, modKey, openEmptyGrid, selection } from './helpers';

declare global {
  interface Window {
    __grid?: import('../../src/index').GridController;
    __sheet?: import('../../src/index').Spreadsheet;
  }
}

let mod: 'Meta' | 'Control' = 'Control';

test.beforeEach(async ({ page }) => {
  await openEmptyGrid(page);
  mod = await modKey(page);
});

test.describe('selection', () => {
  test('click selects a cell', async ({ page }) => {
    await clickCell(page, 3, 2);
    expect((await selection(page)).active).toEqual([3, 2]);
  });

  test('drag selects a range', async ({ page }) => {
    const a = await cellCenter(page, 1, 1);
    const b = await cellCenter(page, 4, 3);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 5 });
    await page.mouse.up();
    expect((await selection(page)).range).toEqual({ startRow: 1, startCol: 1, endRow: 4, endCol: 3 });
  });

  test('shift+click extends from the active cell', async ({ page }) => {
    await clickCell(page, 2, 2);
    await clickCell(page, 5, 4, { modifiers: ['Shift'] });
    const s = await selection(page);
    expect(s.active).toEqual([2, 2]);
    expect(s.range).toEqual({ startRow: 2, startCol: 2, endRow: 5, endCol: 4 });
  });

  test('header click selects a whole column or row', async ({ page }) => {
    const box = await page.getByTestId('grid').boundingBox();
    const vp = await page.evaluate(() => {
      const v = window.__grid!.surface.viewport;
      return { hw: v.headerWidth, hh: v.headerHeight, c2: v.colLeft(2) + 50, r3: v.rowTop(3) + 10 };
    });
    await page.mouse.click(box!.x + vp.c2, box!.y + vp.hh / 2);
    expect((await selection(page)).range).toMatchObject({ startRow: 0, endRow: 999, startCol: 2, endCol: 2 });
    await page.mouse.click(box!.x + vp.hw / 2, box!.y + vp.r3);
    expect((await selection(page)).range).toMatchObject({ startRow: 3, endRow: 3, startCol: 0, endCol: 25 });
    await page.mouse.click(box!.x + 5, box!.y + 5);
    expect((await selection(page)).range).toMatchObject({ startRow: 0, endRow: 999, startCol: 0, endCol: 25 });
  });
});

test.describe('keyboard navigation', () => {
  test('arrows, Tab and Shift+Tab', async ({ page }) => {
    await clickCell(page, 0, 0);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Tab');
    expect((await selection(page)).active).toEqual([1, 2]);
    await page.keyboard.press('Shift+Tab');
    expect((await selection(page)).active).toEqual([1, 1]);
  });

  test('shift+arrow extends and Ctrl+arrow jumps over data', async ({ page }) => {
    await page.evaluate(() => {
      const s = window.__sheet!;
      for (let r = 2; r <= 4; r++) s.model.setCell(r, 0, { value: r, styleId: 0 });
    });
    await clickCell(page, 2, 0);
    await page.keyboard.press(`${mod}+ArrowDown`);
    expect((await selection(page)).active).toEqual([4, 0]);
    await page.keyboard.press(`${mod}+ArrowDown`);
    expect((await selection(page)).active).toEqual([999, 0]);
    await page.keyboard.press(`${mod}+Home`);
    expect((await selection(page)).active).toEqual([0, 0]);
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('Shift+ArrowRight');
    expect((await selection(page)).range).toEqual({ startRow: 0, startCol: 0, endRow: 1, endCol: 1 });
  });

  test('PageDown scrolls the view and keeps the selection visible', async ({ page }) => {
    await clickCell(page, 0, 0);
    await page.keyboard.press('PageDown');
    await page.keyboard.press('PageDown');
    const info = await page.evaluate(() => ({ row: window.__sheet!.selection.activeRow, scroll: window.__grid!.surface.viewport.scrollY }));
    expect(info.row).toBeGreaterThan(20);
    expect(info.scroll).toBeGreaterThan(0);
  });
});

test.describe('editing', () => {
  test('typing replaces the content and does not lose the first character', async ({ page }) => {
    await clickCell(page, 0, 0);
    await page.keyboard.type('Hello');
    await page.keyboard.press('Enter');
    expect(await cellValue(page, 0, 0)).toBe('Hello');
    expect((await selection(page)).active).toEqual([1, 0]);
  });

  test('numbers are parsed and Tab commits to the right', async ({ page }) => {
    await clickCell(page, 0, 0);
    await page.keyboard.type('12.5');
    await page.keyboard.press('Tab');
    expect(await cellValue(page, 0, 0)).toBe(12.5);
    expect((await selection(page)).active).toEqual([0, 1]);
  });

  test('F2 edits existing text with the caret at the end; Escape cancels', async ({ page }) => {
    await page.evaluate(() => window.__sheet!.setCellInput(0, 0, 'abc'));
    await clickCell(page, 0, 0);
    await page.keyboard.press('F2');
    await page.keyboard.type('XY');
    await page.keyboard.press('Enter');
    expect(await cellValue(page, 0, 0)).toBe('abcXY');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('F2');
    await page.keyboard.type('zzz');
    await page.keyboard.press('Escape');
    expect(await cellValue(page, 0, 0)).toBe('abcXY');
  });

  test('double click starts editing', async ({ page }) => {
    await page.evaluate(() => window.__sheet!.setCellInput(2, 2, 'dbl'));
    const { x, y } = await cellCenter(page, 2, 2);
    await page.mouse.dblclick(x, y);
    expect(await page.evaluate(() => window.__grid!.editor.editing)).toBe(true);
    await page.keyboard.type('!');
    await page.keyboard.press('Enter');
    expect(await cellValue(page, 2, 2)).toBe('dbl!');
  });

  test('typing mode: arrow commits and moves; edit mode: arrow moves the caret', async ({ page }) => {
    await clickCell(page, 0, 0);
    await page.keyboard.type('a');
    await page.keyboard.press('ArrowDown');
    expect(await cellValue(page, 0, 0)).toBe('a');
    expect((await selection(page)).active).toEqual([1, 0]);
    await page.keyboard.press('F2');
    await page.keyboard.type('bc');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.type('X');
    await page.keyboard.press('Enter');
    expect(await cellValue(page, 1, 0)).toBe('bXc');
  });

  test('Delete clears the selection, undo and redo restore it', async ({ page }) => {
    await page.evaluate(() => {
      window.__sheet!.setCellInput(0, 0, 'a');
      window.__sheet!.setCellInput(0, 1, 'b');
    });
    await clickCell(page, 0, 0);
    await clickCell(page, 0, 1, { modifiers: ['Shift'] });
    await page.keyboard.press('Delete');
    expect(await cellValue(page, 0, 0)).toBeNull();
    expect(await cellValue(page, 0, 1)).toBeNull();
    await page.keyboard.press(`${mod}+z`);
    expect(await cellValue(page, 0, 0)).toBe('a');
    expect(await cellValue(page, 0, 1)).toBe('b');
    await page.keyboard.press(`${mod}+Shift+z`);
    expect(await cellValue(page, 0, 0)).toBeNull();
  });

  test('clicking another cell commits the edit', async ({ page }) => {
    await clickCell(page, 0, 0);
    await page.keyboard.type('keep');
    await clickCell(page, 3, 3);
    expect(await cellValue(page, 0, 0)).toBe('keep');
  });

  test('Alt+Enter inserts a newline', async ({ page }) => {
    await clickCell(page, 0, 0);
    await page.keyboard.type('a');
    await page.keyboard.press('Alt+Enter');
    await page.keyboard.type('b');
    await page.keyboard.press('Enter');
    expect(await cellValue(page, 0, 0)).toBe('a\nb');
  });
});

test.describe('IME (Vietnamese)', () => {
  test('composition from navigating mode keeps the first character and does not trigger shortcuts', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'CDP IME simulation is Chromium only');
    await clickCell(page, 0, 0);
    const cdp = await page.context().newCDPSession(page);
    // Telex: "viet" is shown underlined while composing, then becomes "việt".
    await cdp.send('Input.imeSetComposition', { text: 'v', selectionStart: 1, selectionEnd: 1 });
    expect(await page.evaluate(() => window.__grid!.editor.editing)).toBe(true);
    await cdp.send('Input.imeSetComposition', { text: 'việt', selectionStart: 4, selectionEnd: 4 });
    await cdp.send('Input.insertText', { text: 'việt' });
    await page.keyboard.press('Enter');
    expect(await cellValue(page, 0, 0)).toBe('việt');
  });

  test('Enter pressed while composing is not treated as commit', async ({ page }) => {
    await page.evaluate(() => {
      const t = window.__grid!.editor.textarea;
      t.focus();
      t.dispatchEvent(new CompositionEvent('compositionstart'));
      t.value = 'x';
      t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true }));
    });
    expect(await page.evaluate(() => window.__grid!.editor.editing)).toBe(true);
    expect(await cellValue(page, 0, 0)).toBeNull();
  });
});

test.describe('resize', () => {
  test('dragging a column border resizes it and undo restores it', async ({ page }) => {
    const box = await page.getByTestId('grid').boundingBox();
    const edge = await page.evaluate(() => {
      const v = window.__grid!.surface.viewport;
      return { x: v.colLeft(1) + window.__sheet!.cols.getSize(1), y: v.headerHeight / 2 };
    });
    await page.mouse.move(box!.x + edge.x, box!.y + edge.y);
    await page.mouse.down();
    await page.mouse.move(box!.x + edge.x + 60, box!.y + edge.y, { steps: 4 });
    await page.mouse.up();
    expect(await page.evaluate(() => window.__sheet!.cols.getSize(1))).toBe(160);
    await clickCell(page, 0, 0);
    await page.keyboard.press(`${mod}+z`);
    expect(await page.evaluate(() => window.__sheet!.cols.getSize(1))).toBe(100);
  });

  test('dragging a row border resizes it', async ({ page }) => {
    const box = await page.getByTestId('grid').boundingBox();
    const edge = await page.evaluate(() => {
      const v = window.__grid!.surface.viewport;
      return { x: v.headerWidth / 2, y: v.rowTop(2) + window.__sheet!.rows.getSize(2) };
    });
    await page.mouse.move(box!.x + edge.x, box!.y + edge.y);
    await page.mouse.down();
    await page.mouse.move(box!.x + edge.x, box!.y + edge.y + 19, { steps: 4 });
    await page.mouse.up();
    expect(await page.evaluate(() => window.__sheet!.rows.getSize(2))).toBe(40);
  });
});

test.describe('clipboard', () => {
  // These call the controller's copyTo/pasteFrom with a plain object: Firefox ignores clipboardData on
  // synthetic ClipboardEvents, so dispatching events would test the browser instead of our code.
  // The real event wiring is covered by the keyboard-shortcut test below.
  async function copyEvent(page: import('@playwright/test').Page): Promise<{ text: string; html: string }> {
    return page.evaluate(() => {
      const store: Record<string, string> = {};
      window.__grid!.clipboard.copyTo({ setData: (type, value) => void (store[type] = value) });
      return { text: store['text/plain'] ?? '', html: store['text/html'] ?? '' };
    });
  }

  async function pasteEvent(page: import('@playwright/test').Page, data: { text?: string; html?: string }): Promise<void> {
    await page.evaluate((d) => {
      window.__grid!.clipboard.pasteFrom({ getData: (type) => (type === 'text/html' ? d.html : d.text) ?? '' });
    }, data);
  }

  test('copy writes TSV and an HTML table', async ({ page }) => {
    await page.evaluate(() => {
      const s = window.__sheet!;
      s.setCellInput(0, 0, 'a');
      s.setCellInput(0, 1, '1.5');
      s.setCellInput(1, 0, 'x"y');
    });
    await clickCell(page, 0, 0);
    await clickCell(page, 1, 1, { modifiers: ['Shift'] });
    const data = await copyEvent(page);
    expect(data.text).toBe('a\t1.5\n"x""y"\t');
    expect(data.html).toContain('<table>');
    expect(data.html).toContain('<td>1.5</td>');
  });

  test('paste prefers HTML over plain text', async ({ page }) => {
    await clickCell(page, 1, 1);
    await pasteEvent(page, { html: '<table><tr><td>H1</td><td>7</td></tr></table>', text: 'ignored' });
    expect(await cellValue(page, 1, 1)).toBe('H1');
    expect(await cellValue(page, 1, 2)).toBe(7);
  });

  test('paste falls back to TSV text and undo reverts the whole paste', async ({ page }) => {
    await clickCell(page, 0, 0);
    await pasteEvent(page, { text: 'a\tb\nc\td\n' });
    expect(await cellValue(page, 1, 1)).toBe('d');
    await page.keyboard.press(`${mod}+z`);
    expect(await cellValue(page, 0, 0)).toBeNull();
    expect(await cellValue(page, 1, 1)).toBeNull();
  });

  test('cut then paste moves the cells', async ({ page }) => {
    await page.evaluate(() => window.__sheet!.setCellInput(0, 0, 'moveme'));
    await clickCell(page, 0, 0);
    const data = await page.evaluate(() => {
      const store: Record<string, string> = {};
      window.__grid!.clipboard.cutTo({ setData: (type, value) => void (store[type] = value) });
      return store['text/plain'] ?? '';
    });
    expect(await cellValue(page, 0, 0)).toBe('moveme'); // cleared only when pasted, like Sheets
    await clickCell(page, 4, 4);
    await pasteEvent(page, { text: data });
    expect(await cellValue(page, 0, 0)).toBeNull();
    expect(await cellValue(page, 4, 4)).toBe('moveme');
  });

  test('real keyboard shortcuts copy and paste within the grid', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'headless clipboard permissions differ between engines');
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.evaluate(() => window.__sheet!.setCellInput(0, 0, 'shortcut'));
    await clickCell(page, 0, 0);
    await page.keyboard.press(`${mod}+c`);
    await clickCell(page, 3, 3);
    await page.keyboard.press(`${mod}+v`);
    expect(await cellValue(page, 3, 3)).toBe('shortcut');
  });

  test('typing in the editor is not intercepted by paste handling', async ({ page }) => {
    await clickCell(page, 0, 0);
    await page.keyboard.type('abc');
    // While editing, the real paste event is left to the browser's own textarea handling.
    await page.evaluate(() => {
      const dt = new DataTransfer();
      dt.setData('text/plain', 'zzz');
      window.__grid!.editor.textarea.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    });
    await page.keyboard.press('Escape');
    expect(await cellValue(page, 0, 0)).toBeNull();
    expect(await cellValue(page, 1, 0)).toBeNull();
  });
});

test.describe('formulas', () => {
  test('typing a formula computes it, shows the formula when editing and updates dependents', async ({ page }) => {
    await clickCell(page, 0, 0);
    await page.keyboard.type('2');
    await page.keyboard.press('Enter');
    await page.keyboard.type('3');
    await page.keyboard.press('Enter');
    await page.keyboard.type('=SUM(A1:A2)*2');
    await page.keyboard.press('Enter');
    expect(await cellValue(page, 2, 0)).toBe(10);
    await clickCell(page, 0, 0);
    await page.keyboard.type('10');
    await page.keyboard.press('Enter');
    expect(await cellValue(page, 2, 0)).toBe(26);
    await clickCell(page, 2, 0);
    await page.keyboard.press('F2');
    expect(await page.evaluate(() => window.__grid!.editor.text)).toBe('=SUM(A1:A2)*2');
    await page.keyboard.press('Escape');
    await page.keyboard.press(`${mod}+z`); // undoes A1 = 10, so the formula goes back to 10
    expect(await cellValue(page, 2, 0)).toBe(10);
    await page.keyboard.press(`${mod}+z`); // undoes entering the formula itself
    expect(await cellValue(page, 2, 0)).toBeNull();
  });

  test('a formula typed with the Vietnamese ; separator works', async ({ page }) => {
    await clickCell(page, 0, 0);
    await page.keyboard.type('=IF(1>0;"có";"không")');
    await page.keyboard.press('Enter');
    expect(await cellValue(page, 0, 0)).toBe('có');
  });
});

test.describe('fill handle', () => {
  async function handlePos(page: import('@playwright/test').Page): Promise<{ x: number; y: number }> {
    return page.evaluate(() => {
      const g = window.__grid!;
      const vp = g.surface.viewport;
      const p = g.sheet.selection.primary;
      const rect = g.surface.host.getBoundingClientRect();
      return {
        x: rect.left + vp.colLeft(p.endCol) + g.sheet.cols.getSize(p.endCol),
        y: rect.top + vp.rowTop(p.endRow) + g.sheet.rows.getSize(p.endRow),
      };
    });
  }

  test('dragging the handle down continues a number series in one undo step', async ({ page }) => {
    await page.evaluate(() => {
      window.__sheet!.setCellInput(0, 0, '1');
      window.__sheet!.setCellInput(1, 0, '2');
    });
    await clickCell(page, 0, 0);
    await clickCell(page, 1, 0, { modifiers: ['Shift'] });
    const h = await handlePos(page);
    const target = await cellCenter(page, 5, 0);
    await page.mouse.move(h.x, h.y);
    await page.mouse.down();
    await page.mouse.move(target.x, target.y, { steps: 6 });
    expect(await page.evaluate(() => window.__grid!.mouse.fillPreview)).toMatchObject({ startRow: 0, endRow: 5 });
    await page.mouse.up();
    expect([2, 3, 4, 5].map((r) => r)).toEqual([2, 3, 4, 5]);
    expect(await cellValue(page, 2, 0)).toBe(3);
    expect(await cellValue(page, 5, 0)).toBe(6);
    expect((await selection(page)).range).toMatchObject({ startRow: 0, endRow: 5 });
    await page.keyboard.press(`${mod}+z`);
    expect(await cellValue(page, 2, 0)).toBeNull();
    expect(await cellValue(page, 1, 0)).toBe(2);
  });

  test('dragging sideways copies text', async ({ page }) => {
    await page.evaluate(() => window.__sheet!.setCellInput(0, 0, 'abc'));
    await clickCell(page, 0, 0);
    const h = await handlePos(page);
    const target = await cellCenter(page, 0, 3);
    await page.mouse.move(h.x, h.y);
    await page.mouse.down();
    await page.mouse.move(target.x, target.y, { steps: 5 });
    await page.mouse.up();
    expect(await cellValue(page, 0, 3)).toBe('abc');
    expect(await cellValue(page, 1, 0)).toBeNull();
  });

  test('the cursor changes over the handle', async ({ page }) => {
    await clickCell(page, 0, 0);
    const h = await handlePos(page);
    await page.mouse.move(h.x, h.y);
    expect(await page.evaluate(() => window.__grid!.surface.host.style.cursor)).toBe('crosshair');
  });
});

test.describe('formatting', () => {
  test('Ctrl+B toggles bold on the selection and undo reverts it', async ({ page }) => {
    await page.evaluate(() => window.__sheet!.setCellInput(0, 0, 'x'));
    await clickCell(page, 0, 0);
    await page.keyboard.press(`${mod}+b`);
    const bold = (): Promise<boolean | undefined> =>
      page.evaluate(() => {
        const s = window.__sheet!;
        return s.styles.get(s.getCellByView(0, 0).styleId).bold;
      });
    expect(await bold()).toBe(true);
    await page.keyboard.press(`${mod}+b`);
    expect(await bold()).toBeUndefined();
    await page.keyboard.press(`${mod}+z`);
    expect(await bold()).toBe(true);
  });

  test('toolbar buttons format the selection and reflect the active cell', async ({ page }) => {
    await clickCell(page, 1, 1);
    await page.getByRole('button', { name: 'Bold' }).click();
    await page.getByRole('button', { name: 'Align right' }).click();
    const style = await page.evaluate(() => {
      const s = window.__sheet!;
      return s.styles.get(s.getCellByView(1, 1).styleId);
    });
    expect(style).toEqual({ bold: true, align: 'right' });
    await expect(page.getByRole('button', { name: 'Bold' })).toHaveAttribute('aria-pressed', 'true');
    await clickCell(page, 3, 3);
    await expect(page.getByRole('button', { name: 'Bold' })).toHaveAttribute('aria-pressed', 'false');
  });

  test('the number format select changes how numbers display', async ({ page }) => {
    await page.evaluate(() => window.__sheet!.setCellInput(0, 0, '1234.5'));
    await clickCell(page, 0, 0);
    await page.getByLabel('Number format').selectOption('#,##0.00');
    expect(await page.evaluate(() => window.__sheet!.getDisplayText(0, 0))).toBe('1,234.50');
  });

  test('toolbar undo/redo buttons work and are disabled when there is nothing to do', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
    await clickCell(page, 0, 0);
    await page.keyboard.type('a');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled();
    await page.getByRole('button', { name: 'Undo' }).click();
    expect(await cellValue(page, 0, 0)).toBeNull();
    await page.getByRole('button', { name: 'Redo' }).click();
    expect(await cellValue(page, 0, 0)).toBe('a');
  });

  test('clicking a toolbar button while editing keeps the edit going', async ({ page }) => {
    await clickCell(page, 0, 0);
    await page.keyboard.type('abc');
    await page.getByRole('button', { name: 'Bold' }).click();
    expect(await page.evaluate(() => window.__grid!.editor.editing)).toBe(true);
    await page.keyboard.type('d');
    await page.keyboard.press('Enter');
    expect(await cellValue(page, 0, 0)).toBe('abcd');
  });
});

test.describe('context menu', () => {
  async function rightClick(page: import('@playwright/test').Page, row: number, col: number): Promise<void> {
    const { x, y } = await cellCenter(page, row, col);
    await page.mouse.click(x, y, { button: 'right' });
  }

  test('right click selects the cell and opens the menu; Escape closes it', async ({ page }) => {
    await rightClick(page, 2, 1);
    expect((await selection(page)).active).toEqual([2, 1]);
    await expect(page.getByRole('menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toBeHidden();
  });

  test('right click inside the selection keeps it', async ({ page }) => {
    await clickCell(page, 1, 1);
    await clickCell(page, 3, 3, { modifiers: ['Shift'] });
    await rightClick(page, 2, 2);
    expect((await selection(page)).range).toEqual({ startRow: 1, startCol: 1, endRow: 3, endCol: 3 });
  });

  test('clicking outside closes the menu', async ({ page }) => {
    await rightClick(page, 0, 0);
    await expect(page.getByRole('menu')).toBeVisible();
    await clickCell(page, 5, 5);
    await expect(page.getByRole('menu')).toBeHidden();
  });

  test('insert rows above/below and delete rows, with the count following the selection', async ({ page }) => {
    await page.evaluate(() => {
      window.__sheet!.setCellInput(1, 0, 'a');
      window.__sheet!.setCellInput(2, 0, 'b');
    });
    await clickCell(page, 1, 0);
    await clickCell(page, 2, 0, { modifiers: ['Shift'] });
    await rightClick(page, 1, 0);
    await page.getByRole('menuitem', { name: /Insert 2 rows above/ }).click();
    expect(await page.evaluate(() => window.__sheet!.rowCount)).toBe(1002);
    expect(await cellValue(page, 3, 0)).toBe('a');
    // The two new rows are selected; right-clicking inside that selection deletes exactly them.
    await rightClick(page, 1, 0);
    await page.getByRole('menuitem', { name: /Delete rows 2–3/ }).click();
    expect(await page.evaluate(() => window.__sheet!.rowCount)).toBe(1000);
    expect(await cellValue(page, 1, 0)).toBe('a');
    await page.keyboard.press(`${mod}+z`);
    expect(await page.evaluate(() => window.__sheet!.rowCount)).toBe(1002);
  });

  test('insert column right', async ({ page }) => {
    await page.evaluate(() => window.__sheet!.setCellInput(0, 1, 'x'));
    await rightClick(page, 0, 0);
    await page.getByRole('menuitem', { name: /Insert 1 column right/ }).click();
    expect(await page.evaluate(() => window.__sheet!.colCount)).toBe(27);
    expect(await cellValue(page, 0, 2)).toBe('x');
  });

  test('clear contents', async ({ page }) => {
    await page.evaluate(() => window.__sheet!.setCellInput(0, 0, 'x'));
    await rightClick(page, 0, 0);
    await page.getByRole('menuitem', { name: /Clear contents/ }).click();
    expect(await cellValue(page, 0, 0)).toBeNull();
  });

  test('keyboard: arrows move through items and Enter runs one', async ({ page }) => {
    await page.evaluate(() => window.__sheet!.setCellInput(0, 0, 'gone'));
    await rightClick(page, 0, 0);
    const items = await page.getByRole('menuitem').allTextContents();
    const target = items.findIndex((t) => t.startsWith('Clear contents'));
    for (let i = 0; i <= target; i++) await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    expect(await cellValue(page, 0, 0)).toBeNull();
  });

  test('sort from the menu; inserting rows still works while sorted', async ({ page }) => {
    await page.evaluate(() => {
      for (const [r, v] of [[0, 3], [1, 1], [2, 2]] as const) window.__sheet!.setCellInput(r, 0, String(v));
    });
    await rightClick(page, 0, 0);
    await page.getByRole('menuitem', { name: /Sort sheet by column A, A → Z/ }).click();
    expect(await page.evaluate(() => [0, 1, 2].map((r) => window.__sheet!.getCellByView(r, 0).value))).toEqual([1, 2, 3]);
    await rightClick(page, 1, 0);
    await page.getByRole('menuitem', { name: /Insert 1 row above/ }).click();
    expect(await page.evaluate(() => window.__sheet!.rowCount)).toBe(1001);
    expect(await page.evaluate(() => [0, 1, 2, 3].map((r) => window.__sheet!.getCellByView(r, 0).value))).toEqual([1, null, 2, 3]);
    await rightClick(page, 0, 0);
    await page.getByRole('menuitem', { name: /Remove sort/ }).click();
    expect(await cellValue(page, 0, 0)).toBe(3);
  });

  test('filter by values through the dialog', async ({ page }) => {
    await page.evaluate(() => {
      ['apple', 'pear', 'apple', 'fig'].forEach((v, r) => window.__sheet!.setCellInput(r, 0, v));
    });
    await rightClick(page, 0, 0);
    await page.getByRole('menuitem', { name: /Filter column A by values/ }).click();
    const dialog = page.getByTestId('filter-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('apple')).toBeVisible();
    await dialog.getByRole('button', { name: 'Clear' }).click();
    await dialog.getByLabel('apple').check();
    await dialog.getByRole('button', { name: 'OK' }).click();
    await expect(dialog).toBeHidden();
    expect(await page.evaluate(() => window.__sheet!.rowCount)).toBe(998);
    expect(await cellValue(page, 0, 0)).toBe('apple');
    expect(await cellValue(page, 1, 0)).toBe('apple');
    expect(await page.evaluate(() => window.__sheet!.isColumnFiltered(0))).toBe(true);
    await page.keyboard.press(`${mod}+z`);
    expect(await page.evaluate(() => window.__sheet!.rowCount)).toBe(1000);
  });

  test('the filter dialog search narrows the list and Cancel changes nothing', async ({ page }) => {
    await page.evaluate(() => {
      ['apple', 'pear', 'fig'].forEach((v, r) => window.__sheet!.setCellInput(r, 0, v));
    });
    await rightClick(page, 0, 0);
    await page.getByRole('menuitem', { name: /Filter column A by values/ }).click();
    const dialog = page.getByTestId('filter-dialog');
    await dialog.getByLabel('Search values').fill('pe');
    await expect(dialog.getByText('apple')).toBeHidden();
    await expect(dialog.getByText('pear')).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    expect(await page.evaluate(() => window.__sheet!.rowCount)).toBe(1000);
  });
});

test.describe('status bar', () => {
  test('shows sum, average and count for a numeric selection and hides for one cell', async ({ page }) => {
    await page.evaluate(() => {
      [2, 4, 6].forEach((v, r) => window.__sheet!.setCellInput(r, 0, String(v)));
      window.__sheet!.setCellInput(3, 0, 'text');
    });
    await clickCell(page, 0, 0);
    await expect(page.getByTestId('stat-sum')).toBeHidden();
    await clickCell(page, 3, 0, { modifiers: ['Shift'] });
    await expect(page.getByTestId('stat-sum')).toHaveText('12');
    await expect(page.getByTestId('stat-average')).toHaveText('4');
    await expect(page.getByTestId('stat-count')).toHaveText('3');
    await clickCell(page, 5, 5);
    await expect(page.getByTestId('stat-sum')).toBeHidden();
  });

  test('updates when a value changes', async ({ page }) => {
    await page.evaluate(() => {
      window.__sheet!.setCellInput(0, 0, '1');
      window.__sheet!.setCellInput(1, 0, '2');
    });
    await clickCell(page, 0, 0);
    await clickCell(page, 1, 0, { modifiers: ['Shift'] });
    await expect(page.getByTestId('stat-sum')).toHaveText('3');
    await page.evaluate(() => window.__sheet!.setCellInput(1, 0, '10'));
    await expect(page.getByTestId('stat-sum')).toHaveText('11');
  });
});

test.describe('Google Sheets shortcuts', () => {
  const styleOf = (page: import('@playwright/test').Page, r: number, c: number): Promise<Record<string, unknown>> =>
    page.evaluate(([row, col]) => {
      const s = window.__sheet!;
      return { ...s.styles.get(s.getCellByView(row as number, col as number).styleId) };
    }, [r, c]);

  test('Mod+D fills the selection down from its first row, as one undo step', async ({ page }) => {
    await page.evaluate(() => {
      window.__sheet!.setCellInput(0, 0, 'top');
      window.__sheet!.setCellInput(1, 0, 'x');
    });
    await clickCell(page, 0, 0);
    await clickCell(page, 3, 0, { modifiers: ['Shift'] });
    await page.keyboard.press(`${mod}+d`);
    expect([0, 1, 2, 3]).toEqual([0, 1, 2, 3]);
    expect(await cellValue(page, 3, 0)).toBe('top');
    expect(await cellValue(page, 1, 0)).toBe('top');
    await page.keyboard.press(`${mod}+z`);
    expect(await cellValue(page, 1, 0)).toBe('x');
    expect(await cellValue(page, 3, 0)).toBeNull();
  });

  test('Mod+D with one cell selected copies from the cell above', async ({ page }) => {
    await page.evaluate(() => window.__sheet!.setCellInput(0, 0, 'above'));
    await clickCell(page, 1, 0);
    await page.keyboard.press(`${mod}+d`);
    expect(await cellValue(page, 1, 0)).toBe('above');
  });

  test('Mod+R fills right', async ({ page }) => {
    await page.evaluate(() => window.__sheet!.setCellInput(0, 0, 'left'));
    await clickCell(page, 0, 0);
    await clickCell(page, 0, 3, { modifiers: ['Shift'] });
    await page.keyboard.press(`${mod}+r`);
    expect(await cellValue(page, 0, 3)).toBe('left');
  });

  test('Mod+Enter fills the whole selection with what was typed', async ({ page }) => {
    await clickCell(page, 0, 0);
    await clickCell(page, 2, 1, { modifiers: ['Shift'] });
    await page.keyboard.type('7');
    await page.keyboard.press(`${mod}+Enter`);
    expect(await cellValue(page, 0, 0)).toBe(7);
    expect(await cellValue(page, 2, 1)).toBe(7);
    expect(await page.evaluate(() => window.__grid!.editor.editing)).toBe(false);
  });

  test('underline, strikethrough and alignment shortcuts', async ({ page }) => {
    await page.evaluate(() => window.__sheet!.setCellInput(0, 0, 'x'));
    await clickCell(page, 0, 0);
    await page.keyboard.press(`${mod}+u`);
    await page.keyboard.press(`${mod}+Shift+x`);
    await page.keyboard.press(`${mod}+Shift+e`);
    expect(await styleOf(page, 0, 0)).toEqual({ underline: true, strike: true, align: 'center' });
    await page.keyboard.press(`${mod}+Shift+r`);
    expect((await styleOf(page, 0, 0)).align).toBe('right');
    await page.keyboard.press(`${mod}+\\`);
    expect(await styleOf(page, 0, 0)).toEqual({});
    expect(await cellValue(page, 0, 0)).toBe('x');
  });

  test('number format shortcuts', async ({ page }) => {
    await page.evaluate(() => window.__sheet!.setCellInput(0, 0, '0.256'));
    await clickCell(page, 0, 0);
    await page.keyboard.press(`${mod}+Shift+5`);
    expect(await page.evaluate(() => window.__sheet!.getDisplayText(0, 0))).toBe('26%');
    await page.keyboard.press(`${mod}+Shift+4`);
    expect(await page.evaluate(() => window.__sheet!.getDisplayText(0, 0))).toBe('$0.26');
    await page.keyboard.press(`${mod}+Shift+1`);
    expect(await page.evaluate(() => window.__sheet!.getDisplayText(0, 0))).toBe('0.26');
  });

  test('Mod+Shift+V pastes values only, keeping the target formatting', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'needs real clipboard shortcuts');
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.evaluate(() => {
      const s = window.__sheet!;
      s.setCellInput(0, 0, '2');
      s.setCellInput(0, 1, '=A1*5');
      s.selection.selectCell(0, 1);
      s.toggleStyle('bold');
    });
    await clickCell(page, 0, 1);
    await page.keyboard.press(`${mod}+c`);
    await clickCell(page, 4, 4);
    await page.keyboard.press(`${mod}+Shift+v`);
    // Some browsers fire no paste event for this shortcut, so the controller falls back to an async clipboard read.
    await expect.poll(() => cellValue(page, 4, 4)).toBe(10);
    expect(await page.evaluate(() => window.__sheet!.getEditText(4, 4))).toBe('10'); // no formula carried over
    expect(await styleOf(page, 4, 4)).toEqual({}); // and no bold
    await clickCell(page, 5, 5);
    await page.keyboard.press(`${mod}+v`); // a normal paste afterwards is not values-only
    expect(await page.evaluate(() => window.__sheet!.getEditText(5, 5))).toBe('=E6*5');
  });

  test('Mod+U does not trigger the browser (view source) and toolbar shows the state', async ({ page }) => {
    await clickCell(page, 0, 0);
    await page.keyboard.press(`${mod}+u`);
    await expect(page.getByRole('button', { name: 'Underline' })).toHaveAttribute('aria-pressed', 'true');
  });
});

test.describe('pointing at cells while typing a formula', () => {
  const editorText = (page: import('@playwright/test').Page): Promise<string> => page.evaluate(() => window.__grid!.editor.text);

  test('arrows insert and move a reference, Shift extends it to a range', async ({ page }) => {
    await clickCell(page, 0, 2);
    await page.keyboard.type('=SUM(');
    await page.keyboard.press('ArrowDown');
    expect(await editorText(page)).toBe('=SUM(C2');
    await page.keyboard.press('ArrowDown');
    expect(await editorText(page)).toBe('=SUM(C3');
    await page.keyboard.press('Shift+ArrowDown');
    expect(await editorText(page)).toBe('=SUM(C3:C4');
    await page.keyboard.press('Shift+ArrowRight');
    expect(await editorText(page)).toBe('=SUM(C3:D4');
    await page.keyboard.press('ArrowRight'); // a plain arrow moves from the anchor (C3), not from the dragged corner
    expect(await editorText(page)).toBe('=SUM(D3');
    expect(await page.evaluate(() => window.__grid!.editor.editing)).toBe(true);
  });

  test('the formula computes from pointed cells after Enter', async ({ page }) => {
    await page.evaluate(() => {
      window.__sheet!.setCellInput(1, 2, '4');
      window.__sheet!.setCellInput(2, 2, '6');
    });
    await clickCell(page, 0, 2);
    await page.keyboard.type('=SUM(');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.type(')');
    await page.keyboard.press('Enter');
    expect(await cellValue(page, 0, 2)).toBe(10);
    expect(await page.evaluate(() => window.__sheet!.getEditText(0, 2))).toBe('=SUM(C2:C3)');
  });

  test('typing after a pointed reference continues the formula; arrows then move the caret', async ({ page }) => {
    await clickCell(page, 0, 0);
    await page.keyboard.type('=');
    await page.keyboard.press('ArrowRight');
    expect(await editorText(page)).toBe('=B1');
    await page.keyboard.type('+1');
    await page.keyboard.press('ArrowLeft'); // after "+1" a reference cannot go here: plain caret move
    expect(await editorText(page)).toBe('=B1+1');
    // The caret was moved by hand, so this is edit mode now: the next arrow moves the caret even right after '+'.
    await page.keyboard.press('ArrowLeft'); // caret now between '+' and '1'; one more puts it right after B1
    await page.keyboard.type('9');
    expect(await editorText(page)).toBe('=B19+1');
  });

  test('F2 opens edit mode, where arrows move the caret even right after an operator', async ({ page }) => {
    await page.evaluate(() => window.__sheet!.setCellInput(0, 0, '=1+'));
    await clickCell(page, 0, 0);
    await page.keyboard.press('F2');
    await page.keyboard.press('ArrowLeft');
    expect(await editorText(page)).toBe('=1+');
    await page.keyboard.type('X');
    expect(await editorText(page)).toBe('=1X+');
  });

  test('a new arrow press after typing an operator points again', async ({ page }) => {
    await clickCell(page, 1, 1);
    await page.keyboard.type('=');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.type('+');
    await page.keyboard.press('ArrowLeft');
    expect(await editorText(page)).toBe('=B1+A2');
  });

  test('clicking a cell inserts its reference, clicking another replaces it, dragging makes a range', async ({ page }) => {
    await clickCell(page, 0, 0);
    await page.keyboard.type('=');
    await clickCell(page, 3, 1);
    expect(await editorText(page)).toBe('=B4');
    await clickCell(page, 4, 2);
    expect(await editorText(page)).toBe('=C5');
    const a = await cellCenter(page, 1, 1);
    const b = await cellCenter(page, 3, 2);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 5 });
    await page.mouse.up();
    expect(await editorText(page)).toBe('=B2:C4');
    expect(await page.evaluate(() => window.__grid!.editor.editing)).toBe(true);
  });

  test('clicking a cell while the caret is after a complete reference ends the edit as usual', async ({ page }) => {
    await clickCell(page, 0, 0);
    await page.keyboard.type('=A1');
    await clickCell(page, 3, 3);
    expect(await page.evaluate(() => window.__grid!.editor.editing)).toBe(false);
    expect((await selection(page)).active).toEqual([3, 3]);
  });

  test('clicking while typing plain text still commits', async ({ page }) => {
    await clickCell(page, 0, 0);
    await page.keyboard.type('abc');
    await clickCell(page, 2, 2);
    expect(await cellValue(page, 0, 0)).toBe('abc');
  });

  test('F4 cycles absolute and relative on the reference at the caret', async ({ page }) => {
    await clickCell(page, 0, 0);
    await page.keyboard.type('=B2+1');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('F4');
      seen.push(await editorText(page));
    }
    expect(seen).toEqual(['=$B$2+1', '=B$2+1', '=$B2+1', '=B2+1']);
  });

  test('each reference gets a color, the same reference the same color', async ({ page }) => {
    await clickCell(page, 0, 0);
    await page.keyboard.type('=SUM(B2:C3)+D4+B2:C3');
    const refs = await page.evaluate(() => window.__grid!.editor.refs.map((r) => ({ text: r.text, color: r.color })));
    expect(refs.map((r) => r.text)).toEqual(['B2:C3', 'D4', 'B2:C3']);
    expect(refs[0]?.color).toBe(refs[2]?.color);
    expect(refs[0]?.color).not.toBe(refs[1]?.color);
    // The colored text lives in a backdrop behind the transparent textarea.
    const spans = await page.evaluate(() => window.__grid!.editor.textarea.previousElementSibling?.querySelectorAll('span').length);
    expect(spans).toBe(3);
  });

  test('during IME composition the textarea shows its own text', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'composition events are simulated through CDP');
    await clickCell(page, 0, 0);
    await page.keyboard.type('="');
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.imeSetComposition', { text: 'có', selectionStart: 2, selectionEnd: 2 });
    const color = await page.evaluate(() => getComputedStyle(window.__grid!.editor.textarea).color);
    expect(color).not.toBe('rgba(0, 0, 0, 0)');
    await cdp.send('Input.insertText', { text: 'có' });
    await page.keyboard.type('"');
    await page.keyboard.press('Enter');
    expect(await cellValue(page, 0, 0)).toBe('có');
  });

  test('Escape after pointing cancels the whole edit and undo stays clean', async ({ page }) => {
    await clickCell(page, 0, 0);
    await page.keyboard.type('=');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Escape');
    expect(await cellValue(page, 0, 0)).toBeNull();
    expect(await page.evaluate(() => window.__sheet!.history.canUndo)).toBe(false);
  });

  test('pointing scrolls the referenced cell into view', async ({ page }) => {
    await clickCell(page, 0, 0);
    await page.keyboard.type('=');
    for (let i = 0; i < 60; i++) await page.keyboard.press('ArrowDown');
    expect(await editorText(page)).toBe('=A61');
    expect(await page.evaluate(() => window.__grid!.surface.viewport.scrollY)).toBeGreaterThan(0);
  });
});

test.describe('auto-fit column width', () => {
  async function borderPos(page: import('@playwright/test').Page, col: number): Promise<{ x: number; y: number }> {
    return page.evaluate((c) => {
      const g = window.__grid!;
      const v = g.surface.viewport;
      const r = g.surface.host.getBoundingClientRect();
      return { x: r.left + v.colLeft(c) + g.sheet.cols.getSize(c), y: r.top + v.headerHeight / 2 };
    }, col);
  }

  test('double-click on the column border fits the widest content, in one undo step', async ({ page }) => {
    await page.evaluate(() => {
      window.__sheet!.setCellInput(0, 1, 'a');
      window.__sheet!.setCellInput(1, 1, 'a considerably longer piece of text');
    });
    const { x, y } = await borderPos(page, 1);
    await page.mouse.dblclick(x, y);
    const width = await page.evaluate(() => window.__sheet!.cols.getSize(1));
    expect(width).toBeGreaterThan(150);
    expect(width).toBeLessThan(400);
    await clickCell(page, 0, 0);
    await page.keyboard.press(`${mod}+z`);
    expect(await page.evaluate(() => window.__sheet!.cols.getSize(1))).toBe(100);
  });

  test('an empty column goes back to the default width and a narrow one shrinks', async ({ page }) => {
    await page.evaluate(() => {
      window.__sheet!.cols.setSize(0, 300);
      window.__sheet!.setCellInput(0, 2, 'x');
      window.__sheet!.cols.setSize(2, 300);
    });
    let pos = await borderPos(page, 0);
    await page.mouse.dblclick(pos.x, pos.y);
    expect(await page.evaluate(() => window.__sheet!.cols.getSize(0))).toBe(100);
    pos = await borderPos(page, 2);
    await page.mouse.dblclick(pos.x, pos.y);
    expect(await page.evaluate(() => window.__sheet!.cols.getSize(2))).toBeLessThan(40);
  });

  test('with several whole columns selected each one fits its own content', async ({ page }) => {
    await page.evaluate(() => {
      window.__sheet!.setCellInput(0, 0, 'short');
      window.__sheet!.setCellInput(0, 1, 'a much much longer value here');
    });
    const box = await page.getByTestId('grid').boundingBox();
    const hdr = await page.evaluate(() => {
      const v = window.__grid!.surface.viewport;
      return { a: v.colLeft(0) + 20, b: v.colLeft(1) + 20, y: v.headerHeight / 2 };
    });
    await page.mouse.click(box!.x + hdr.a, box!.y + hdr.y);
    await page.keyboard.down('Shift');
    await page.mouse.click(box!.x + hdr.b, box!.y + hdr.y);
    await page.keyboard.up('Shift');
    const { x, y } = await borderPos(page, 1);
    await page.mouse.dblclick(x, y);
    const widths = await page.evaluate(() => [window.__sheet!.cols.getSize(0), window.__sheet!.cols.getSize(1)]);
    expect(widths[1]).toBeGreaterThan(widths[0] as number);
  });
});
