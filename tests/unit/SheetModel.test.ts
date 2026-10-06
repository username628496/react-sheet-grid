import { describe, expect, it } from 'vitest';
import { SheetModel, MAX_COLS, MAX_ROWS } from '../../src/core/model/SheetModel';

describe('SheetModel', () => {
  it('returns an empty cell for unset coordinates', () => {
    const model = new SheetModel();
    expect(model.getCell(5, 5)).toEqual({ value: null, styleId: 0 });
    expect(model.hasCell(5, 5)).toBe(false);
    expect(model.cellCount).toBe(0);
  });

  it('stores and reads values of each type', () => {
    const model = new SheetModel();
    model.setCell(0, 0, { value: 'abc', styleId: 0 });
    model.setCell(0, 1, { value: 42, styleId: 0 });
    model.setCell(0, 2, { value: false, styleId: 0 });
    expect(model.getCell(0, 0).value).toBe('abc');
    expect(model.getCell(0, 1).value).toBe(42);
    expect(model.getCell(0, 2).value).toBe(false);
    expect(model.cellCount).toBe(3);
  });

  it('does not confuse (row, col) with (col, row)', () => {
    const model = new SheetModel();
    model.setCell(1, 2, { value: 'x', styleId: 0 });
    expect(model.getCell(2, 1).value).toBeNull();
  });

  it('removes the entry when a cell becomes empty and unstyled', () => {
    const model = new SheetModel();
    model.setCell(3, 3, { value: 1, styleId: 0 });
    model.setCell(3, 3, { value: null, styleId: 0 });
    expect(model.cellCount).toBe(0);
  });

  it('keeps a cell that has a style but no value', () => {
    const model = new SheetModel();
    model.setCell(3, 3, { value: null, styleId: 7 });
    expect(model.cellCount).toBe(1);
    expect(model.getCell(3, 3).styleId).toBe(7);
  });

  it('accepts the last valid coordinate and rejects out-of-bounds ones', () => {
    const model = new SheetModel();
    model.setCell(MAX_ROWS - 1, MAX_COLS - 1, { value: 1, styleId: 0 });
    expect(model.getCell(MAX_ROWS - 1, MAX_COLS - 1).value).toBe(1);
    expect(() => model.setCell(MAX_ROWS, 0, { value: 1, styleId: 0 })).toThrow(RangeError);
    expect(() => model.setCell(0, MAX_COLS, { value: 1, styleId: 0 })).toThrow(RangeError);
    expect(() => model.setCell(-1, 0, { value: 1, styleId: 0 })).toThrow(RangeError);
    expect(() => model.setCell(0.5, 0, { value: 1, styleId: 0 })).toThrow(RangeError);
  });

  it('visits only stored cells within a range (both iteration strategies)', () => {
    const model = new SheetModel();
    model.setCell(1, 1, { value: 'a', styleId: 0 });
    model.setCell(2, 2, { value: 'b', styleId: 0 });
    model.setCell(9, 9, { value: 'out', styleId: 0 });

    const small = [] as string[];
    model.forEachCellInRange({ startRow: 0, startCol: 0, endRow: 2, endCol: 2 }, (r, c, cell) => {
      small.push(`${r},${c}=${String(cell.value)}`);
    });
    expect(small.sort()).toEqual(['1,1=a', '2,2=b']);

    // Huge area forces the scan-stored-cells path.
    const huge = [] as string[];
    model.forEachCellInRange(
      { startRow: 0, startCol: 0, endRow: MAX_ROWS - 1, endCol: MAX_COLS - 1 },
      (r, c) => huge.push(`${r},${c}`),
    );
    expect(huge.sort()).toEqual(['1,1', '2,2', '9,9']);
  });

  it('computes the used range', () => {
    const model = new SheetModel();
    expect(model.getUsedRange()).toBeNull();
    model.setCell(4, 2, { value: 1, styleId: 0 });
    model.setCell(10, 7, { value: 1, styleId: 0 });
    expect(model.getUsedRange()).toEqual({ startRow: 4, startCol: 2, endRow: 10, endCol: 7 });
  });

  it('stays sparse with a million rows touched only at the edges', () => {
    const model = new SheetModel();
    model.setCell(0, 0, { value: 1, styleId: 0 });
    model.setCell(999_999, 99, { value: 2, styleId: 0 });
    expect(model.cellCount).toBe(2);
    expect(model.getCell(999_999, 99).value).toBe(2);
  });
});
