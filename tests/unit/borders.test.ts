import { describe, expect, it } from 'vitest';
import { type Border, presetSides, withBorder } from '../../src/core/model/borders';
import { deserializeSheet, serializeSheet } from '../../src/core/snapshot';
import { MAX_BORDER_CELLS, Spreadsheet } from '../../src/core/Spreadsheet';
import { addr, makeSheet } from './formula/helpers';

const sidesOf = (s: Spreadsheet, a1: string): string[] => {
  const [r, c] = addr(a1);
  const borders = s.styles.get(s.getCellByView(r, c).styleId).borders ?? {};
  return (['top', 'right', 'bottom', 'left'] as const).filter((side) => borders[side] !== undefined);
};

function select(s: Spreadsheet, from: string, to: string): void {
  s.selection.selectCell(...addr(from));
  s.selection.extendTo(...addr(to));
}

describe('presetSides (geometry)', () => {
  // A 3 x 3 block at rows 0..2, cols 0..2.
  const at = (preset: Parameters<typeof presetSides>[0], r: number, c: number) => presetSides(preset, r, c, 0, 0, 2, 2).sort();
  it('outer touches only the perimeter, each corner two sides', () => {
    expect(at('outer', 0, 0)).toEqual(['left', 'top']);
    expect(at('outer', 0, 1)).toEqual(['top']);
    expect(at('outer', 1, 1)).toEqual([]);
    expect(at('outer', 2, 2)).toEqual(['bottom', 'right']);
  });
  it('inner / horizontal / vertical touch only the lines between cells', () => {
    expect(at('inner', 1, 1)).toEqual(['bottom', 'left', 'right', 'top']);
    expect(at('inner', 0, 0)).toEqual(['bottom', 'right']);
    expect(at('horizontal', 1, 1)).toEqual(['bottom', 'top']);
    expect(at('horizontal', 0, 0)).toEqual(['bottom']);
    expect(at('vertical', 1, 1)).toEqual(['left', 'right']);
    expect(at('vertical', 2, 2)).toEqual(['left']);
  });
  it('single sides only on their edge; a 1x1 block counts as every edge', () => {
    expect(at('top', 0, 1)).toEqual(['top']);
    expect(at('top', 1, 1)).toEqual([]);
    expect(at('left', 2, 0)).toEqual(['left']);
    expect(presetSides('outer', 5, 5, 5, 5, 5, 5).sort()).toEqual(['bottom', 'left', 'right', 'top']);
    expect(presetSides('inner', 5, 5, 5, 5, 5, 5)).toEqual([]);
  });
});

describe('withBorder', () => {
  const thin: Border = { width: 1, style: 'solid', color: '#000000' };
  it('adds, replaces and removes a side, always in the same key order', () => {
    const a = withBorder(undefined, 'left', thin);
    const b = withBorder(a, 'top', thin);
    expect(Object.keys(b ?? {})).toEqual(['top', 'left']);
    expect(Object.keys(withBorder(withBorder(undefined, 'top', thin), 'left', thin) ?? {})).toEqual(['top', 'left']); // other order, same result
    expect(withBorder(b, 'top', null)).toEqual({ left: thin });
    expect(withBorder(withBorder(undefined, 'top', thin), 'top', null)).toBeUndefined();
  });
});

describe('Spreadsheet.applyBorders', () => {
  it('all: every side of every selected cell', () => {
    const s = makeSheet();
    select(s, 'B2', 'C3');
    expect(s.applyBorders('all')).toBe(true);
    for (const a1 of ['B2', 'B3', 'C2', 'C3']) expect(sidesOf(s, a1)).toEqual(['top', 'right', 'bottom', 'left']);
    expect(sidesOf(s, 'A1')).toEqual([]);
    expect(sidesOf(s, 'D2')).toEqual([]);
  });

  it('outer, then inner: the rectangle edge and the lines inside, and never the cells outside', () => {
    const s = makeSheet();
    select(s, 'B2', 'D4');
    s.applyBorders('outer');
    expect(sidesOf(s, 'B2')).toEqual(['top', 'left']);
    expect(sidesOf(s, 'C2')).toEqual(['top']);
    expect(sidesOf(s, 'C3')).toEqual([]);
    expect(sidesOf(s, 'D4')).toEqual(['right', 'bottom']);
    expect(sidesOf(s, 'A2')).toEqual([]);
    s.applyBorders('inner');
    expect(sidesOf(s, 'C3')).toEqual(['top', 'right', 'bottom', 'left']);
    expect(sidesOf(s, 'B2')).toEqual(['top', 'right', 'bottom', 'left']); // its outer top/left plus inner bottom/right
  });

  it('a single side applies to the selection edge only', () => {
    const s = makeSheet();
    select(s, 'A1', 'C2');
    s.applyBorders('bottom', { width: 2, style: 'dashed', color: '#ff0000' });
    expect(sidesOf(s, 'A2')).toEqual(['bottom']);
    expect(sidesOf(s, 'C2')).toEqual(['bottom']);
    expect(sidesOf(s, 'A1')).toEqual([]);
    expect(s.styles.get(s.getCellByView(1, 0).styleId).borders?.bottom).toEqual({ width: 2, style: 'dashed', color: '#ff0000' });
  });

  it('keeps values, formulas and other formatting on the cells it touches', () => {
    const s = makeSheet({ A1: 5, B1: '=A1*2' });
    select(s, 'A1', 'B1');
    s.toggleStyle('bold');
    s.applyBorders('outer');
    expect(s.getCellByView(0, 0).value).toBe(5);
    expect(s.getEditText(0, 1)).toBe('=A1*2');
    expect(s.styles.get(s.getCellByView(0, 0).styleId).bold).toBe(true);
    expect(sidesOf(s, 'A1')).toEqual(['top', 'bottom', 'left']);
  });

  it('none removes the borders inside AND the touching side of the neighbours, and leaves the rest', () => {
    const s = makeSheet();
    select(s, 'A1', 'D4');
    s.applyBorders('all');
    select(s, 'B2', 'C3');
    s.applyBorders('none');
    expect(sidesOf(s, 'B2')).toEqual([]);
    expect(sidesOf(s, 'C3')).toEqual([]);
    expect(sidesOf(s, 'B1')).toEqual(['top', 'right', 'left']); // its bottom touched the cleared block
    expect(sidesOf(s, 'A2')).toEqual(['top', 'bottom', 'left']); // its right side touched it
    expect(sidesOf(s, 'D3')).toEqual(['top', 'right', 'bottom']);
    expect(sidesOf(s, 'C4')).toEqual(['right', 'bottom', 'left']);
    expect(sidesOf(s, 'A1')).toEqual(['top', 'right', 'bottom', 'left']); // untouched
  });

  it('is one undo step, and empty cells that only had borders disappear again', () => {
    const s = makeSheet();
    select(s, 'B2', 'C3');
    s.applyBorders('all');
    expect(s.model.cellCount).toBe(4);
    s.undo();
    expect(s.model.cellCount).toBe(0);
    s.redo();
    expect(s.model.cellCount).toBe(4);
    select(s, 'B2', 'C3');
    s.applyBorders('none');
    expect(s.model.cellCount).toBe(0); // cells holding only borders are removed, not left as empty shells
  });

  it('works in view coordinates when the view is sorted', () => {
    const s = makeSheet({ A1: 'b', A2: 'a' });
    s.sortByColumn(0, true);
    s.selection.selectCell(0, 0); // shows "a", which lives in data row 1
    s.applyBorders('top');
    s.clearSort();
    expect(sidesOf(s, 'A2')).toEqual(['top']);
    expect(sidesOf(s, 'A1')).toEqual([]);
  });

  it('is refused when read-only or when the range is too large, and nothing changes', () => {
    const s = makeSheet();
    select(s, 'A1', 'B2');
    s.readOnly = true;
    expect(s.applyBorders('all')).toBe(false);
    s.readOnly = false;
    expect(s.model.cellCount).toBe(0);
    const big = new Spreadsheet({ rowCount: 1_000_000, colCount: 10 });
    const notices: unknown[] = [];
    big.subscribeNotices((n) => notices.push(n));
    big.selection.selectCol(0);
    expect(big.applyBorders('all')).toBe(false);
    expect(notices).toEqual([{ code: 'formatTooLarge', cells: 1_000_000, limit: MAX_BORDER_CELLS }]);
    expect(big.applyBorders('left')).toBe(false); // the perimeter of a whole column is 2 x a million cells too
    big.selection.selectCell(0, 0);
    big.selection.extendTo(5, 5);
    expect(big.applyBorders('outer')).toBe(true);
  });

  it('clearing a whole-column selection only costs what is there', () => {
    const s = new Spreadsheet({ rowCount: 1_000_000, colCount: 10 });
    s.selection.selectCell(0, 0);
    s.selection.extendTo(2, 2);
    s.applyBorders('all');
    s.selection.selectCol(0);
    expect(s.applyBorders('none')).toBe(true);
    expect(sidesOf(s, 'A1')).toEqual([]);
    expect(sidesOf(s, 'B1')).toEqual(['top', 'right', 'bottom']); // the neighbour's left side went with it
  });

  it('survives a snapshot round trip and rejects junk borders', () => {
    const s = makeSheet();
    select(s, 'A1', 'B1');
    s.applyBorders('outer', { width: 3, style: 'dotted', color: '#123456' });
    const t = deserializeSheet(JSON.parse(JSON.stringify(serializeSheet(s))));
    expect(t.styles.get(t.getCellByView(0, 0).styleId).borders).toEqual(s.styles.get(s.getCellByView(0, 0).styleId).borders);
    const snapshot = JSON.parse(JSON.stringify(serializeSheet(s))) as { styles: Array<Record<string, unknown>> };
    snapshot.styles[1] = { borders: { top: { width: 9, style: 'solid', color: '#000' }, left: { width: 1, style: 'wavy', color: '#000' }, right: { width: 2, style: 'solid', color: '#abc' } } };
    const u = deserializeSheet(snapshot);
    expect(u.styles.get(1).borders).toEqual({ right: { width: 2, style: 'solid', color: '#abc' } });
  });

  it('equal borders share one style no matter how they were built', () => {
    const s = makeSheet();
    s.selection.selectCell(...addr('A1'));
    s.applyBorders('top');
    s.applyBorders('left');
    const first = s.getCellByView(0, 0).styleId;
    s.selection.selectCell(...addr('A2'));
    s.applyBorders('left');
    s.applyBorders('top');
    expect(s.getCellByView(1, 0).styleId).toBe(first);
  });
});
