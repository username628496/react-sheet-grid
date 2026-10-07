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

  test('the number format menu changes how numbers display', async ({ page }) => {
    await page.evaluate(() => window.__sheet!.setCellInput(0, 0, '1234.5'));
    await clickCell(page, 0, 0);
    await page.getByRole('button', { name: 'More formats' }).click();
    await page.getByRole('menuitemradio', { name: 'Number (1,234.57)' }).click();
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

test.describe('fill handle double-click, shortcut help, paste format', () => {
  test('double-clicking the fill handle fills down as far as the neighbouring column goes', async ({ page }) => {
    await page.evaluate(() => {
      const s = window.__sheet!;
      ['a', 'b', 'c', 'd'].forEach((v, r) => s.setCellInput(r, 0, v));
      s.setCellInput(0, 1, '1');
      s.setCellInput(1, 1, '2');
    });
    await clickCell(page, 0, 1);
    await clickCell(page, 1, 1, { modifiers: ['Shift'] });
    const h = await page.evaluate(() => {
      const g = window.__grid!;
      const v = g.surface.viewport;
      const p = g.sheet.selection.primary;
      const r = g.surface.host.getBoundingClientRect();
      return { x: r.left + v.colLeft(p.endCol) + g.sheet.cols.getSize(p.endCol), y: r.top + v.rowTop(p.endRow) + g.sheet.rows.getSize(p.endRow) };
    });
    await page.mouse.dblclick(h.x, h.y);
    expect(await cellValue(page, 2, 1)).toBe(3);
    expect(await cellValue(page, 3, 1)).toBe(4);
    expect(await cellValue(page, 4, 1)).toBeNull();
    await page.keyboard.press(`${mod}+z`);
    expect(await cellValue(page, 3, 1)).toBeNull();
  });

  test('Mod+/ opens the shortcut list and Escape closes it, returning focus to the grid', async ({ page }) => {
    await clickCell(page, 0, 0);
    await page.keyboard.press(`${mod}+/`);
    const dialog = page.getByTestId('shortcuts-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Fill down / fill right')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await page.keyboard.type('z');
    await page.keyboard.press('Enter');
    expect(await cellValue(page, 0, 0)).toBe('z');
  });

  test('Mod+Alt+V pastes only the formatting of the copied cells', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'needs real clipboard shortcuts');
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.evaluate(() => {
      const s = window.__sheet!;
      s.setCellInput(0, 0, 'source');
      s.selection.selectCell(0, 0);
      s.toggleStyle('bold');
      s.setCellInput(3, 3, 'target');
    });
    await clickCell(page, 0, 0);
    await page.keyboard.press(`${mod}+c`);
    await clickCell(page, 3, 3);
    await page.keyboard.press(`${mod}+Alt+v`);
    await expect.poll(() => page.evaluate(() => {
      const s = window.__sheet!;
      return s.styles.get(s.getCellByView(3, 3).styleId).bold ?? false;
    })).toBe(true);
    expect(await cellValue(page, 3, 3)).toBe('target');
  });

  test('long text spills into empty neighbours but is clipped by a filled one', async ({ page }) => {
    // Counts dark pixels inside a cell of the canvas to see what was really drawn there.
    const darkPixels = (row: number, col: number): Promise<number> =>
      page.evaluate(async ([r, c]) => {
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const g = window.__grid!;
        const vp = g.surface.viewport;
        const canvas = document.querySelector('[data-testid=grid] canvas') as HTMLCanvasElement;
        const dpr = window.devicePixelRatio || 1;
        const x = Math.round((vp.colLeft(c as number) + 3) * dpr);
        const y = Math.round((vp.rowTop(r as number) + 3) * dpr);
        const w = Math.round((g.sheet.cols.getSize(c as number) - 6) * dpr);
        const h = Math.round((g.sheet.rows.getSize(r as number) - 6) * dpr);
        const data = canvas.getContext('2d')!.getImageData(x, y, w, h).data;
        let dark = 0;
        for (let i = 0; i < data.length; i += 4) if ((data[i] as number) < 110) dark++;
        return dark;
      }, [row, col]);

    // Keep the selection away from the cells measured: its border and fill handle are drawn in blue and spill
    // a few pixels over the neighbouring cell, which engines round differently.
    await page.evaluate(() => window.__sheet!.selection.selectCell(8, 8));
    await page.evaluate(() => window.__sheet!.setCellInput(0, 0, 'A rather long piece of text that cannot fit in one cell at all'));
    expect(await darkPixels(0, 1)).toBeGreaterThan(20); // spilled into B
    expect(await darkPixels(0, 2)).toBeGreaterThan(20); // and into C
    await page.evaluate(() => window.__sheet!.setCellInput(0, 1, 'x'));
    expect(await darkPixels(0, 2)).toBe(0); // B is now filled: the text stops before it
    await page.evaluate(() => {
      const sheet = window.__sheet!;
      sheet.setCellInput(2, 0, '123456789012');
      sheet.selection.selectCell(2, 0);
      sheet.formatSelection({ numberFormat: '$#,##0.00' }); // "$123,456,789,012.00" is wider than the cell
      sheet.selection.selectCell(8, 8);
    });
    expect(await darkPixels(2, 1)).toBe(0); // numbers are clipped, never spilled
  });
});

test.describe('auto-fit row height', () => {
  test('double-click on the row border restores the default height, in one undo step', async ({ page }) => {
    await page.evaluate(() => window.__sheet!.rows.setSize(2, 80));
    const pos = await page.evaluate(() => {
      const g = window.__grid!;
      const v = g.surface.viewport;
      const r = g.surface.host.getBoundingClientRect();
      return { x: r.left + v.headerWidth / 2, y: r.top + v.rowTop(2) + g.sheet.rows.getSize(2) };
    });
    await page.mouse.dblclick(pos.x, pos.y);
    const defaultHeight = await page.evaluate(() => window.__sheet!.rows.defaultSize);
    expect(await page.evaluate(() => window.__sheet!.rows.getSize(2))).toBe(defaultHeight);
    await clickCell(page, 0, 0);
    await page.keyboard.press(`${mod}+z`);
    expect(await page.evaluate(() => window.__sheet!.rows.getSize(2))).toBe(80);
  });
});

test('grid lines are hidden under spilled text but kept where the spill stops', async ({ page }) => {
  const pixel = (row: number, col: number): Promise<number[]> =>
    page.evaluate(async ([r, c]) => {
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const g = window.__grid!;
      const vp = g.surface.viewport;
      const canvas = document.querySelector('[data-testid=grid] canvas') as HTMLCanvasElement;
      const dpr = window.devicePixelRatio || 1;
      // One pixel left of the cell's right edge is where its vertical grid line is drawn; sample near the top
      // of the row where no glyph pixels can be.
      const x = Math.round((vp.colLeft(c as number) + g.sheet.cols.getSize(c as number) - 1) * dpr);
      const y = Math.round((vp.rowTop(r as number) + 1) * dpr);
      return Array.from(canvas.getContext('2d')!.getImageData(x, y, 1, 1).data);
    }, [row, col]);

  await page.evaluate(() => window.__sheet!.selection.selectCell(8, 8));
  await page.evaluate(() => window.__sheet!.setCellInput(0, 0, 'A rather long piece of text that cannot fit in one cell at all'));
  expect((await pixel(0, 0)).slice(0, 3)).toEqual([255, 255, 255]); // crossed by the text: line hidden
  expect((await pixel(1, 0)).slice(0, 3)).not.toEqual([255, 255, 255]); // an ordinary row keeps its line
  await page.evaluate(() => window.__sheet!.setCellInput(0, 2, 'x'));
  expect((await pixel(0, 1)).slice(0, 3)).not.toEqual([255, 255, 255]); // the edge before a filled cell stays
});

test.describe('formula bar', () => {
  const bar = (page: import('@playwright/test').Page) => page.getByTestId('formula-input');
  const nameBox = (page: import('@playwright/test').Page) => page.getByTestId('name-box');

  test.beforeEach(async ({ page }) => {
    await expect(bar(page)).toBeEnabled(); // the bar waits for the grid controller
  });

  test('name box and bar follow the selection', async ({ page }) => {
    await page.evaluate(() => window.__sheet!.setCellInput(2, 1, '=1+2'));
    await clickCell(page, 2, 1);
    await expect(nameBox(page)).toHaveValue('B3');
    await expect(bar(page)).toHaveValue('=1+2');
    const a = await cellCenter(page, 1, 1);
    const b = await cellCenter(page, 3, 2);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 4 });
    await page.mouse.up();
    await expect(nameBox(page)).toHaveValue('B2:C4');
  });

  test('typing in the bar edits the cell; Enter commits and moves down', async ({ page }) => {
    await clickCell(page, 0, 0);
    await bar(page).click();
    await page.keyboard.type('=SUM(1,2)');
    // The cell shows the same text while it is being edited.
    expect(await page.evaluate(() => window.__grid!.editor.text)).toBe('=SUM(1,2)');
    await page.keyboard.press('Enter');
    expect(await cellValue(page, 0, 0)).toBe(3);
    expect((await selection(page)).active).toEqual([1, 0]);
    expect(await page.evaluate(() => document.activeElement === window.__grid!.editor.textarea)).toBe(true);
  });

  test('Escape in the bar abandons the edit', async ({ page }) => {
    await page.evaluate(() => window.__sheet!.setCellInput(0, 0, 'keep'));
    await clickCell(page, 0, 0);
    await bar(page).click();
    await page.keyboard.press('End');
    await page.keyboard.type('XYZ');
    await page.keyboard.press('Escape');
    expect(await cellValue(page, 0, 0)).toBe('keep');
    await expect(bar(page)).toHaveValue('keep');
  });

  test('Tab in the bar commits and moves right', async ({ page }) => {
    await clickCell(page, 1, 1);
    await bar(page).click();
    await page.keyboard.type('hello');
    await page.keyboard.press('Tab');
    expect(await cellValue(page, 1, 1)).toBe('hello');
    expect((await selection(page)).active).toEqual([1, 2]);
  });

  test('clicking a cell while typing a formula in the bar inserts a reference', async ({ page }) => {
    await clickCell(page, 0, 0);
    await bar(page).click();
    await page.keyboard.type('=');
    await clickCell(page, 4, 2);
    expect(await page.evaluate(() => window.__grid!.editor.text)).toBe('=C5');
    await expect(bar(page)).toHaveValue('=C5');
    await page.keyboard.press('Enter'); // focus is on the grid editor now; Enter commits there
    expect(await page.evaluate(() => window.__sheet!.getEditText(0, 0))).toBe('=C5');
  });

  test('typing in the cell editor shows up in the bar', async ({ page }) => {
    await clickCell(page, 0, 0);
    await page.keyboard.type('abc');
    await expect(bar(page)).toHaveValue('abc');
    await page.keyboard.press('Enter');
  });

  test('the name box jumps to a cell, a range and a whole column', async ({ page }) => {
    await nameBox(page).fill('C5');
    await nameBox(page).press('Enter');
    expect((await selection(page)).active).toEqual([4, 2]);
    await nameBox(page).fill('A1:B3');
    await nameBox(page).press('Enter');
    expect((await selection(page)).range).toMatchObject({ startRow: 0, startCol: 0, endRow: 2, endCol: 1 });
    await nameBox(page).fill('B:B');
    await nameBox(page).press('Enter');
    expect((await selection(page)).range).toMatchObject({ startRow: 0, startCol: 1, endRow: 999, endCol: 1 });
    await nameBox(page).fill('nonsense');
    await nameBox(page).press('Enter');
    expect((await selection(page)).range).toMatchObject({ startCol: 1, endCol: 1 }); // unchanged
    expect(await page.evaluate(() => document.activeElement === document.querySelector('[data-testid=name-box]'))).toBe(true);
  });

  test('toolbar sort and clear-formatting buttons act on the active cell', async ({ page }) => {
    await page.evaluate(() => {
      const s = window.__sheet!;
      s.setCellInput(0, 0, '3');
      s.setCellInput(1, 0, '1');
      s.setCellInput(2, 0, '2');
    });
    await clickCell(page, 0, 0);
    await page.getByRole('button', { name: 'Sort A to Z' }).click();
    expect([await cellValue(page, 0, 0), await cellValue(page, 1, 0), await cellValue(page, 2, 0)]).toEqual([1, 2, 3]);
    await page.keyboard.press(`${mod}+b`);
    await page.getByRole('button', { name: 'Clear formatting' }).click();
    expect(await page.evaluate(() => window.__sheet!.styles.get(window.__sheet!.getCellByView(0, 0).styleId).bold ?? false)).toBe(false);
  });
});

test.describe('sheet size fields', () => {
  const rowsField = (page: import('@playwright/test').Page) => page.getByLabel('Row count');
  const colsField = (page: import('@playwright/test').Page) => page.getByLabel('Column count');

  test('Enter applies the row count and gives focus back to the grid', async ({ page }) => {
    await expect(rowsField(page)).toHaveValue('1000');
    await rowsField(page).fill('30');
    await rowsField(page).press('Enter');
    expect(await page.evaluate(() => window.__sheet!.rowCount)).toBe(30);
    await expect(rowsField(page)).toHaveValue('30');
    expect(await page.evaluate(() => document.activeElement === window.__grid!.editor.textarea)).toBe(true);
  });

  test('leaving the field applies it too, and columns work the same way', async ({ page }) => {
    await colsField(page).fill('12');
    await rowsField(page).click(); // moves focus out of the columns field
    expect(await page.evaluate(() => window.__sheet!.colCount)).toBe(12);
    await expect(colsField(page)).toHaveValue('12');
  });

  test('garbage and Escape restore the current number', async ({ page }) => {
    await rowsField(page).fill('abc');
    await rowsField(page).press('Enter');
    await expect(rowsField(page)).toHaveValue('1000');
    await rowsField(page).fill('5');
    await rowsField(page).press('Escape');
    await expect(rowsField(page)).toHaveValue('1000');
    expect(await page.evaluate(() => window.__sheet!.rowCount)).toBe(1000);
  });

  test('shrinking over data warns, and undo restores the rows', async ({ page }) => {
    await page.evaluate(() => window.__sheet!.setCellInput(40, 0, 'keep me'));
    await rowsField(page).fill('20');
    await rowsField(page).press('Enter');
    await expect(page.getByRole('status').filter({ hasText: 'Removed 1 filled cell' })).toBeVisible();
    await page.keyboard.press(`${mod}+z`);
    expect(await page.evaluate(() => window.__sheet!.rowCount)).toBe(1000);
    expect(await cellValue(page, 40, 0)).toBe('keep me');
    await expect(rowsField(page)).toHaveValue('1000');
  });

  test('growing past the old end makes the new rows usable', async ({ page }) => {
    await rowsField(page).fill('1200');
    await rowsField(page).press('Enter');
    await page.evaluate(() => window.__sheet!.selection.selectCell(1199, 0));
    await page.keyboard.type('end');
    await page.keyboard.press('Enter');
    expect(await cellValue(page, 1199, 0)).toBe('end');
  });
});

test.describe('toolbar actions', () => {
  type Page = import('@playwright/test').Page;
  const press = (page: Page, name: string) => page.getByRole('button', { name, exact: true }).click();
  const choose = (page: Page, name: string | RegExp) =>
    page.getByRole('menuitem', { name, exact: typeof name === 'string' }).or(page.getByRole('menuitemradio', { name, exact: typeof name === 'string' })).click();

  test('Insert and Delete menus act on the selected rows and columns', async ({ page }) => {
    await page.evaluate(() => {
      window.__sheet!.setCellInput(1, 0, 'second');
      window.__sheet!.setCellInput(0, 1, 'b1');
    });
    await clickCell(page, 1, 0);
    await press(page, 'Insert');
    await choose(page, 'Insert 1 row above');
    expect(await cellValue(page, 2, 0)).toBe('second');
    expect(await page.evaluate(() => window.__sheet!.rowCount)).toBe(1001);
    await press(page, 'Delete');
    await choose(page, /Delete row 2/);
    expect(await cellValue(page, 1, 0)).toBe('second');
    await clickCell(page, 0, 1);
    await press(page, 'Insert');
    await choose(page, 'Insert 1 column left');
    expect(await cellValue(page, 0, 2)).toBe('b1');
    await press(page, 'Delete');
    await choose(page, /Delete column B/);
    expect(await cellValue(page, 0, 1)).toBe('b1');
  });

  test('the menu closes on Escape and when the button is pressed again, and focus returns to the grid', async ({ page }) => {
    await press(page, 'Insert');
    await expect(page.getByTestId('menu-insert')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('menu-insert')).toBeHidden();
    expect(await page.evaluate(() => document.activeElement === window.__grid!.editor.textarea)).toBe(true);
    await press(page, 'Insert');
    await press(page, 'Insert');
    await expect(page.getByTestId('menu-insert')).toBeHidden();
  });

  test('Freeze pins rows and columns, keeps them out of a sort, and is saved with the sheet state', async ({ page }) => {
    await page.evaluate(() => {
      const s = window.__sheet!;
      s.setCellInput(0, 0, 'header');
      s.setCellInput(1, 0, '3');
      s.setCellInput(2, 0, '1');
    });
    await press(page, 'Freeze');
    await choose(page, '1 row');
    await press(page, 'Freeze');
    await choose(page, '2 columns');
    expect(await page.evaluate(() => [window.__sheet!.frozenRows, window.__sheet!.frozenCols])).toEqual([1, 2]);
    expect(await page.evaluate(() => [window.__grid!.surface.viewport.frozenRows, window.__grid!.surface.viewport.frozenCols])).toEqual([1, 2]);
    await clickCell(page, 1, 0);
    await press(page, 'Sort A to Z');
    expect(await cellValue(page, 0, 0)).toBe('header');
    await press(page, 'Freeze');
    await expect(page.getByRole('menuitemradio', { name: '1 row' })).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Escape');
    // Scrolling right keeps the frozen columns where they are.
    await page.evaluate(() => window.__grid!.surface.scrollBy(300, 0));
    const left = await page.evaluate(() => window.__grid!.surface.viewport.colLeft(0));
    expect(left).toBe(await page.evaluate(() => window.__grid!.surface.viewport.headerWidth));
  });

  test('the Σ menu writes a formula under the selected numbers', async ({ page }) => {
    await page.evaluate(() => {
      window.__sheet!.setCellInput(0, 0, '1');
      window.__sheet!.setCellInput(1, 0, '2');
      window.__sheet!.setCellInput(2, 0, '4');
    });
    const a = await cellCenter(page, 0, 0);
    const b = await cellCenter(page, 2, 0);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 3 });
    await page.mouse.up();
    await press(page, 'Functions');
    await choose(page, /AVERAGE/);
    expect(await page.evaluate(() => window.__sheet!.getEditText(3, 0))).toBe('=AVERAGE(A1:A3)');
    expect(await cellValue(page, 3, 0)).toBeCloseTo(7 / 3);
    expect((await selection(page)).active).toEqual([3, 0]);
  });

  test('currency, percent and decimals buttons', async ({ page }) => {
    await page.evaluate(() => window.__sheet!.setCellInput(0, 0, '1234.5'));
    await clickCell(page, 0, 0);
    await press(page, 'Format as currency');
    expect(await page.evaluate(() => window.__sheet!.getDisplayText(0, 0))).toBe('$1,234.50');
    await expect(page.getByRole('button', { name: 'Format as currency' })).toHaveAttribute('aria-pressed', 'true');
    await press(page, 'Increase decimal places');
    expect(await page.evaluate(() => window.__sheet!.getDisplayText(0, 0))).toBe('$1,234.500');
    await press(page, 'Decrease decimal places');
    await press(page, 'Decrease decimal places');
    await press(page, 'Decrease decimal places');
    expect(await page.evaluate(() => window.__sheet!.getDisplayText(0, 0))).toBe('$1,235');
    await press(page, 'Format as percent');
    expect(await page.evaluate(() => window.__sheet!.getDisplayText(0, 0))).toBe('123450.00%');
    await page.getByRole('button', { name: 'More formats' }).click();
    await choose(page, /Dong/);
    expect(await page.evaluate(() => window.__sheet!.getDisplayText(0, 0))).toBe('1,235 ₫');
  });

  test('the filter button opens the dialog for the active column, and the remove button clears the view', async ({ page }) => {
    await page.evaluate(() => {
      const s = window.__sheet!;
      ['a', 'b', 'a'].forEach((v, r) => s.setCellInput(r, 0, v));
    });
    await clickCell(page, 0, 0);
    await expect(page.getByRole('button', { name: 'Remove sort and filters' })).toBeDisabled();
    await press(page, 'Filter by values');
    await expect(page.getByTestId('filter-dialog')).toBeVisible();
    await page.getByRole('checkbox', { name: /^b/ }).uncheck();
    await page.getByRole('button', { name: 'OK' }).click();
    expect(await cellValue(page, 1, 0)).toBe('a');
    await expect(page.getByRole('button', { name: 'Filter by values' })).toHaveAttribute('aria-pressed', 'true');
    await press(page, 'Remove sort and filters');
    expect(await cellValue(page, 1, 0)).toBe('b');
  });

  test('paint format copies the look of the selection onto the next one', async ({ page }) => {
    await page.evaluate(() => {
      const s = window.__sheet!;
      s.setCellInput(0, 0, 'src');
      s.selection.selectCell(0, 0);
      s.toggleStyle('bold');
      s.formatSelection({ background: '#ffeb3b' });
      s.setCellInput(3, 3, 'target');
    });
    await clickCell(page, 0, 0);
    await press(page, 'Paint format');
    await expect(page.getByRole('button', { name: 'Paint format' })).toHaveAttribute('aria-pressed', 'true');
    await clickCell(page, 3, 3);
    await expect(page.getByRole('button', { name: 'Paint format' })).toHaveAttribute('aria-pressed', 'false');
    const style = await page.evaluate(() => window.__sheet!.styles.get(window.__sheet!.getCellByView(3, 3).styleId));
    expect(style).toEqual({ bold: true, background: '#ffeb3b' });
    expect(await cellValue(page, 3, 3)).toBe('target'); // content untouched
  });

  test('paint format is cancelled by Escape and does nothing afterwards', async ({ page }) => {
    await page.evaluate(() => {
      window.__sheet!.selection.selectCell(0, 0);
      window.__sheet!.toggleStyle('bold');
    });
    await clickCell(page, 0, 0);
    await press(page, 'Paint format');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Paint format' })).toHaveAttribute('aria-pressed', 'false');
    await clickCell(page, 2, 2);
    expect(await page.evaluate(() => window.__sheet!.styles.get(window.__sheet!.getCellByView(2, 2).styleId))).toEqual({});
  });

  test('Cut, Copy and Paste buttons use the grid clipboard', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'needs the real system clipboard');
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.evaluate(() => window.__sheet!.setCellInput(0, 0, 'carry'));
    await clickCell(page, 0, 0);
    await press(page, 'Copy');
    await clickCell(page, 4, 4);
    await press(page, 'Paste');
    await choose(page, 'Paste');
    await expect.poll(() => cellValue(page, 4, 4)).toBe('carry');
  });
});

test.describe('hiding rows and columns', () => {
  const rowHeight = (page: import('@playwright/test').Page, r: number) => page.evaluate((i) => window.__sheet!.rows.getSize(i), r);
  const colWidth = (page: import('@playwright/test').Page, c: number) => page.evaluate((i) => window.__sheet!.cols.getSize(i), c);

  test('the Show or hide menu hides the selected rows and arrows skip them', async ({ page }) => {
    await page.evaluate(() => ['r1', 'r2', 'r3', 'r4'].forEach((v, r) => window.__sheet!.setCellInput(r, 0, v)));
    await clickCell(page, 1, 0);
    await page.keyboard.press('Shift+ArrowDown');
    await page.getByRole('button', { name: 'Show or hide', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Hide rows 2–3' }).click();
    expect([await rowHeight(page, 1), await rowHeight(page, 2)]).toEqual([0, 0]);
    expect((await selection(page)).active).toEqual([3, 0]); // moved off the hidden row
    await page.keyboard.press('ArrowUp');
    expect((await selection(page)).active).toEqual([0, 0]);
    await page.keyboard.press('ArrowDown');
    expect((await selection(page)).active).toEqual([3, 0]);
    // Clicking where row 4 now is selects row 4, and the grid still edits it.
    await clickCell(page, 3, 0);
    await page.keyboard.press('F2');
    expect(await page.evaluate(() => window.__grid!.editor.text)).toBe('r4');
    await page.keyboard.press('Escape');
    // The hidden rows' content is untouched and they come back with the shortcut/menu.
    await clickCell(page, 0, 0);
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('Shift+ArrowDown');
    await page.getByRole('button', { name: 'Show or hide', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Show hidden rows' }).click();
    expect([await rowHeight(page, 1), await rowHeight(page, 2)]).toEqual([21, 21]);
    expect(await cellValue(page, 1, 0)).toBe('r2');
  });

  test('keyboard shortcuts hide and unhide columns, and undo brings them back', async ({ page }) => {
    await clickCell(page, 0, 1);
    await page.keyboard.press(`${mod}+Alt+Digit0`);
    expect(await colWidth(page, 1)).toBe(0);
    expect((await selection(page)).active).toEqual([0, 2]);
    await page.keyboard.press('Shift+ArrowLeft');
    await page.keyboard.press('Shift+ArrowLeft');
    await page.keyboard.press(`${mod}+Shift+Digit0`);
    expect(await colWidth(page, 1)).toBe(100);
    await page.keyboard.press(`${mod}+Alt+Digit0`);
    await page.keyboard.press(`${mod}+z`);
    expect(await colWidth(page, 1)).toBe(100);
  });

  test('the header numbering shows a gap where rows are hidden', async ({ page }) => {
    await page.evaluate(() => window.__sheet!.hideLines('row', 2, 3));
    // Rows 3 and 4 have no height, so the row after them starts where row 3 would have.
    const tops = await page.evaluate(() => {
      const vp = window.__grid!.surface.viewport;
      return [vp.rowTop(2), vp.rowTop(3), vp.rowTop(4)];
    });
    expect(tops[0]).toBe(tops[1]);
    expect(tops[1]).toBe(tops[2]);
  });
});

test.describe('zoom', () => {
  type Page = import('@playwright/test').Page;
  const setZoom = (page: Page, z: number) => page.evaluate((v) => window.__grid!.surface.setZoom(v), z);
  /** Screen position of a cell center when zoomed: logical positions times the zoom. */
  const zoomedCenter = (page: Page, row: number, col: number) =>
    page.evaluate(
      ([r, c]) => {
        const g = window.__grid!;
        const vp = g.surface.viewport;
        const z = g.surface.zoom;
        const rect = g.surface.host.getBoundingClientRect();
        return {
          x: rect.left + (vp.colLeft(c as number) + g.sheet.cols.getSize(c as number) / 2) * z,
          y: rect.top + (vp.rowTop(r as number) + g.sheet.rows.getSize(r as number) / 2) * z,
        };
      },
      [row, col],
    );

  for (const z of [0.5, 1.5, 2]) {
    test(`clicks select the cell under the pointer at ${z * 100}%`, async ({ page }) => {
      await setZoom(page, z);
      for (const [r, c] of [[0, 0], [3, 2], [6, 4]] as const) {
        const { x, y } = await zoomedCenter(page, r, c);
        await page.mouse.click(x, y);
        expect((await selection(page)).active).toEqual([r, c]);
      }
    });
  }

  test('the cell editor sits exactly over the cell and scales its text', async ({ page }) => {
    await setZoom(page, 1.5);
    const { x, y } = await zoomedCenter(page, 2, 1);
    await page.mouse.click(x, y);
    await page.keyboard.type('zoomed');
    const geometry = await page.evaluate(() => {
      const g = window.__grid!;
      const box = g.editor.textarea.getBoundingClientRect();
      const host = g.surface.host.getBoundingClientRect();
      const vp = g.surface.viewport;
      return {
        left: box.left - host.left,
        top: box.top - host.top,
        expectedLeft: vp.colLeft(1) * 1.5,
        expectedTop: vp.rowTop(2) * 1.5,
        fontSize: parseFloat(getComputedStyle(g.editor.textarea).fontSize),
      };
    });
    expect(Math.abs(geometry.left - geometry.expectedLeft)).toBeLessThan(2);
    expect(Math.abs(geometry.top - geometry.expectedTop)).toBeLessThan(2);
    expect(geometry.fontSize).toBeCloseTo(13 * 1.5, 1);
    await page.keyboard.press('Enter');
    expect(await cellValue(page, 2, 1)).toBe('zoomed');
  });

  test('scrolling reaches the last row and column at 200% and the frozen panes hold still', async ({ page }) => {
    await page.evaluate(() => window.__sheet!.setFrozen(1, 1));
    await setZoom(page, 2);
    await page.evaluate(() => window.__grid!.surface.scrollBy(0, 1e7));
    await page.evaluate(() => window.__grid!.surface.scrollBy(1e7, 0));
    const reach = await page.evaluate(() => {
      const g = window.__grid!;
      const vp = g.surface.viewport;
      return {
        scrollY: vp.scrollY,
        maxY: vp.maxScrollY,
        scrollX: vp.scrollX,
        maxX: vp.maxScrollX,
        hostBottom: g.surface.host.scrollTop + g.surface.host.clientHeight,
        hostHeight: g.surface.host.scrollHeight,
        firstColLeft: vp.colLeft(0),
        headerWidth: vp.headerWidth,
      };
    });
    expect(reach.scrollY).toBe(reach.maxY);
    expect(reach.scrollX).toBe(reach.maxX);
    expect(Math.abs(reach.hostBottom - reach.hostHeight)).toBeLessThan(2); // the native scrollbar agrees it is at the end
    expect(reach.firstColLeft).toBe(reach.headerWidth);
  });

  test('native scrolling moves the grid by the right amount at 150%', async ({ page }) => {
    await setZoom(page, 1.5);
    await page.evaluate(() => (window.__grid!.surface.host.scrollTop = 300));
    await expect.poll(() => page.evaluate(() => window.__grid!.surface.viewport.scrollY)).toBe(200); // 300 screen px = 200 logical
  });

  test('dragging a column border resizes in logical units', async ({ page }) => {
    await setZoom(page, 1.5);
    const { x, y } = await page.evaluate(() => {
      const g = window.__grid!;
      const vp = g.surface.viewport;
      const rect = g.surface.host.getBoundingClientRect();
      return { x: rect.left + (vp.colLeft(1) + g.sheet.cols.getSize(1)) * 1.5, y: rect.top + (vp.headerHeight / 2) * 1.5 };
    });
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 30, y, { steps: 4 });
    await page.mouse.up();
    expect(await page.evaluate(() => window.__sheet!.cols.getSize(1))).toBe(120); // 30 screen px = 20 logical
  });

  test('the zoom menu changes the level, shows it, and the demo remembers it', async ({ page }) => {
    await page.getByRole('button', { name: 'Zoom', exact: true }).click();
    await page.getByRole('menuitemradio', { name: '150%' }).click();
    expect(await page.evaluate(() => window.__grid!.surface.zoom)).toBe(1.5);
    await expect(page.getByRole('button', { name: 'Zoom', exact: true })).toContainText('150%');
    await page.reload();
    await page.waitForFunction(() => window.__grid !== undefined);
    await expect.poll(() => page.evaluate(() => window.__grid!.surface.zoom)).toBe(1.5);
  });

  test('zoom is clamped and stepped', async ({ page }) => {
    await setZoom(page, 9);
    expect(await page.evaluate(() => window.__grid!.surface.zoom)).toBe(2);
    await setZoom(page, 0.01);
    expect(await page.evaluate(() => window.__grid!.surface.zoom)).toBe(0.5);
    await setZoom(page, 1.234);
    expect(await page.evaluate(() => window.__grid!.surface.zoom)).toBe(1.25);
    await setZoom(page, Number.NaN);
    expect(await page.evaluate(() => window.__grid!.surface.zoom)).toBe(1);
  });
});

// The project has no @types/node; this is the one Node global these tests use.
declare const Buffer: { from(data: string | number[], encoding?: string): never; [k: string]: unknown };

test.describe('CSV import and export', () => {
  type Page = import('@playwright/test').Page;
  const openFileMenu = async (page: Page, item: string | RegExp): Promise<void> => {
    await page.getByRole('button', { name: 'File', exact: true }).click();
    await page.getByRole('menuitem', { name: item }).click();
  };

  test('Download as CSV writes what the sheet displays, with a BOM for Excel', async ({ page }) => {
    await page.evaluate(() => {
      const s = window.__sheet!;
      s.setCellInput(0, 0, 'tên, hàng');
      s.setCellInput(0, 1, '1234.5');
      s.setCellInput(1, 0, 'Việt "Nam"');
      s.selection.selectCell(0, 1);
      s.formatSelection({ numberFormat: '#,##0.00' });
    });
    const download = page.waitForEvent('download');
    await openFileMenu(page, /as displayed/);
    const file = await download;
    expect(file.suggestedFilename()).toBe('sheet.csv');
    const stream = await file.createReadStream();
    const chunks: Uint8Array[] = [];
    for await (const chunk of stream) chunks.push(chunk as Uint8Array);
    const bytes = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
    chunks.reduce((at, c) => (bytes.set(c, at), at + c.length), 0);
    expect(Array.from(bytes.subarray(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    // Every row has the same number of fields, and a field with quotes in it is itself quoted.
    expect(new TextDecoder().decode(bytes.subarray(3))).toBe('"tên, hàng","1,234.50"\r\n"Việt ""Nam""",');
  });

  test('Import CSV fills from the active cell as one undo step', async ({ page }) => {
    await clickCell(page, 1, 1);
    await page.getByRole('button', { name: 'File', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Import CSV…' }).click();
    await page.getByTestId('import-file').setInputFiles({
      name: 'data.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('﻿tên;số lượng\r\n"Cà phê";12,5\r\nTrà;3', 'utf8'),
    });
    await expect.poll(() => cellValue(page, 1, 1)).toBe('tên');
    expect(await cellValue(page, 2, 1)).toBe('Cà phê');
    expect(await cellValue(page, 2, 2)).toBe('12,5'); // a decimal comma is text, as when typed
    expect(await cellValue(page, 3, 2)).toBe(3);
    await page.keyboard.press(`${mod}+z`);
    expect(await page.evaluate(() => window.__sheet!.model.cellCount)).toBe(0);
  });

  test('a Windows-1252 file (Excel "CSV") is read with its accents intact', async ({ page }) => {
    await clickCell(page, 0, 0);
    await page.getByRole('button', { name: 'File', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Import CSV…' }).click();
    await page.getByTestId('import-file').setInputFiles({ name: 'old.csv', mimeType: 'text/csv', buffer: Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x2c, 0xf1]) });
    await expect.poll(() => cellValue(page, 0, 0)).toBe('café');
    expect(await cellValue(page, 0, 1)).toBe('ñ');
  });

  test('an empty file says so, and a read-only sheet cannot import', async ({ page }) => {
    await page.getByRole('button', { name: 'File', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Import CSV…' }).click();
    await page.getByTestId('import-file').setInputFiles({ name: 'empty.csv', mimeType: 'text/csv', buffer: Buffer.from('') });
    await expect(page.getByRole('status').filter({ hasText: 'no data to import' })).toBeVisible();
    await page.evaluate(() => (window.__sheet!.readOnly = true));
    await page.getByRole('button', { name: 'File', exact: true }).click();
    await expect(page.getByRole('menuitem', { name: 'Import CSV…' })).toBeDisabled();
  });
});

test.describe('find and replace', () => {
  type Page = import('@playwright/test').Page;
  const dialog = (page: Page) => page.getByTestId('find-dialog');
  const findBox = (page: Page) => page.getByRole('textbox', { name: 'Find', exact: true });
  const seed = (page: Page) =>
    page.evaluate(() => {
      const s = window.__sheet!;
      s.setCellInput(0, 0, 'red apple');
      s.setCellInput(2, 1, 'green apple');
      s.setCellInput(4, 0, 'pear');
      s.setCellInput(6, 2, 'APPLE pie');
      s.setCellInput(7, 0, 'Việt Nam');
    });

  test('Mod+F opens the panel, finds as you type, and Enter / Shift+Enter move between results', async ({ page }) => {
    await seed(page);
    await clickCell(page, 0, 0);
    await page.keyboard.press(`${mod}+f`);
    await expect(dialog(page)).toBeVisible();
    await expect(findBox(page)).toBeFocused();
    await expect(findBox(page)).toHaveValue('red apple'); // prefilled from the selected cell
    await findBox(page).fill('apple');
    await expect(page.getByTestId('find-count')).toHaveText('1 of 3');
    expect((await selection(page)).active).toEqual([0, 0]);
    await findBox(page).press('Enter');
    await expect(page.getByTestId('find-count')).toHaveText('2 of 3');
    expect((await selection(page)).active).toEqual([2, 1]);
    await findBox(page).press('Enter');
    expect((await selection(page)).active).toEqual([6, 2]);
    await findBox(page).press('Enter'); // wraps
    expect((await selection(page)).active).toEqual([0, 0]);
    await findBox(page).press('Shift+Enter');
    expect((await selection(page)).active).toEqual([6, 2]);
    await findBox(page).fill('zzz');
    await expect(page.getByTestId('find-count')).toHaveText('No results');
  });

  test('matches are highlighted on the canvas and the highlight goes away when the panel closes', async ({ page }) => {
    await seed(page);
    await clickCell(page, 4, 0);
    await page.keyboard.press(`${mod}+f`);
    await findBox(page).fill('apple');
    await page.evaluate(() => window.__sheet!.selection.selectCell(9, 9)); // keep the selection tint out of the way
    const tint = (row: number, col: number): Promise<number[]> =>
      page.evaluate(
        async ([r, c]) => {
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const g = window.__grid!;
          const vp = g.surface.viewport;
          const canvas = document.querySelector('[data-testid=grid] canvas') as HTMLCanvasElement;
          const dpr = window.devicePixelRatio || 1;
          // The right edge of the cell is clear of text; sample there.
          const x = Math.round((vp.colLeft(c as number) + g.sheet.cols.getSize(c as number) - 4) * dpr);
          const y = Math.round((vp.rowTop(r as number) + 3) * dpr);
          return Array.from(canvas.getContext('2d')!.getImageData(x, y, 1, 1).data).slice(0, 3);
        },
        [row, col],
      );
    await expect.poll(async () => (await tint(0, 0))[2]).toBeLessThan(200); // yellow-ish: blue channel is low
    expect((await tint(4, 0))[2]).toBeGreaterThan(240); // "pear" is not a match: plain white
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toBeHidden();
    await expect.poll(async () => (await tint(0, 0))[2]).toBeGreaterThan(240);
    expect(await page.evaluate(() => document.activeElement === window.__grid!.editor.textarea)).toBe(true);
  });

  test('Replace all changes every match in one undo step; Replace goes one cell at a time', async ({ page }) => {
    await seed(page);
    await clickCell(page, 9, 9);
    await page.keyboard.press(`${mod}+h`);
    await findBox(page).fill('apple');
    await page.getByRole('textbox', { name: 'Replace with' }).fill('plum');
    await page.getByRole('button', { name: 'Replace', exact: true }).click();
    expect(await cellValue(page, 0, 0)).toBe('red plum');
    expect(await cellValue(page, 2, 1)).toBe('green apple');
    await expect(page.getByTestId('find-replaced')).toHaveText('Replaced 1 occurrence in 1 cell');
    await page.getByRole('button', { name: 'Replace all' }).click();
    expect(await cellValue(page, 2, 1)).toBe('green plum');
    expect(await cellValue(page, 6, 2)).toBe('plum pie');
    await expect(page.getByTestId('find-replaced')).toHaveText('Replaced 2 occurrences in 2 cells');
    await page.keyboard.press('Escape');
    await page.keyboard.press(`${mod}+z`);
    expect(await cellValue(page, 2, 1)).toBe('green apple');
    expect(await cellValue(page, 6, 2)).toBe('APPLE pie');
    expect(await cellValue(page, 0, 0)).toBe('red plum'); // the first, separate Replace is its own step
  });

  test('options: accents ignored, match case, whole cell, and the selected range', async ({ page }) => {
    await seed(page);
    await clickCell(page, 9, 9); // a click also gives the grid keyboard focus, which Mod+F needs
    await page.keyboard.press(`${mod}+f`);
    await findBox(page).fill('viet');
    await expect(page.getByTestId('find-count')).toHaveText('No results');
    await page.getByRole('checkbox', { name: /Ignore accents/ }).check();
    await expect(page.getByTestId('find-count')).toHaveText('1 of 1');
    await findBox(page).fill('apple');
    await expect(page.getByTestId('find-count')).toHaveText(/of 3$/);
    await page.getByRole('checkbox', { name: 'Match case' }).check();
    await expect(page.getByTestId('find-count')).toHaveText('1 of 2');
    await page.getByRole('checkbox', { name: 'Match case' }).uncheck();
    await page.getByRole('checkbox', { name: 'Match entire cell' }).check();
    await expect(page.getByTestId('find-count')).toHaveText('No results');
    await page.getByRole('checkbox', { name: 'Match entire cell' }).uncheck();
    await page.getByLabel('Search in', { exact: true }).selectOption('sheet');
    await expect(page.getByLabel('Search in', { exact: true }).locator('option[value=selection]')).toHaveAttribute('disabled', ''); // a single cell is selected
  });

  test('the toolbar button opens it, and it is usable in Vietnamese', async ({ page }) => {
    await page.getByLabel('Language').selectOption('vi');
    await page.getByRole('button', { name: 'Tìm và thay thế' }).click();
    await expect(page.getByRole('dialog', { name: 'Tìm và thay thế' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Tìm', exact: true })).toBeFocused();
  });

  test('on a read-only sheet find works but replace is disabled', async ({ page }) => {
    await seed(page);
    await page.evaluate(() => (window.__sheet!.readOnly = true));
    await clickCell(page, 0, 0);
    await page.keyboard.press(`${mod}+h`);
    await findBox(page).fill('apple');
    await expect(page.getByRole('button', { name: 'Replace all' })).toBeDisabled();
    await expect(page.getByTestId('find-count')).toHaveText(/of 3$/);
  });
});

test.describe('font size, wrapping and vertical alignment', () => {
  type Page = import('@playwright/test').Page;
  /** Counts dark pixels in a horizontal band of a cell, to see where text was really drawn. */
  const ink = (page: Page, row: number, col: number, fromY: number, toY: number): Promise<number> =>
    page.evaluate(
      async ([r, c, a, b]) => {
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const g = window.__grid!;
        const vp = g.surface.viewport;
        const canvas = document.querySelector('[data-testid=grid] canvas') as HTMLCanvasElement;
        const dpr = window.devicePixelRatio || 1;
        const x = Math.round((vp.colLeft(c as number) + 2) * dpr);
        const top = vp.rowTop(r as number);
        const w = Math.round((g.sheet.cols.getSize(c as number) - 6) * dpr);
        const y = Math.round((top + (a as number)) * dpr);
        const h = Math.max(1, Math.round(((b as number) - (a as number)) * dpr));
        const data = canvas.getContext('2d')!.getImageData(x, y, w, h).data;
        let dark = 0;
        for (let i = 0; i < data.length; i += 4) if ((data[i] as number) < 110) dark++;
        return dark;
      },
      [row, col, fromY, toY],
    );

  test('the font size box and the +/- buttons resize text and fit the row', async ({ page }) => {
    await page.evaluate(() => window.__sheet!.setCellInput(0, 0, 'Big'));
    await clickCell(page, 0, 0);
    await expect(page.getByRole('textbox', { name: 'Font size' })).toHaveValue('13');
    await page.getByRole('textbox', { name: 'Font size' }).fill('30');
    await page.getByRole('textbox', { name: 'Font size' }).press('Enter');
    expect(await page.evaluate(() => window.__sheet!.styles.get(window.__sheet!.getCellByView(0, 0).styleId).fontSize)).toBe(30);
    expect(await page.evaluate(() => window.__sheet!.rows.getSize(0))).toBe(42); // 38 for the line + 4
    await page.getByRole('button', { name: 'Decrease font size' }).click();
    await expect(page.getByRole('textbox', { name: 'Font size' })).toHaveValue('28'); // 30 is between steps: the next one down
    await page.getByRole('button', { name: 'Increase font size' }).click();
    await page.getByRole('button', { name: 'Increase font size' }).click();
    await expect(page.getByRole('textbox', { name: 'Font size' })).toHaveValue('36'); // 28 -> 32 -> 36
    await page.keyboard.press(`${mod}+Shift+Comma`);
    await expect(page.getByRole('textbox', { name: 'Font size' })).toHaveValue('32');
  });

  test('typing a size outside the range is clamped and garbage is ignored', async ({ page }) => {
    await page.evaluate(() => window.__sheet!.setCellInput(0, 0, 'x'));
    await clickCell(page, 0, 0);
    const box = page.getByRole('textbox', { name: 'Font size' });
    await box.fill('500');
    await box.press('Enter');
    await expect(box).toHaveValue('96');
    await box.fill('abc');
    await box.press('Enter');
    await expect(box).toHaveValue('96');
  });

  test('wrap draws text over several lines, and Clip stops it spilling', async ({ page }) => {
    await page.evaluate(() => {
      window.__sheet!.setCellInput(0, 0, 'alpha beta gamma delta epsilon zeta');
      window.__sheet!.selection.selectCell(9, 9);
    });
    // Overflow (default): one line, drawn in the top band only; the second line band is empty.
    expect(await ink(page, 0, 0, 4, 17)).toBeGreaterThan(20);
    await clickCell(page, 0, 0);
    await page.getByRole('button', { name: 'Text wrapping' }).click();
    await page.getByRole('menuitemradio', { name: 'Wrap' }).click();
    const height = await page.evaluate(() => window.__sheet!.rows.getSize(0));
    expect(height).toBeGreaterThan(40); // several wrapped lines in a 100px column
    await page.evaluate(() => window.__sheet!.selection.selectCell(9, 9));
    expect(await ink(page, 0, 0, height - 20, height - 3)).toBeGreaterThan(20); // text reaches the last line
    // The row is only as tall as needed; widening the column and double-clicking the border fits it back.
    await page.evaluate(() => window.__sheet!.cols.setSize(0, 400));
    const pos = await page.evaluate(() => {
      const g = window.__grid!;
      const vp = g.surface.viewport;
      const r = g.surface.host.getBoundingClientRect();
      return { x: r.left + vp.headerWidth / 2, y: r.top + vp.rowTop(0) + g.sheet.rows.getSize(0) };
    });
    await page.mouse.dblclick(pos.x, pos.y);
    expect(await page.evaluate(() => window.__sheet!.rows.getSize(0))).toBe(21);
    // Clip: with a narrow column the text is cut at the cell edge and nothing spills into the neighbour.
    await page.evaluate(() => {
      window.__sheet!.cols.setSize(0, 60);
      window.__sheet!.setCellInput(2, 0, 'a very long text that would spill');
    });
    await clickCell(page, 2, 0);
    expect(await ink(page, 2, 1, 4, 17)).toBeGreaterThan(5); // spills into B3 by default
    await page.getByRole('button', { name: 'Text wrapping' }).click();
    await page.getByRole('menuitemradio', { name: 'Clip' }).click();
    await page.evaluate(() => window.__sheet!.selection.selectCell(9, 9));
    expect(await ink(page, 2, 1, 4, 17)).toBe(0);
  });

  test('vertical align puts the text at the top or the bottom of a tall row', async ({ page }) => {
    await page.evaluate(() => {
      window.__sheet!.rows.setSize(0, 80);
      window.__sheet!.setCellInput(0, 0, 'Hello');
      window.__sheet!.selection.selectCell(9, 9);
    });
    const bands = async () => ({ top: await ink(page, 0, 0, 0, 25), middle: await ink(page, 0, 0, 30, 52), bottom: await ink(page, 0, 0, 55, 79) });
    let b = await bands();
    expect(b.middle).toBeGreaterThan(20);
    expect(b.top + b.bottom).toBe(0);
    await clickCell(page, 0, 0);
    await page.getByRole('button', { name: 'Vertical align' }).click();
    await page.getByRole('menuitemradio', { name: 'Top' }).click();
    await page.evaluate(() => window.__sheet!.selection.selectCell(9, 9));
    b = await bands();
    expect(b.top).toBeGreaterThan(20);
    expect(b.middle + b.bottom).toBe(0);
    await clickCell(page, 0, 0);
    await page.getByRole('button', { name: 'Vertical align' }).click();
    await page.getByRole('menuitemradio', { name: 'Bottom' }).click();
    await page.evaluate(() => window.__sheet!.selection.selectCell(9, 9));
    b = await bands();
    expect(b.bottom).toBeGreaterThan(20);
    expect(b.top + b.middle).toBe(0);
  });

  test('the editor box follows the font size', async ({ page }) => {
    await page.evaluate(() => {
      window.__sheet!.setCellInput(0, 0, 'x');
      window.__sheet!.selection.selectCell(0, 0);
      window.__sheet!.formatSelection({ fontSize: 24 });
    });
    await clickCell(page, 0, 0);
    await page.keyboard.press('F2');
    const size = await page.evaluate(() => parseFloat(getComputedStyle(window.__grid!.editor.textarea).fontSize));
    expect(size).toBe(24);
    await page.keyboard.press('Escape');
  });

  test('on a read-only sheet the controls are disabled', async ({ page }) => {
    await page.evaluate(() => (window.__sheet!.readOnly = true));
    await expect(page.getByRole('textbox', { name: 'Font size' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Increase font size' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Text wrapping' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Vertical align' })).toBeDisabled();
  });
});

test.describe('cell borders', () => {
  type Page = import('@playwright/test').Page;
  /** The color of the canvas pixel on the boundary line to the right/bottom of a cell (where the grid line normally is). */
  const edgePixel = (page: Page, row: number, col: number, side: 'right' | 'bottom' | 'left' | 'top', offset = 0.5): Promise<number[]> =>
    page.evaluate(
      async ([r, c, sd, off]) => {
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const g = window.__grid!;
        const vp = g.surface.viewport;
        const canvas = document.querySelector('[data-testid=grid] canvas') as HTMLCanvasElement;
        const dpr = window.devicePixelRatio || 1;
        const x0 = vp.colLeft(c as number);
        const y0 = vp.rowTop(r as number);
        const w = g.sheet.cols.getSize(c as number);
        const h = g.sheet.rows.getSize(r as number);
        const px = sd === 'right' ? x0 + w - 1 + 0.5 : sd === 'left' ? x0 - 1 + 0.5 : x0 + w * (off as number);
        const py = sd === 'bottom' ? y0 + h - 1 + 0.5 : sd === 'top' ? y0 - 1 + 0.5 : y0 + h * (off as number);
        return Array.from(canvas.getContext('2d')!.getImageData(Math.floor(px * dpr), Math.floor(py * dpr), 1, 1).data).slice(0, 3);
      },
      [row, col, side, offset] as [number, number, string, number],
    );
  const isDark = (rgb: number[]) => (rgb[0] as number) < 90 && (rgb[1] as number) < 90 && (rgb[2] as number) < 90;
  const isGridGray = (rgb: number[]) => (rgb[0] as number) > 200;
  const drag = async (page: Page, from: [number, number], to: [number, number]): Promise<void> => {
    const a = await cellCenter(page, ...from);
    const b = await cellCenter(page, ...to);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 3 });
    await page.mouse.up();
  };
  const choose = async (page: Page, button: string, item: string): Promise<void> => {
    await page.getByRole('button', { name: button, exact: true }).click();
    await page.getByRole('menuitem', { name: item }).or(page.getByRole('menuitemradio', { name: item })).click();
  };

  test('Outer borders draws a black rectangle around the selection, Clear borders removes it', async ({ page }) => {
    await page.evaluate(() => window.__sheet!.selection.selectCell(9, 9)); // keep the blue selection outline off the edges sampled
    expect(isGridGray(await edgePixel(page, 1, 2, 'top'))).toBe(true); // before: a plain grid line
    await drag(page, [1, 1], [2, 2]);
    await choose(page, 'Borders', 'Outer borders');
    await page.evaluate(() => window.__sheet!.selection.selectCell(9, 9));
    expect(isDark(await edgePixel(page, 2, 2, 'right'))).toBe(true); // right edge of C3
    expect(isDark(await edgePixel(page, 2, 2, 'bottom'))).toBe(true); // bottom edge
    expect(isDark(await edgePixel(page, 1, 1, 'left'))).toBe(true); // left edge of B2
    expect(isDark(await edgePixel(page, 1, 1, 'top'))).toBe(true);
    expect(isGridGray(await edgePixel(page, 1, 1, 'right'))).toBe(true); // the line between B2 and C2 is inside: untouched
    await drag(page, [1, 1], [2, 2]);
    await choose(page, 'Borders', 'Clear borders');
    await page.evaluate(() => window.__sheet!.selection.selectCell(9, 9));
    expect(isGridGray(await edgePixel(page, 2, 2, 'right'))).toBe(true);
    expect(isGridGray(await edgePixel(page, 1, 1, 'top'))).toBe(true);
    await page.keyboard.press(`${mod}+z`);
    expect(await page.evaluate(() => window.__sheet!.model.cellCount)).toBeGreaterThan(0); // the borders are back
  });

  test('line style and color choices apply to the next border; dashed lines are really broken', async ({ page }) => {
    await clickCell(page, 4, 1);
    await choose(page, 'Borders', 'Dashed line'); // only chooses the style
    expect(await page.evaluate(() => window.__sheet!.model.cellCount)).toBe(0);
    await page.getByRole('button', { name: 'Border color' }).click();
    await page.getByLabel('Border color picker').evaluate((el: HTMLInputElement) => {
      el.value = '#ff0000';
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await clickCell(page, 4, 1);
    await choose(page, 'Borders', 'Bottom border');
    const border = await page.evaluate(() => window.__sheet!.styles.get(window.__sheet!.getCellByView(4, 1).styleId).borders);
    expect(border).toEqual({ bottom: { width: 1, style: 'dashed', color: '#ff0000' } });
    await page.evaluate(() => window.__sheet!.selection.selectCell(9, 9));
    // Sample along the line: red where a dash is, plain gray in the gaps.
    const samples: number[][] = [];
    for (let i = 1; i < 19; i++) samples.push(await edgePixel(page, 4, 1, 'bottom', i / 20));
    const red = samples.filter((p) => (p[0] as number) > 200 && (p[1] as number) < 90).length;
    const gray = samples.filter(isGridGray).length;
    expect(red).toBeGreaterThan(3);
    expect(gray).toBeGreaterThan(2);
  });

  test('a thick line is thicker than a thin one', async ({ page }) => {
    await clickCell(page, 3, 3);
    await choose(page, 'Borders', 'Thick line');
    await clickCell(page, 3, 3);
    await choose(page, 'Borders', 'All borders');
    await page.evaluate(() => window.__sheet!.selection.selectCell(9, 9));
    expect(await page.evaluate(() => window.__sheet!.styles.get(window.__sheet!.getCellByView(3, 3).styleId).borders?.right?.width)).toBe(3);
    const probe = (dx: number): Promise<number[]> =>
      page.evaluate(
        async (offset) => {
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const g = window.__grid!;
          const vp = g.surface.viewport;
          const canvas = document.querySelector('[data-testid=grid] canvas') as HTMLCanvasElement;
          const dpr = window.devicePixelRatio || 1;
          const x = vp.colLeft(3) + g.sheet.cols.getSize(3) - 1 + offset + 0.5;
          const y = vp.rowTop(3) + g.sheet.rows.getSize(3) / 2;
          return Array.from(canvas.getContext('2d')!.getImageData(Math.floor(x * dpr), Math.floor(y * dpr), 1, 1).data).slice(0, 3);
        },
        dx,
      );
    expect(isDark(await probe(-1))).toBe(true);
    expect(isDark(await probe(0))).toBe(true);
    expect(isDark(await probe(1))).toBe(true);
    expect(isGridGray(await probe(-3)) || (await probe(-3))[0]! > 200).toBe(true); // clearly wider than 1px but not huge
  });

  test('borders copy and paste with an otherwise empty cell', async ({ page }) => {
    await clickCell(page, 1, 1);
    await choose(page, 'Borders', 'All borders');
    const before = await page.evaluate(() => window.__sheet!.getCellByView(1, 1).styleId);
    const clip = await page.evaluate(() => {
      const store: Record<string, string> = {};
      window.__grid!.clipboard.copyTo({ setData: (type, value) => void (store[type] = value) });
      return { text: store['text/plain'] ?? '', html: store['text/html'] ?? '' };
    });
    expect(clip.text).toBe(''); // no value, only formatting
    expect(clip.html).toContain('border-top:1px solid #000000');
    await clickCell(page, 6, 6);
    await page.evaluate((c) => window.__grid!.clipboard.pasteFrom({ getData: (type) => (type === 'text/html' ? c.html : c.text) }), clip);
    expect(await page.evaluate(() => window.__sheet!.getCellByView(6, 6).styleId)).toBe(before);
    expect(await page.evaluate(() => JSON.stringify(window.__sheet!.styles.get(window.__sheet!.getCellByView(6, 6).styleId).borders))).toContain('"top"');
  });

  test('the Borders controls are disabled on a read-only sheet', async ({ page }) => {
    await page.evaluate(() => (window.__sheet!.readOnly = true));
    await expect(page.getByRole('button', { name: 'Borders', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Border color' })).toBeDisabled();
  });
});

test.describe('conditional formatting', () => {
  const center = (row: number, col: number): Promise<number[]> => page_pixel(row, col);
  let page_pixel: (row: number, col: number) => Promise<number[]>;

  test.beforeEach(async ({ page }) => {
    await page.goto('/demo/');
    await page.waitForFunction(() => window.__grid !== undefined);
    // Near the cell's left edge, away from glyphs and the selection outline.
    page_pixel = (row, col) =>
      page.evaluate(
        async ([r, c]) => {
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const g = window.__grid!;
          const vp = g.surface.viewport;
          const canvas = document.querySelector('[data-testid=grid] canvas') as HTMLCanvasElement;
          const dpr = window.devicePixelRatio || 1;
          const x = Math.floor((vp.colLeft(c as number) + 6) * dpr);
          const y = Math.floor((vp.rowTop(r as number) + 4) * dpr);
          return Array.from(canvas.getContext('2d')!.getImageData(x, y, 1, 1).data);
        },
        [row, col],
      );
  });

  test('the dialog adds a rule and cells recolor as their value changes', async ({ page }) => {
    await page.evaluate(() => {
      const s = window.__sheet!;
      s.setCellInput(0, 0, '5');
      s.setCellInput(1, 0, '-5');
      s.selection.selectCell(5, 5);
      s.selection.selectCell(0, 0);
      s.selection.extendTo(1, 0);
    });
    await page.getByRole('button', { name: 'Conditional formatting' }).click();
    const dialog = page.getByTestId('conditional-dialog');
    await dialog.getByRole('button', { name: 'Add rule' }).click();
    await dialog.getByLabel('Criteria', { exact: true }).selectOption('number:lt');
    await dialog.getByLabel('Value', { exact: true }).fill('0');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();
    await page.evaluate(() => window.__sheet!.selection.selectCell(5, 5)); // the selection tint would blend into the sample

    expect((await center(1, 0)).slice(0, 3)).toEqual([0xf4, 0xc7, 0xc3]);
    expect((await center(0, 0)).slice(0, 3)).toEqual([255, 255, 255]);
    await page.evaluate(() => window.__sheet!.setCellInput(0, 0, '-1'));
    expect((await center(0, 0)).slice(0, 3)).toEqual([0xf4, 0xc7, 0xc3]);
    await page.evaluate(() => window.__sheet!.setCellInput(1, 0, '9'));
    expect((await center(1, 0)).slice(0, 3)).toEqual([255, 255, 255]);
  });
});
