import { describe, expect, it } from 'vitest';
import { Spreadsheet } from '../../src/core/Spreadsheet';
import { makeSheet } from './formula/helpers';

function styleAt(s: Spreadsheet, r: number, c: number) {
  return s.styles.get(s.getCellByView(r, c).styleId);
}

describe('toggleStyle', () => {
  it('bolds the selection, including empty cells in a small range, in one undo step', () => {
    const s = makeSheet({ A1: 'x' });
    s.selection.selectCell(0, 0);
    s.selection.extendTo(1, 1);
    s.toggleStyle('bold');
    expect(styleAt(s, 0, 0).bold).toBe(true);
    expect(styleAt(s, 1, 1).bold).toBe(true);
    expect(s.getCellByView(0, 0).value).toBe('x'); // values untouched
    s.undo();
    expect(styleAt(s, 0, 0).bold).toBeUndefined();
    expect(s.model.hasCell(1, 1)).toBe(false);
  });

  it('removes bold only when every selected cell already has it', () => {
    const s = makeSheet({ A1: 'x', A2: 'y' });
    s.selection.selectCell(0, 0);
    s.toggleStyle('bold');
    s.selection.extendTo(1, 0);
    s.toggleStyle('bold'); // mixed -> everything becomes bold
    expect(styleAt(s, 1, 0).bold).toBe(true);
    s.toggleStyle('bold'); // all bold -> remove
    expect(styleAt(s, 0, 0).bold).toBeUndefined();
    expect(styleAt(s, 1, 0).bold).toBeUndefined();
  });

  it('italic is independent of bold', () => {
    const s = makeSheet({ A1: 'x' });
    s.selection.selectCell(0, 0);
    s.toggleStyle('bold');
    s.toggleStyle('italic');
    expect(styleAt(s, 0, 0)).toEqual({ bold: true, italic: true });
  });

  it('keeps formulas when formatting', () => {
    const s = makeSheet({ A1: 1, B1: '=A1+1' });
    s.selection.selectCell(0, 1);
    s.toggleStyle('bold');
    expect(s.getEditText(0, 1)).toBe('=A1+1');
    expect(s.getCellByView(0, 1).value).toBe(2);
  });
});

describe('formatSelection', () => {
  it('sets colors, alignment and number format', () => {
    const s = makeSheet({ A1: 1234.5 });
    s.selection.selectCell(0, 0);
    s.formatSelection({ color: '#ff0000', background: '#ffff00', align: 'center', numberFormat: '#,##0.00' });
    expect(styleAt(s, 0, 0)).toEqual({ color: '#ff0000', background: '#ffff00', align: 'center', numberFormat: '#,##0.00' });
    expect(s.getDisplayText(0, 0)).toBe('1,234.50');
  });

  it('clears a property with undefined and shares identical styles', () => {
    const s = makeSheet({ A1: 1, A2: 2 });
    s.selection.selectCell(0, 0);
    s.selection.extendTo(1, 0);
    s.formatSelection({ color: '#f00' });
    expect(s.getCellByView(0, 0).styleId).toBe(s.getCellByView(1, 0).styleId);
    s.formatSelection({ color: undefined });
    expect(s.getCellByView(0, 0).styleId).toBe(0);
  });

  it('formatting a huge selection only touches stored cells', () => {
    const s = new Spreadsheet({ rowCount: 1_000_000, colCount: 10 });
    s.setCellInput(5, 0, 'x');
    s.selection.selectCol(0);
    s.toggleStyle('bold');
    expect(s.model.cellCount).toBe(1);
    expect(styleAt(s, 5, 0).bold).toBe(true);
  });

  it('percent format scales the value for display only', () => {
    const s = makeSheet({ A1: 0.256 });
    s.selection.selectCell(0, 0);
    s.formatSelection({ numberFormat: '0%' });
    expect(s.getDisplayText(0, 0)).toBe('26%');
    expect(s.getCellByView(0, 0).value).toBe(0.256);
  });

  it('works on the cells a sorted view maps to', () => {
    const s = makeSheet({ A1: 'a', A2: 'b' });
    s.mapping.setOrder(Int32Array.from([1, 0]));
    s.selection.selectCell(0, 0); // view row 0 = data row 1
    s.toggleStyle('bold');
    expect(s.styles.get(s.model.getCell(1, 0).styleId).bold).toBe(true);
    expect(s.styles.get(s.model.getCell(0, 0).styleId).bold).toBeUndefined();
  });
});

describe('getSelectionStats', () => {
  it('summarizes the numeric cells of the selection', () => {
    const s = makeSheet({ A1: 1, A2: 2, A3: 'text', A4: 6, B1: '=A1+10' });
    s.selection.selectCell(0, 0);
    s.selection.extendTo(3, 1);
    expect(s.getSelectionStats()).toEqual({ count: 4, sum: 1 + 2 + 6 + 11, average: 20 / 4, min: 1, max: 11 });
  });

  it('is null without numbers and counts overlapping ranges once', () => {
    const s = makeSheet({ A1: 'a', B1: 5 });
    s.selection.selectCell(0, 0);
    expect(s.getSelectionStats()).toBeNull();
    s.selection.selectCell(0, 1);
    s.selection.addCell(0, 1);
    expect(s.getSelectionStats()?.count).toBe(1);
  });

  it('is cheap for a whole-sheet selection', () => {
    const s = new Spreadsheet({ rowCount: 1_000_000, colCount: 100 });
    s.model.setCell(500_000, 50, { value: 7, styleId: 0 });
    s.selection.selectAll();
    const t0 = performance.now();
    expect(s.getSelectionStats()).toMatchObject({ count: 1, sum: 7 });
    expect(performance.now() - t0).toBeLessThan(200);
  });

  it('works through a sorted view', () => {
    const s = makeSheet({ A1: 3, A2: 1 });
    s.mapping.setOrder(Int32Array.from([1, 0]));
    s.selection.selectCell(0, 0);
    expect(s.getSelectionStats()?.sum).toBe(1);
  });
});
