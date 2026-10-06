import type { Page } from '@playwright/test';

export async function openEmptyGrid(page: Page): Promise<void> {
  await page.goto('/demo/?mode=empty');
  await page.waitForFunction(() => window.__grid !== undefined);
}

/** Screen position (page coordinates) of the center of a view cell. */
export async function cellCenter(page: Page, row: number, col: number): Promise<{ x: number; y: number }> {
  return page.evaluate(
    ([r, c]) => {
      const grid = window.__grid!;
      const vp = grid.surface.viewport;
      const rect = grid.surface.host.getBoundingClientRect();
      const w = grid.sheet.cols.getSize(c as number);
      const h = grid.sheet.rows.getSize(r as number);
      return { x: rect.left + vp.colLeft(c as number) + w / 2, y: rect.top + vp.rowTop(r as number) + h / 2 };
    },
    [row, col],
  );
}

export async function clickCell(page: Page, row: number, col: number, options?: { modifiers?: Array<'Shift' | 'Control' | 'Meta'> }): Promise<void> {
  const { x, y } = await cellCenter(page, row, col);
  // mouse.click has no modifiers option; hold the keys down around it instead.
  const keys = options?.modifiers ?? [];
  for (const k of keys) await page.keyboard.down(k);
  await page.mouse.click(x, y);
  for (const k of keys) await page.keyboard.up(k);
}

export async function selection(page: Page) {
  return page.evaluate(() => {
    const s = window.__sheet!.selection;
    return { active: [s.activeRow, s.activeCol], range: { ...s.primary } };
  });
}

export async function cellValue(page: Page, row: number, col: number): Promise<unknown> {
  return page.evaluate(([r, c]) => window.__sheet!.getCellByView(r as number, c as number).value, [row, col]);
}

/** The Mod key as the grid itself resolves it (Meta on Mac, Control elsewhere). */
export async function modKey(page: Page): Promise<'Meta' | 'Control'> {
  return (await page.evaluate(() => /Mac|iPhone|iPad/.test(navigator.platform))) ? 'Meta' : 'Control';
}
