import { describe, expect, it } from 'vitest';
import type { Cell } from '../../src/core/model/Cell';
import { Spreadsheet } from '../../src/core/Spreadsheet';

function fill(sheet: Spreadsheet, rows: Array<Array<string | number>>): void {
  rows.forEach((row, r) => row.forEach((v, c) => sheet.model.setCell(r, c, { value: v, styleId: 0 })));
}

describe('readCells', () => {
  it('reads a rectangular block including empty cells', () => {
    const sheet = new Spreadsheet();
    fill(sheet, [[1, 2], [3, 4]]);
    const { rows, cols, cells } = sheet.readCells({ startRow: 0, startCol: 0, endRow: 1, endCol: 2 });
    expect([rows, cols]).toEqual([2, 3]);
    expect(cells[0]?.map((c) => c.value)).toEqual([1, 2, null]);
  });

  it('does not build a huge matrix for a whole-column selection', () => {
    const sheet = new Spreadsheet({ rowCount: 1_000_000, colCount: 10 });
    fill(sheet, [[1], [2], [3]]);
    const { rows } = sheet.readCells({ startRow: 0, startCol: 0, endRow: 999_999, endCol: 0 });
    expect(rows).toBe(3);
  });
});

describe('pasteText', () => {
  it('pastes at the active cell, parsing numbers, and selects the pasted block', () => {
    const sheet = new Spreadsheet();
    sheet.selection.selectCell(2, 1);
    const range = sheet.pasteText([['a', '12'], ['true', '']]);
    expect(sheet.getCellByView(2, 1).value).toBe('a');
    expect(sheet.getCellByView(2, 2).value).toBe(12);
    expect(sheet.getCellByView(3, 1).value).toBe(true);
    expect(range).toEqual({ startRow: 2, startCol: 1, endRow: 3, endCol: 2 });
  });

  it('is a single undo step and restores everything', () => {
    const sheet = new Spreadsheet();
    fill(sheet, [['old']]);
    sheet.selection.selectCell(0, 0);
    sheet.pasteText([['a', 'b'], ['c', 'd']]);
    expect(sheet.undo()).toBe(true);
    expect(sheet.getCellByView(0, 0).value).toBe('old');
    expect(sheet.getCellByView(1, 1).value).toBeNull();
    expect(sheet.history.canUndo).toBe(false);
  });

  it('keeps the existing formatting of the cells it overwrites', () => {
    const sheet = new Spreadsheet();
    const bold = sheet.styles.intern({ bold: true });
    sheet.model.setCell(0, 0, { value: 'x', styleId: bold });
    sheet.selection.selectCell(0, 0);
    sheet.pasteText([['y']]);
    expect(sheet.getCellByView(0, 0)).toEqual({ value: 'y', styleId: bold });
  });

  it('clips at the edge of the sheet', () => {
    const sheet = new Spreadsheet({ rowCount: 3, colCount: 3 });
    sheet.selection.selectCell(2, 2);
    sheet.pasteText([['a', 'b'], ['c', 'd']]);
    expect(sheet.getCellByView(2, 2).value).toBe('a');
    expect(sheet.model.cellCount).toBe(1);
  });

  it('tiles a small block across a selection that is an exact multiple', () => {
    const sheet = new Spreadsheet();
    sheet.selection.selectCell(0, 0);
    sheet.selection.extendTo(3, 3);
    sheet.pasteText([['x', 'y'], ['z', 'w']]);
    expect(sheet.getCellByView(2, 2).value).toBe('x');
    expect(sheet.getCellByView(3, 3).value).toBe('w');
    expect(sheet.getCellByView(0, 3).value).toBe('y');
  });

  it('pastes once at the top-left when the selection is not a multiple', () => {
    const sheet = new Spreadsheet();
    sheet.selection.selectCell(0, 0);
    sheet.selection.extendTo(2, 2);
    sheet.pasteText([['x', 'y'], ['z', 'w']]);
    expect(sheet.getCellByView(2, 2).value).toBeNull();
    expect(sheet.getCellByView(1, 1).value).toBe('w');
  });

  it('ignores an empty matrix', () => {
    const sheet = new Spreadsheet();
    expect(sheet.pasteMatrix(0, 0, () => ({ value: null, styleId: 0 }))).toBeNull();
    expect(sheet.history.canUndo).toBe(false);
  });
});

describe('pasteMatrix with cut', () => {
  it('moves cells: clears the source and writes the target in one undo step', () => {
    const sheet = new Spreadsheet();
    const bold = sheet.styles.intern({ bold: true });
    sheet.model.setCell(0, 0, { value: 'move me', styleId: bold });
    const { rows, cols, cells } = sheet.readCells({ startRow: 0, startCol: 0, endRow: 0, endCol: 0 });
    sheet.selection.selectCell(5, 5);
    sheet.pasteMatrix(rows, cols, (i, j) => cells[i]?.[j] as Cell, { startRow: 0, startCol: 0, endRow: 0, endCol: 0 });
    expect(sheet.model.hasCell(0, 0)).toBe(false);
    expect(sheet.getCellByView(5, 5)).toEqual({ value: 'move me', styleId: bold });
    sheet.undo();
    expect(sheet.getCellByView(0, 0).value).toBe('move me');
    expect(sheet.model.hasCell(5, 5)).toBe(false);
  });

  it('pasting over part of the source keeps the pasted value', () => {
    const sheet = new Spreadsheet();
    fill(sheet, [['a', 'b']]);
    const { rows, cols, cells } = sheet.readCells({ startRow: 0, startCol: 0, endRow: 0, endCol: 1 });
    sheet.selection.selectCell(0, 1);
    sheet.pasteMatrix(rows, cols, (i, j) => cells[i]?.[j] as Cell, { startRow: 0, startCol: 0, endRow: 0, endCol: 1 });
    expect(sheet.getCellByView(0, 0).value).toBeNull();
    expect(sheet.getCellByView(0, 1).value).toBe('a');
    expect(sheet.getCellByView(0, 2).value).toBe('b');
  });
});
