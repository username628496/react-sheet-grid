import { describe, expect, it } from 'vitest';
import { compareForSort } from '../../src/core/viewState';
import { Spreadsheet } from '../../src/core/Spreadsheet';
import { makeSheet, set } from './formula/helpers';

function col(s: Spreadsheet, c = 0, rows = s.rowCount): unknown[] {
  const out: unknown[] = [];
  for (let r = 0; r < rows; r++) out.push(s.getCellByView(r, c).value);
  return out;
}

function fill(values: Array<string | number>, headerRows = 0): Spreadsheet {
  const s = new Spreadsheet({ rowCount: 20, colCount: 4 });
  s.headerRows = headerRows;
  values.forEach((v, r) => s.setCellInput(r, 0, String(v)));
  return s;
}

describe('compareForSort', () => {
  it('orders numbers < text < booleans < errors, case-insensitively, with blanks last either way', () => {
    const values = [true, 'b', 3, 'A', null, { error: '#N/A' as const }, 1];
    const asc = [...values].sort((a, b) => compareForSort(a, b, true));
    expect(asc).toEqual([1, 3, 'A', 'b', true, { error: '#N/A' }, null]);
    const desc = [...values].sort((a, b) => compareForSort(a, b, false));
    expect(desc).toEqual([{ error: '#N/A' }, true, 'b', 'A', 3, 1, null]);
  });
});

describe('sortByColumn', () => {
  it('sorts numbers ascending and descending without moving stored data', () => {
    const s = fill([3, 1, 2]);
    s.sortByColumn(0, true);
    expect(col(s, 0, 3)).toEqual([1, 2, 3]);
    expect(s.mapping.isIdentity).toBe(false);
    // The model itself is untouched: data row 0 still holds 3.
    expect(s.model.getCell(0, 0).value).toBe(3);
    s.sortByColumn(0, false);
    expect(col(s, 0, 3)).toEqual([3, 2, 1]);
  });

  it('keeps whole rows together', () => {
    const s = new Spreadsheet({ rowCount: 10, colCount: 3 });
    [['b', 2], ['a', 1], ['c', 3]].forEach(([k, n], r) => {
      s.setCellInput(r, 0, String(k));
      s.setCellInput(r, 1, String(n));
    });
    s.sortByColumn(0, true);
    expect([0, 1, 2].map((r) => s.getCellByView(r, 1).value)).toEqual([1, 2, 3]);
  });

  it('puts blanks last in both directions and keeps empty rows below the data', () => {
    const s = fill([2, 1]);
    s.setCellInput(3, 0, '3'); // gap at row 2
    s.sortByColumn(0, true);
    expect(col(s, 0, 5)).toEqual([1, 2, 3, null, null]);
    s.sortByColumn(0, false);
    expect(col(s, 0, 5)).toEqual([3, 2, 1, null, null]);
    expect(s.rowCount).toBe(20);
  });

  it('is stable for equal keys', () => {
    const s = new Spreadsheet({ rowCount: 10, colCount: 2 });
    [['x', 1], ['x', 2], ['a', 3], ['x', 4]].forEach(([k, n], r) => {
      s.setCellInput(r, 0, String(k));
      s.setCellInput(r, 1, String(n));
    });
    s.sortByColumn(0, true);
    expect([0, 1, 2, 3].map((r) => s.getCellByView(r, 1).value)).toEqual([3, 1, 2, 4]);
  });

  it('never moves header rows', () => {
    const s = fill(['Name', 'b', 'c', 'a'], 1);
    s.sortByColumn(0, true);
    expect(col(s, 0, 4)).toEqual(['Name', 'a', 'b', 'c']);
    s.sortByColumn(0, false);
    expect(col(s, 0, 4)).toEqual(['Name', 'c', 'b', 'a']);
  });

  it('sorts mixed types like Sheets', () => {
    const s = fill(['b', 10, 'A', 2]);
    s.setCellInput(4, 0, 'TRUE');
    s.sortByColumn(0, true);
    expect(col(s, 0, 5)).toEqual([2, 10, 'A', 'b', true]);
  });

  it('is one undo step and restores the exact previous mapping', () => {
    const s = fill([3, 1, 2]);
    s.sortByColumn(0, true);
    s.undo();
    expect(s.mapping.isIdentity).toBe(true);
    expect(col(s, 0, 3)).toEqual([3, 1, 2]);
    s.redo();
    expect(col(s, 0, 3)).toEqual([1, 2, 3]);
  });

  it('clearSort restores natural order', () => {
    const s = fill([3, 1, 2]);
    s.sortByColumn(0, true);
    s.clearSort();
    expect(s.mapping.isIdentity).toBe(true);
    expect(s.sortDirection(0)).toBeNull();
    s.clearSort(); // nothing to clear: no extra history entry
    s.undo();
    expect(col(s, 0, 3)).toEqual([1, 2, 3]);
  });

  it('reports the sort direction per column', () => {
    const s = fill([2, 1]);
    s.sortByColumn(0, false);
    expect(s.sortDirection(0)).toBe('desc');
    expect(s.sortDirection(1)).toBeNull();
  });

  it('keeps formulas correct: they follow data cells, not view positions', () => {
    const s = makeSheet({ A1: 3, A2: 1, A3: 2, B1: '=SUM(A1:A3)' });
    s.sortByColumn(0, true);
    // B1 stays at data row 0 (formulas use data coordinates) and still sums all three values.
    expect(s.model.getCell(0, 1).formula).toBeDefined();
    expect(s.model.getCell(0, 1).value).toBe(6);
    set(s, 'A5', 4); // a new value in the sorted view still feeds the formula only if it is inside A1:A3
    expect(s.model.getCell(0, 1).value).toBe(6);
  });

  it('editing, copying and formatting work through the mapping', () => {
    const s = fill([3, 1, 2]);
    s.sortByColumn(0, true);
    s.setCellInput(0, 0, '100'); // view row 0 is data row 1
    expect(s.model.getCell(1, 0).value).toBe(100);
    expect(s.readCells({ startRow: 0, startCol: 0, endRow: 2, endCol: 0 }).cells.map((r) => r[0]?.value)).toEqual([100, 2, 3]);
    s.selection.selectCell(1, 0);
    s.toggleStyle('bold');
    expect(s.styles.get(s.model.getCell(2, 0).styleId).bold).toBe(true);
  });

  it('keeps row heights across a sort and restores them on undo', () => {
    const s = fill([2, 1]);
    s.rows.setSize(5, 50);
    s.sortByColumn(0, true);
    expect(s.rows.getSize(5)).toBe(50);
    s.undo();
    expect(s.rows.getSize(5)).toBe(50);
  });
});

describe('filter', () => {
  function table(): Spreadsheet {
    const s = new Spreadsheet({ rowCount: 20, colCount: 3 });
    s.headerRows = 1;
    [['Name', 'City'], ['a', 'Hanoi'], ['b', 'Saigon'], ['c', 'Hanoi'], ['d', 'Hue']].forEach((row, r) =>
      row.forEach((v, c) => s.setCellInput(r, c, v)),
    );
    return s;
  }

  it('hides rows that do not match and changes the visible row count', () => {
    const s = table();
    s.setColumnFilter(1, new Set(['Hanoi']));
    expect(s.rowCount).toBe(20 - 2);
    expect(col(s, 0, 3)).toEqual(['Name', 'a', 'c']);
    expect(s.isColumnFiltered(1)).toBe(true);
    expect(s.rows.count).toBe(s.rowCount);
  });

  it('combines filters on several columns (AND)', () => {
    const s = table();
    s.setColumnFilter(1, new Set(['Hanoi', 'Hue']));
    s.setColumnFilter(0, new Set(['c', 'd']));
    expect(col(s, 0, 3)).toEqual(['Name', 'c', 'd']);
  });

  it('filters by the displayed text, so number formats count', () => {
    const s = new Spreadsheet({ rowCount: 10, colCount: 1 });
    s.setCellInput(0, 0, '1.5');
    s.setCellInput(1, 0, '2');
    s.selection.selectCell(0, 0);
    s.selection.extendTo(1, 0);
    s.formatSelection({ numberFormat: '0.00' });
    s.setColumnFilter(0, new Set(['2.00']));
    expect(s.getCellByView(0, 0).value).toBe(2);
  });

  it('can filter for blanks with the empty text', () => {
    const s = fill(['a', 'b']);
    s.setCellInput(3, 0, 'c'); // row 2 is blank
    s.setColumnFilter(0, new Set(['']));
    expect(s.getCellByView(0, 0).value).toBeNull();
    expect(s.rowCount).toBe(20 - 3);
  });

  it('undo restores rows, count and row heights exactly', () => {
    const s = table();
    s.rows.setSize(19, 60); // the filter leaves 18 rows, so this override falls off the end
    s.setColumnFilter(1, new Set(['Hanoi']));
    expect(s.rows.count).toBe(18);
    s.undo();
    expect(s.rowCount).toBe(20);
    expect(s.rows.count).toBe(20);
    expect(s.rows.getSize(19)).toBe(60);
    expect(col(s, 0, 5)).toEqual(['Name', 'a', 'b', 'c', 'd']);
    expect(s.mapping.isIdentity).toBe(true);
  });

  it('filter + sort compose, and removing the filter keeps the sort', () => {
    const s = table();
    s.setColumnFilter(1, new Set(['Hanoi', 'Hue']));
    s.sortByColumn(0, false);
    expect(col(s, 0, 4)).toEqual(['Name', 'd', 'c', 'a']);
    s.setColumnFilter(1, null);
    expect(col(s, 0, 5)).toEqual(['Name', 'd', 'c', 'b', 'a']);
    expect(s.isColumnFiltered(1)).toBe(false);
  });

  it('clearFilters removes every filter in one step', () => {
    const s = table();
    s.setColumnFilter(1, new Set(['Hanoi']));
    s.setColumnFilter(0, new Set(['a']));
    s.clearFilters();
    expect(s.mapping.isIdentity).toBe(true);
    expect(s.rowCount).toBe(20);
  });

  it('keeps the selection inside the shrunken grid', () => {
    const s = table();
    s.selection.selectCell(19, 2);
    s.setColumnFilter(1, new Set(['Hanoi']));
    expect(s.selection.activeRow).toBe(s.rowCount - 1);
  });

  it('header rows are never filtered', () => {
    const s = table();
    s.setColumnFilter(1, new Set(['Nothing']));
    expect(s.getCellByView(0, 0).value).toBe('Name');
  });

  it('getDistinctValues lists display texts with counts, sorted, ignoring the column\'s own filter', () => {
    const s = table();
    s.setColumnFilter(1, new Set(['Hanoi']));
    const { values } = s.getDistinctValues(1);
    expect(values).toEqual([
      { text: 'Hanoi', count: 2 },
      { text: 'Hue', count: 1 },
      { text: 'Saigon', count: 1 },
    ]);
  });

  it('getDistinctValues respects the other columns\' filters, counts blanks and truncates', () => {
    const s = table();
    s.setCellInput(6, 1, 'Hue');
    s.setColumnFilter(0, new Set(['a', 'd', '']));
    // Row 6 holds 'Hue' with an empty name (allowed by the '' entry); row 5 is an empty row inside the data.
    expect(s.getDistinctValues(1).values).toEqual([
      { text: 'Hanoi', count: 1 },
      { text: 'Hue', count: 2 },
      { text: '', count: 1 },
    ]);
    const big = new Spreadsheet({ rowCount: 100, colCount: 1 });
    for (let r = 0; r < 50; r++) big.setCellInput(r, 0, String(r));
    const res = big.getDistinctValues(0, 10);
    expect(res.values).toHaveLength(10);
    expect(res.truncated).toBe(true);
    expect(res.values[0]?.text).toBe('0');
  });

  it('getDistinctValues reports blank cells inside the data', () => {
    const s = fill(['x']);
    s.setCellInput(2, 0, 'y');
    expect(s.getDistinctValues(0).values).toEqual([
      { text: 'x', count: 1 },
      { text: 'y', count: 1 },
      { text: '', count: 1 },
    ]);
  });
});

describe('sort/filter on large data', () => {
  it('sorts 200,000 rows quickly', () => {
    const s = new Spreadsheet({ rowCount: 1_000_000, colCount: 2 });
    let seed = 7;
    for (let r = 0; r < 200_000; r++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      s.model.setCell(r, 0, { value: seed % 100000, styleId: 0 });
    }
    const t0 = performance.now();
    s.sortByColumn(0, true);
    expect(performance.now() - t0).toBeLessThan(3000);
    let prev = -1;
    for (let r = 0; r < 1000; r++) {
      const v = s.getCellByView(r, 0).value as number;
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
    set(s, 'B1', 'x');
    expect(s.rowCount).toBe(1_000_000);
  });
});
