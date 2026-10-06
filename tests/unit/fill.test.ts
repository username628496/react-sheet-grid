import { describe, expect, it } from 'vitest';
import type { Cell } from '../../src/core/model/Cell';
import { fillCells } from '../../src/core/fill';
import { Spreadsheet } from '../../src/core/Spreadsheet';
import { addr, makeSheet, set, value } from './formula/helpers';

const c = (value: Cell['value'], styleId = 0): Cell => ({ value, styleId });
const col = (...values: Cell['value'][]): Cell[][] => values.map((v) => [c(v)]);
const out = (m: Cell[][]): Array<Cell['value']> => m.map((row) => row[0]?.value ?? null);

describe('fillCells: numbers', () => {
  it('copies a single number', () => {
    expect(out(fillCells(col(5), 'down', 3))).toEqual([5, 5, 5]);
  });

  it('continues an arithmetic series', () => {
    expect(out(fillCells(col(1, 2), 'down', 3))).toEqual([3, 4, 5]);
    expect(out(fillCells(col(10, 20, 30), 'down', 2))).toEqual([40, 50]);
    expect(out(fillCells(col(5, 3), 'down', 3))).toEqual([1, -1, -3]);
  });

  it('avoids floating point noise', () => {
    expect(out(fillCells(col(0.1, 0.2), 'down', 2))).toEqual([0.3, 0.4]);
  });

  it('extends backwards when filling up', () => {
    expect(out(fillCells(col(3, 4), 'up', 3))).toEqual([2, 1, 0]);
  });

  it('follows a linear trend for non-constant steps', () => {
    const r = out(fillCells(col(1, 2, 4), 'down', 1));
    expect(r[0]).toBeCloseTo(5.3333, 3); // least squares: slope 1.5, intercept 0.8333
  });
});

describe('fillCells: text with numbers', () => {
  it('increments a single "Item 1"', () => {
    expect(out(fillCells(col('Item 1'), 'down', 3))).toEqual(['Item 2', 'Item 3', 'Item 4']);
  });

  it('continues a step from two cells', () => {
    expect(out(fillCells(col('Q1', 'Q3'), 'down', 2))).toEqual(['Q5', 'Q7']);
  });

  it('keeps zero padding', () => {
    expect(out(fillCells(col('A001', 'A002'), 'down', 2))).toEqual(['A003', 'A004']);
  });

  it('goes backwards when filling up and stops at negatives', () => {
    expect(out(fillCells(col('Row 3'), 'up', 2))).toEqual(['Row 2', 'Row 1']);
    expect(out(fillCells(col('Row 1'), 'up', 3))).toEqual(['Row 0', 'Row 1', 'Row 1']); // -1 is not a valid label: cell repeats
  });

  it('does not make a series from mixed prefixes or plain text', () => {
    expect(out(fillCells(col('a1', 'b2'), 'down', 3))).toEqual(['a1', 'b2', 'a1']);
    expect(out(fillCells(col('x', 'y'), 'down', 3))).toEqual(['x', 'y', 'x']);
  });
});

describe('fillCells: repeating', () => {
  it('cycles through the source cells', () => {
    expect(out(fillCells(col('a', 'b', 'c'), 'down', 5))).toEqual(['a', 'b', 'c', 'a', 'b']);
  });

  it('cycles aligned to the source when filling up', () => {
    expect(out(fillCells(col('a', 'b', 'c'), 'up', 4))).toEqual(['c', 'b', 'a', 'c']);
  });

  it('copies styles with the values', () => {
    const result = fillCells([[c('x', 4)], [c('y', 5)]], 'down', 3);
    expect(result.map((r) => r[0]?.styleId)).toEqual([4, 5, 4]);
  });

  it('carries the style of the repeated cell onto a series', () => {
    const result = fillCells([[c(1, 9)], [c(2, 9)]], 'down', 2);
    expect(result.map((r) => r[0]?.styleId)).toEqual([9, 9]);
  });

  it('fills each column of a multi-column source independently', () => {
    const src = [[c(1), c('a')], [c(2), c('b')]];
    const result = fillCells(src, 'down', 2);
    expect(result.map((r) => r.map((x) => x.value))).toEqual([[3, 'a'], [4, 'b']]);
  });

  it('fills horizontally per row', () => {
    const src = [[c(1), c(2)], [c('x'), c('y')]];
    const result = fillCells(src, 'right', 2);
    expect(result.map((line) => line.map((x) => x.value))).toEqual([[3, 'x'], [4, 'y']]);
    const left = fillCells(src, 'left', 1);
    expect(left.map((line) => line.map((x) => x.value))).toEqual([[0, 'y']]);
  });
});

describe('Spreadsheet.fillRange', () => {
  it('fills down as one undo step and selects the result', () => {
    const s = makeSheet({ A1: 1, A2: 2 });
    const range = s.fillRange({ startRow: 0, startCol: 0, endRow: 1, endCol: 0 }, 'down', 3);
    expect([2, 3, 4].map((r) => s.getCellByView(r, 0).value)).toEqual([3, 4, 5]);
    expect(range).toEqual({ startRow: 0, endRow: 4, startCol: 0, endCol: 0 });
    expect(s.selection.primary).toEqual(range);
    s.undo();
    expect(s.model.hasCell(2, 0)).toBe(false);
    expect(s.getCellByView(1, 0).value).toBe(2);
    expect(s.history.canUndo).toBe(true); // only the two inputs remain
  });

  it('fills up and left', () => {
    const s = makeSheet({ C3: 10, D3: 20 });
    s.fillRange({ startRow: 2, startCol: 2, endRow: 2, endCol: 3 }, 'left', 2);
    expect(s.getCellByView(2, 1).value).toBe(0);
    expect(s.getCellByView(2, 0).value).toBe(-10);
    const t = makeSheet({ A5: 'Item 3' });
    t.fillRange({ startRow: 4, startCol: 0, endRow: 4, endCol: 0 }, 'up', 2);
    expect(t.getCellByView(3, 0).value).toBe('Item 2');
    expect(t.getCellByView(2, 0).value).toBe('Item 1');
  });

  it('stops at the edge of the sheet', () => {
    const s = new Spreadsheet({ rowCount: 4, colCount: 2 });
    s.setCellInput(2, 0, '1');
    s.setCellInput(3, 0, '2');
    expect(s.fillRange({ startRow: 2, startCol: 0, endRow: 3, endCol: 0 }, 'down', 5)).toBeNull();
    s.setCellInput(0, 0, '1');
    const r = s.fillRange({ startRow: 0, startCol: 0, endRow: 0, endCol: 0 }, 'down', 10);
    expect(r?.endRow).toBe(3);
  });

  it('fills formulas with relative references and absolute ones fixed', () => {
    const s = makeSheet({ A1: 1, A2: 2, A3: 3, B1: '=A1*2+$A$1' });
    s.fillRange({ startRow: 0, startCol: 1, endRow: 0, endCol: 1 }, 'down', 2);
    expect(s.getEditText(...addr('B2'))).toBe('=A2*2+$A$1');
    expect(value(s, 'B2')).toBe(5);
    expect(value(s, 'B3')).toBe(7);
    set(s, 'A1', 10); // dependents of the filled cells update
    expect(value(s, 'B3')).toBe(3 * 2 + 10);
  });

  it('ignores a zero count', () => {
    const s = makeSheet({ A1: 1 });
    expect(s.fillRange({ startRow: 0, startCol: 0, endRow: 0, endCol: 0 }, 'down', 0)).toBeNull();
  });
});
