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
  async function copyEvent(page: import('@playwright/test').Page): Promise<{ text: string; html: string }> {
    return page.evaluate(() => {
      const dt = new DataTransfer();
      window.__grid!.editor.textarea.dispatchEvent(new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true }));
      return { text: dt.getData('text/plain'), html: dt.getData('text/html') };
    });
  }

  async function pasteEvent(page: import('@playwright/test').Page, data: { text?: string; html?: string }): Promise<void> {
    await page.evaluate((d) => {
      const dt = new DataTransfer();
      if (d.text !== undefined) dt.setData('text/plain', d.text);
      if (d.html !== undefined) dt.setData('text/html', d.html);
      window.__grid!.editor.textarea.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
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
      const dt = new DataTransfer();
      window.__grid!.editor.textarea.dispatchEvent(new ClipboardEvent('cut', { clipboardData: dt, bubbles: true, cancelable: true }));
      return dt.getData('text/plain');
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
    await pasteEvent(page, { text: 'zzz' }); // editing: the controller leaves it to the browser
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
