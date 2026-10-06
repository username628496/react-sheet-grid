import { describe, expect, it } from 'vitest';
import { Spreadsheet } from '../../src/core/Spreadsheet';
import { addr, e, makeSheet, set, value } from './formula/helpers';

function text(s: Spreadsheet, a1: string): string {
  return s.getEditText(...addr(a1));
}

describe('insertRows', () => {
  it('moves cells at or below the insertion down and selects the new rows', () => {
    const s = makeSheet({ A1: 'a', A2: 'b', A3: 'c' });
    expect(s.insertRows(1, 2)).toBe(true);
    expect([0, 1, 2, 3, 4].map((r) => s.getCellByView(r, 0).value)).toEqual(['a', null, null, 'b', 'c']);
    expect(s.rowCount).toBe(1002);
    expect(s.selection.primary).toMatchObject({ startRow: 1, endRow: 2 });
  });

  it('inserts at the very end and rejects out-of-range positions', () => {
    const s = makeSheet({ A1: 'a' });
    expect(s.insertRows(1000, 1)).toBe(true);
    expect(s.rowCount).toBe(1001);
    expect(s.insertRows(5000, 1)).toBe(false);
    expect(s.insertRows(0, 0)).toBe(false);
    expect(s.insertRows(-1, 1)).toBe(false);
  });

  it('keeps row heights with their rows', () => {
    const s = makeSheet();
    s.rows.setSize(3, 60);
    s.insertRows(1, 2);
    expect(s.rows.getSize(3)).toBe(21);
    expect(s.rows.getSize(5)).toBe(60);
    expect(s.rows.count).toBe(s.rowCount);
  });

  it('is one undo step that restores everything', () => {
    const s = makeSheet({ A1: 'a', A2: 'b', B1: '=A2' });
    s.rows.setSize(1, 40);
    s.insertRows(1, 3);
    s.undo();
    expect(s.rowCount).toBe(1000);
    expect(s.rows.count).toBe(1000);
    expect(s.rows.getSize(1)).toBe(40);
    expect(value(s, 'A2')).toBe('b');
    expect(text(s, 'B1')).toBe('=A2');
    expect(value(s, 'B1')).toBe('b');
    s.redo();
    expect(value(s, 'A5')).toBe('b');
    expect(text(s, 'B1')).toBe('=A5');
  });
});

describe('deleteRows', () => {
  it('removes the rows and moves later ones up', () => {
    const s = makeSheet({ A1: 'a', A2: 'b', A3: 'c', A4: 'd' });
    expect(s.deleteRows(1, 2)).toBe(true);
    expect([0, 1].map((r) => s.getCellByView(r, 0).value)).toEqual(['a', 'd']);
    expect(s.rowCount).toBe(998);
  });

  it('clamps the count at the end, never deletes everything', () => {
    const s = makeSheet();
    expect(s.deleteRows(995, 100)).toBe(true);
    expect(s.rowCount).toBe(995);
    expect(s.deleteRows(0, 995)).toBe(false);
    expect(s.deleteRows(5000, 1)).toBe(false);
  });

  it('drops the sizes of deleted rows and shifts the rest', () => {
    const s = makeSheet();
    s.rows.setSize(2, 50);
    s.rows.setSize(6, 70);
    s.deleteRows(1, 3); // rows 1-3 go, so old row 6 becomes row 3 and old row 2's size is dropped
    expect(s.rows.getSize(3)).toBe(70);
    expect(s.rows.getSize(2)).toBe(21);
    expect(s.rows.getSize(6)).toBe(21);
  });

  it('undo brings deleted cells and sizes back', () => {
    const s = makeSheet({ A2: 'gone', A3: 'stay' });
    s.rows.setSize(1, 55);
    s.deleteRows(1, 1);
    expect(value(s, 'A2')).toBe('stay');
    s.undo();
    expect(value(s, 'A2')).toBe('gone');
    expect(s.rows.getSize(1)).toBe(55);
    expect(s.rowCount).toBe(1000);
  });
});

describe('columns', () => {
  it('insert and delete columns move data and widths', () => {
    const s = makeSheet({ A1: 'a', B1: 'b', C1: 'c' });
    s.cols.setSize(2, 150);
    s.insertCols(1, 1);
    expect([0, 1, 2, 3].map((c) => s.getCellByView(0, c).value)).toEqual(['a', null, 'b', 'c']);
    expect(s.cols.getSize(3)).toBe(150);
    expect(s.colCount).toBe(27);
    s.deleteCols(0, 2);
    expect([0, 1].map((c) => s.getCellByView(0, c).value)).toEqual(['b', 'c']);
    s.undo();
    s.undo();
    expect(s.colCount).toBe(26);
    expect(s.cols.getSize(2)).toBe(150);
    expect([0, 1, 2].map((c) => s.getCellByView(0, c).value)).toEqual(['a', 'b', 'c']);
  });

  it('refuses to grow past the maximum column count', () => {
    const s = new Spreadsheet({ rowCount: 10, colCount: 16_384 });
    expect(s.insertCols(0, 1)).toBe(false);
  });
});

describe('formula references', () => {
  it('follows moved cells when rows are inserted above', () => {
    const s = makeSheet({ A1: 5, A2: 7, C1: '=A1+A2' });
    s.insertRows(0, 1);
    expect(text(s, 'C2')).toBe('=A2+A3');
    expect(value(s, 'C2')).toBe(12);
  });

  it('expands a range when rows are inserted inside it', () => {
    const s = makeSheet({ A1: 1, A2: 2, A3: 3, B1: '=SUM(A1:A3)' });
    s.insertRows(1, 1);
    set(s, 'A2', 10);
    expect(text(s, 'B1')).toBe('=SUM(A1:A4)');
    expect(value(s, 'B1')).toBe(16);
  });

  it('does not expand a range when rows are inserted just below it', () => {
    const s = makeSheet({ A1: 1, A2: 2, B1: '=SUM(A1:A2)' });
    s.insertRows(2, 1);
    expect(text(s, 'B1')).toBe('=SUM(A1:A2)');
  });

  it('shrinks ranges and turns references to deleted cells into #REF!', () => {
    const s = makeSheet({ A1: 1, A2: 2, A3: 3, A4: 4, B1: '=SUM(A1:A4)', B2: '=A2', B3: '=A3+1' });
    s.deleteRows(1, 1); // delete row 2
    expect(text(s, 'B1')).toBe('=SUM(A1:A3)');
    expect(value(s, 'B1')).toBe(8);
    expect(value(s, 'B2')).toBe(4); // formerly B3 = A3+1 -> A2+1 = 3+1
    expect(text(s, 'B2')).toBe('=A2+1');
    const gone = makeSheet({ A2: 5, B1: '=A2*2' });
    gone.deleteRows(1, 1);
    expect(text(gone, 'B1')).toBe('=#REF!*2');
    expect(value(gone, 'B1')).toEqual(e('#REF!'));
  });

  it('a range wholly inside the deleted rows becomes #REF!', () => {
    const s = makeSheet({ A2: 1, A3: 2, B1: '=SUM(A2:A3)' });
    s.deleteRows(1, 2);
    expect(value(s, 'B1')).toEqual(e('#REF!'));
  });

  it('absolute references move too', () => {
    const s = makeSheet({ A5: 9, B1: '=$A$5' });
    s.insertRows(0, 2);
    expect(text(s, 'B3')).toBe('=$A$7');
    expect(value(s, 'B3')).toBe(9);
  });

  it('works for columns', () => {
    const s = makeSheet({ A1: 1, B1: 2, C1: '=A1+B1' });
    s.insertCols(1, 1);
    expect(text(s, 'D1')).toBe('=A1+C1');
    expect(value(s, 'D1')).toBe(3);
    s.deleteCols(0, 1);
    expect(text(s, 'C1')).toBe('=#REF!+B1');
  });

  it('whole-column references stay whole', () => {
    const s = makeSheet({ A1: 1, A2: 2, C1: '=SUM(A:A)' });
    s.insertRows(1, 3);
    expect(text(s, 'C1')).toBe('=SUM(A:A)');
    expect(value(s, 'C1')).toBe(3);
  });

  it('results are recomputed and dependents keep working afterwards', () => {
    const s = makeSheet({ A1: 1, B1: '=A1*2', C1: '=B1+1' });
    s.insertRows(0, 1);
    set(s, 'A2', 10);
    expect(value(s, 'C2')).toBe(21);
  });

  it('undo restores the original formulas exactly', () => {
    const s = makeSheet({ A1: 1, A2: 2, B1: '=SUM(A1:A2)' });
    s.deleteRows(0, 1);
    s.undo();
    expect(text(s, 'B1')).toBe('=SUM(A1:A2)');
    expect(value(s, 'B1')).toBe(3);
  });
});

describe('sort/filter interaction', () => {
  it('refuses while a sort or filter is active', () => {
    const s = makeSheet({ A1: 2, A2: 1 });
    s.sortByColumn(0, true);
    expect(s.canEditStructure).toBe(false);
    expect(s.insertRows(0, 1)).toBe(false);
    expect(s.deleteRows(0, 1)).toBe(false);
    s.clearSort();
    expect(s.insertRows(0, 1)).toBe(true);
  });
});
