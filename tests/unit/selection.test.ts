import { describe, expect, it, vi } from 'vitest';
import { SelectionModel } from '../../src/core/selection/SelectionModel';

const bounds = { rowCount: 100, colCount: 10 };

describe('SelectionModel', () => {
  it('starts on A1', () => {
    const sel = new SelectionModel(bounds);
    expect(sel.primary).toEqual({ startRow: 0, startCol: 0, endRow: 0, endCol: 0 });
    expect(sel.isSingleCell()).toBe(true);
  });

  it('selects and clamps a cell', () => {
    const sel = new SelectionModel(bounds);
    sel.selectCell(5, 3);
    expect([sel.activeRow, sel.activeCol]).toEqual([5, 3]);
    sel.selectCell(500, -4);
    expect([sel.activeRow, sel.activeCol]).toEqual([99, 0]);
  });

  it('extends from the anchor in any direction and normalizes the range', () => {
    const sel = new SelectionModel(bounds);
    sel.selectCell(5, 5);
    sel.extendTo(2, 8);
    expect(sel.primary).toEqual({ startRow: 2, startCol: 5, endRow: 5, endCol: 8 });
    expect([sel.activeRow, sel.activeCol]).toEqual([5, 5]);
    sel.extendTo(7, 1);
    expect(sel.primary).toEqual({ startRow: 5, startCol: 1, endRow: 7, endCol: 5 });
  });

  it('adds ranges with ctrl and keeps the earlier ones', () => {
    const sel = new SelectionModel(bounds);
    sel.selectCell(1, 1);
    sel.addCell(4, 4);
    sel.extendTo(5, 5);
    expect(sel.allRanges).toHaveLength(2);
    expect(sel.contains(1, 1)).toBe(true);
    expect(sel.contains(5, 5)).toBe(true);
    expect(sel.contains(3, 3)).toBe(false);
  });

  it('selects whole rows and columns, also extending', () => {
    const sel = new SelectionModel(bounds);
    sel.selectRow(3);
    expect(sel.primary).toEqual({ startRow: 3, startCol: 0, endRow: 3, endCol: 9 });
    sel.selectRow(6, true);
    expect(sel.primary).toEqual({ startRow: 3, startCol: 0, endRow: 6, endCol: 9 });
    sel.selectCol(2);
    expect(sel.primary).toEqual({ startRow: 0, startCol: 2, endRow: 99, endCol: 2 });
    sel.selectCol(4, true);
    expect(sel.primary).toEqual({ startRow: 0, startCol: 2, endRow: 99, endCol: 4 });
    expect(sel.isColSelected(3)).toBe(true);
    expect(sel.isColSelected(5)).toBe(false);
    expect(sel.isRowSelected(50)).toBe(true);
  });

  it('selects everything', () => {
    const sel = new SelectionModel(bounds);
    sel.selectAll();
    expect(sel.primary).toEqual({ startRow: 0, startCol: 0, endRow: 99, endCol: 9 });
  });

  it('clamps after the grid shrinks', () => {
    const small = { rowCount: 100, colCount: 10 };
    const sel = new SelectionModel(small);
    sel.selectCell(90, 9);
    (small as { rowCount: number }).rowCount = 10;
    sel.clamp();
    expect(sel.activeRow).toBe(9);
  });

  it('notifies on change', () => {
    const spy = vi.fn();
    const sel = new SelectionModel(bounds, spy);
    sel.selectCell(1, 1);
    sel.extendTo(2, 2);
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
