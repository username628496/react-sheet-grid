import { describe, expect, it } from 'vitest';
import { deserializeSheet, serializeSheet } from '../../src/core/snapshot';
import { Workbook } from '../../src/core/Workbook';
import { Spreadsheet } from '../../src/core/Spreadsheet';
import { makeSheet, value } from './formula/helpers';

/** Data rows 0..4 hold 30, 10, 50, 20, 40 in column A; ascending, the screen shows 10, 20, 30, 40, 50 (data rows 1, 3, 0, 4, 2). */
function sorted(extra: Record<string, string | number> = {}) {
  const s = makeSheet({ A1: 30, A2: 10, A3: 50, A4: 20, A5: 40, ...extra });
  s.sortByColumn(0, true);
  return s;
}
const shown = (s: Spreadsheet, row: number, col = 0): unknown => s.getCellByView(row, col).value;

describe('formulas read and write the rows on screen when the sheet is sorted', () => {
  it('a typed reference means the cell you see there', () => {
    const s = sorted();
    s.setCellInput(0, 2, '=A1+A5'); // on screen: 10 + 50
    expect(shown(s, 0, 2)).toBe(60);
    expect(s.getEditText(0, 2)).toBe('=A1+A5');
    s.setCellInput(2, 2, '=SUM(A1:A5)'); // the whole sorted block: the same data rows, whatever their order
    expect(shown(s, 2, 2)).toBe(150);
    expect(s.getEditText(2, 2)).toBe('=SUM(A1:A5)');
  });

  it('a range over rows that sorting has scattered is refused as #REF!, keeping what was typed, never a wrong sum', () => {
    const s = sorted();
    s.setCellInput(0, 2, '=SUM(A1:A3)'); // on screen 10, 20, 30 = data rows 1, 3, 0: not a block of data rows
    expect(shown(s, 0, 2)).toEqual({ error: '#REF!' });
    expect(s.getEditText(0, 2)).toBe('=SUM(A1:A3)');
    // Typed on an unsorted sheet, or over a block, the same text works.
    s.clearSort();
    s.setCellInput(1, 2, '=SUM(A1:A3)');
    expect(shown(s, 1, 2)).toBe(90); // 30 + 10 + 50
  });

  it('the reference follows its data: sorting again moves the labels, not the cells', () => {
    const s = sorted();
    s.setCellInput(0, 2, '=A1'); // the 10, which is on screen row 1
    expect(shown(s, 0, 2)).toBe(10);
    s.sortByColumn(0, false); // descending: the 10 is now displayed in row 5
    const row = [0, 1, 2, 3, 4].find((r) => shown(s, r, 2) === 10) as number; // where the formula cell went
    expect(shown(s, row, 2)).toBe(10);
    expect(s.getEditText(row, 2)).toBe('=A5'); // still the cell holding 10, now displayed in row 5
  });

  it('is unchanged when nothing is sorted or filtered', () => {
    const s = makeSheet({ A1: 30, A2: 10 });
    s.setCellInput(2, 2, '=A1+A2');
    expect(s.getEditText(2, 2)).toBe('=A1+A2');
    expect(value(s, 'C3')).toBe(40);
  });

  it('relative references keep their offset on screen when a formula is copied down in a sorted sheet', () => {
    const s = sorted();
    s.setCellInput(0, 2, '=A1*2'); // beside the 10
    s.fillRange({ startRow: 0, endRow: 0, startCol: 2, endCol: 2 }, 'down', 4);
    expect([0, 1, 2, 3, 4].map((r) => shown(s, r, 2))).toEqual([20, 40, 60, 80, 100]); // each doubles its own row
    expect([0, 1, 2, 3, 4].map((r) => s.getEditText(r, 2))).toEqual(['=A1*2', '=A2*2', '=A3*2', '=A4*2', '=A5*2']);
  });

  it('copy and paste do the same', () => {
    const s = sorted();
    s.setCellInput(0, 2, '=A1+1');
    const { cells } = s.readCells({ startRow: 0, endRow: 0, startCol: 2, endCol: 2 });
    s.selection.selectCell(3, 2);
    s.pasteMatrix(
      1,
      1,
      (_i, _j, _existing, dataRow, dataCol) => {
        const cell = cells[0]?.[0] as (typeof cells)[number][number];
        return { ...cell, formula: s.translateFormula(cell.formula!, s.mapping.toDataRow(0), 2, dataRow, dataCol) };
      },
      null,
    );
    expect(shown(s, 3, 2)).toBe(41); // the 40 on screen row 4, plus one
    expect(s.getEditText(3, 2)).toBe('=A4+1');
  });

  it('Ctrl+Enter writes the formula for each cell in its own place', () => {
    const s = sorted();
    s.selection.selectCell(0, 2);
    s.selection.extendTo(4, 2);
    s.fillSelectionWithInput('=A1*10');
    expect([0, 1, 2, 3, 4].map((r) => shown(s, r, 2))).toEqual([100, 200, 300, 400, 500]);
  });

  it('absolute references keep pointing at the same screen row', () => {
    const s = sorted();
    s.setCellInput(0, 2, '=$A$2'); // the 20 on screen
    s.fillRange({ startRow: 0, endRow: 0, startCol: 2, endCol: 2 }, 'down', 2);
    expect([0, 1, 2].map((r) => shown(s, r, 2))).toEqual([20, 20, 20]);
    expect(s.getEditText(2, 2)).toBe('=$A$2');
  });

  it('references to other sheets are not re-mapped through this sheet\'s order', () => {
    const wb = new Workbook(new Spreadsheet({ rowCount: 20, colCount: 6 }));
    wb.active.name = 'A';
    const other = wb.addSheet({ name: 'B', rowCount: 20, colCount: 6 })!;
    other.setCellInput(0, 0, '7');
    other.setCellInput(1, 0, '8');
    wb.setActive(0);
    const a = wb.sheetByName('A')!;
    a.setCellInput(0, 0, '3');
    a.setCellInput(1, 0, '1');
    a.sortByColumn(0, true);
    a.setCellInput(0, 2, '=B!A2*2');
    expect(shown(a, 0, 2)).toBe(16);
    expect(a.getEditText(0, 2)).toBe('=B!A2*2');
  });

  it('a filter changes the labels too, and a range across hidden rows is refused', () => {
    const s = makeSheet({ A1: 'x', A2: 'y', A3: 'x', A4: 'y', B1: 1, B2: 2, B3: 3, B4: 4 });
    s.setColumnFilter(0, new Set(['x'])); // the screen shows data rows 0 and 2, as rows 1 and 2
    s.setCellInput(0, 3, '=B2'); // displayed row 2 is data row 2 (value 3)
    expect(shown(s, 0, 3)).toBe(3);
    expect(s.getEditText(0, 3)).toBe('=B2');
    s.setCellInput(1, 3, '=SUM(B1:B2)'); // data rows 0 and 2 with the hidden row 1 between them
    expect(shown(s, 1, 3)).toEqual({ error: '#REF!' });
    s.clearFilters();
    expect(s.getEditText(0, 3)).toBe('=B3'); // unfiltered, data row 2 is row 3 again
    expect(shown(s, 0, 3)).toBe(3);
  });

  it('what is saved stays in data coordinates, so a reload gives the same formulas and labels', () => {
    const s = sorted();
    s.setCellInput(0, 2, '=A1+A2');
    s.setCellInput(1, 2, '=SUM(A1:A5)');
    const restored = deserializeSheet(JSON.parse(JSON.stringify(serializeSheet(s))));
    expect([0, 1].map((r) => restored.getEditText(r, 2))).toEqual(['=A1+A2', '=SUM(A1:A5)']);
    expect([0, 1].map((r) => shown(restored, r, 2))).toEqual([30, 150]);
  });

  it('undo of typing a formula in a sorted sheet restores the cell', () => {
    const s = sorted();
    s.setCellInput(0, 2, '=A3');
    s.undo();
    expect(s.getCellByView(0, 2).formula).toBeUndefined();
  });
});
