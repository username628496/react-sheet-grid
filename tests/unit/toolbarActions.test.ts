import { describe, expect, it } from 'vitest';
import { deserializeSheet, serializeSheet } from '../../src/core/snapshot';
import { addr, makeSheet, value } from './formula/helpers';

function select(s: ReturnType<typeof makeSheet>, from: string, to?: string): void {
  s.selection.selectCell(...addr(from));
  if (to !== undefined) s.selection.extendTo(...addr(to));
}

describe('insertFunction (the Σ button)', () => {
  it('a selected column gets the formula right below it, one per selected column', () => {
    const s = makeSheet({ A1: 1, A2: 2, B1: 10, B2: 20 });
    select(s, 'A1', 'B2');
    expect(s.insertFunction('SUM')).toBe(true);
    expect(s.getEditText(...addr('A3'))).toBe('=SUM(A1:A2)');
    expect(s.getEditText(...addr('B3'))).toBe('=SUM(B1:B2)');
    expect(value(s, 'A3')).toBe(3);
    expect(value(s, 'B3')).toBe(30);
    expect([s.selection.activeRow, s.selection.activeCol]).toEqual([2, 0]);
  });

  it('a selected row gets the formula to its right', () => {
    const s = makeSheet({ A1: 1, B1: 2, C1: 3 });
    select(s, 'A1', 'C1');
    s.insertFunction('AVERAGE');
    expect(s.getEditText(...addr('D1'))).toBe('=AVERAGE(A1:C1)');
    expect(value(s, 'D1')).toBe(2);
  });

  it('a single cell sums the numbers above it, else the ones to its left, in that cell', () => {
    const s = makeSheet({ A1: 5, A2: 6, A3: 'x', B5: 1, C5: 2 });
    select(s, 'A3');
    expect(s.insertFunction('SUM')).toBe(true);
    expect(s.getEditText(...addr('A3'))).toBe('=SUM(A1:A2)');
    expect(value(s, 'A3')).toBe(11);
    select(s, 'D5');
    s.insertFunction('MAX');
    expect(s.getEditText(...addr('D5'))).toBe('=MAX(B5:C5)');
    expect(value(s, 'D5')).toBe(2);
    select(s, 'F9');
    s.insertFunction('COUNT');
    expect(s.getEditText(...addr('F9'))).toBe('=COUNT(F9)'); // nothing to sum: a formula to adjust by hand
  });

  it('is one undo step, and is refused at the sheet edge or in a sorted view', () => {
    const s = makeSheet({ A1: 1, A2: 2, B1: 3, B2: 4 });
    select(s, 'A1', 'B2');
    s.insertFunction('SUM');
    s.undo();
    expect(s.model.hasCell(...addr('A3'))).toBe(false);
    expect(s.model.hasCell(...addr('B3'))).toBe(false);

    const edge = makeSheet({});
    edge.selection.selectCell(998, 0);
    edge.selection.extendTo(999, 0);
    expect(edge.insertFunction('SUM')).toBe(false);

    s.sortByColumn(0, true);
    select(s, 'A1', 'A2');
    expect(s.insertFunction('SUM')).toBe(false);
  });

  it('keeps the formatting of the cell it writes into', () => {
    const s = makeSheet({ A1: 1, A2: 2 });
    select(s, 'A3');
    s.toggleStyle('bold');
    select(s, 'A1', 'A2');
    s.insertFunction('SUM');
    expect(s.styles.get(s.getCellByView(...addr('A3')).styleId).bold).toBe(true);
  });
});

describe('shiftSelectionDecimals', () => {
  it('grows and shrinks the decimals of the whole selection from the active cell', () => {
    const s = makeSheet({ A1: 1.5, A2: 2.25 });
    select(s, 'A1', 'A2');
    s.shiftSelectionDecimals(1);
    expect(s.styles.get(s.getCellByView(0, 0).styleId).numberFormat).toBe('0.00');
    expect(s.styles.get(s.getCellByView(1, 0).styleId).numberFormat).toBe('0.00');
    s.shiftSelectionDecimals(-1);
    s.shiftSelectionDecimals(-1);
    expect(s.styles.get(s.getCellByView(0, 0).styleId).numberFormat).toBe('0');
    s.undo();
    expect(s.styles.get(s.getCellByView(0, 0).styleId).numberFormat).toBe('0.0');
  });
});

describe('frozen panes', () => {
  it('are clamped, notify, and stay out of sort and filter', () => {
    const s = makeSheet({ A1: 'head', A2: 3, A3: 1, A4: 2 });
    let notified = 0;
    s.subscribe(() => notified++);
    s.setFrozen(1, 2);
    expect([s.frozenRows, s.frozenCols, s.headerRows]).toEqual([1, 2, 1]);
    expect(notified).toBe(1);
    s.setFrozen(1, 2);
    expect(notified).toBe(1); // unchanged: no notification
    s.sortByColumn(0, true);
    expect(s.getCellByView(0, 0).value).toBe('head');
    expect([1, 2, 3].map((r) => s.getCellByView(r, 0).value)).toEqual([1, 2, 3]);
    s.setFrozen(5000, -3);
    expect([s.frozenRows, s.frozenCols]).toEqual([999, 0]); // one row always stays scrollable
    s.setFrozen(Number.NaN, 2.9);
    expect([s.frozenRows, s.frozenCols]).toEqual([0, 2]);
  });

  it('survive a snapshot round trip, and older snapshots without them load', () => {
    const s = makeSheet({ A1: 1 });
    s.setFrozen(2, 1);
    const t = deserializeSheet(JSON.parse(JSON.stringify(serializeSheet(s))));
    expect([t.frozenRows, t.frozenCols]).toEqual([2, 1]);
    const old = JSON.parse(JSON.stringify(serializeSheet(s))) as Record<string, unknown>;
    delete old.frozenRows;
    delete old.frozenCols;
    const u = deserializeSheet(old);
    expect([u.frozenRows, u.frozenCols]).toEqual([0, 0]);
  });
});
