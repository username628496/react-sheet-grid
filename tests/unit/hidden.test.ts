import { describe, expect, it } from 'vitest';
import { advanceActive, moveByArrow, moveByPage, moveToEdge, type NavContext } from '../../src/core/selection/navigation';
import { SelectionModel } from '../../src/core/selection/SelectionModel';
import { Spreadsheet } from '../../src/core/Spreadsheet';
import { makeSheet, value } from './formula/helpers';

describe('hideLines / showLines', () => {
  it('hides rows as one undo step, keeps one line visible, and shows them again at the default size', () => {
    const s = makeSheet({ A1: 'a', A2: 'b', A3: 'c' });
    s.rows.setSize(1, 50);
    expect(s.hideLines('row', 1, 2)).toBe(2);
    expect(s.rows.getSize(1)).toBe(0);
    expect(s.rows.getSize(2)).toBe(0);
    expect(s.hideLines('row', 1, 2)).toBe(0); // already hidden
    s.undo();
    expect(s.rows.getSize(1)).toBe(50); // the custom height comes back
    expect(s.rows.getSize(2)).toBe(s.rows.defaultSize);
    s.redo();
    expect(s.showLines('row', 0, 5)).toBe(2);
    expect(s.rows.getSize(1)).toBe(s.rows.defaultSize);
  });

  it('refuses to hide everything', () => {
    const s = new Spreadsheet({ rowCount: 3, colCount: 2 });
    expect(s.hideLines('row', 0, 2)).toBe(0);
    expect(s.hideLines('row', 0, 1)).toBe(2);
    expect(s.hideLines('col', 0, 1)).toBe(0);
  });

  it('moves the active cell off a hidden line, including after redo', () => {
    const s = makeSheet();
    s.selection.selectCell(3, 2);
    s.hideLines('row', 3, 4);
    expect(s.selection.activeRow).toBe(5);
    s.undo();
    s.selection.selectCell(3, 2);
    s.redo();
    expect(s.selection.activeRow).toBe(5);
    s.hideLines('col', 2, 2);
    expect(s.selection.activeCol).toBe(3);
  });

  it('hiding keeps data and formulas intact', () => {
    const s = makeSheet({ A1: 1, A2: 2, B1: '=A2*2' });
    s.hideLines('row', 1, 1);
    expect(value(s, 'B1')).toBe(4);
    expect(s.getCellByView(1, 0).value).toBe(2);
  });

  it('is stored in the snapshot as a zero size', async () => {
    const { serializeSheet, deserializeSheet } = await import('../../src/core/snapshot');
    const s = makeSheet({ A1: 1 });
    s.hideLines('col', 3, 4);
    const t = deserializeSheet(JSON.parse(JSON.stringify(serializeSheet(s))));
    expect(t.cols.getSize(3)).toBe(0);
    expect(t.cols.hiddenIn(0, 10)).toEqual([3, 4]);
  });
});

describe('navigation skips hidden lines', () => {
  function setup(hiddenRows: number[], hiddenCols: number[] = [], rowCount = 10, colCount = 6) {
    const ctx: NavContext = {
      rowCount,
      colCount,
      isEmpty: () => true,
      usedEnd: () => null,
      rowHidden: (r) => hiddenRows.includes(r),
      colHidden: (c) => hiddenCols.includes(c),
    };
    return { ctx, sel: new SelectionModel({ rowCount, colCount }) };
  }

  it('arrows step over hidden rows and columns, and stay put at the edge', () => {
    const { ctx, sel } = setup([1, 2], [1]);
    moveByArrow(sel, 'down', { extend: false, jump: false }, ctx);
    expect(sel.activeRow).toBe(3);
    moveByArrow(sel, 'up', { extend: false, jump: false }, ctx);
    expect(sel.activeRow).toBe(0);
    moveByArrow(sel, 'right', { extend: false, jump: false }, ctx);
    expect(sel.activeCol).toBe(2);
    const edge = setup([8, 9]);
    edge.sel.selectCell(7, 0);
    moveByArrow(edge.sel, 'down', { extend: false, jump: false }, edge.ctx);
    expect(edge.sel.activeRow).toBe(7);
  });

  it('Shift+arrow extends over the hidden lines without landing on one', () => {
    const { ctx, sel } = setup([1]);
    moveByArrow(sel, 'down', { extend: true, jump: false }, ctx);
    expect(sel.primary).toMatchObject({ startRow: 0, endRow: 2 });
  });

  it('Ctrl+arrow, paging and Home/End land on visible lines', () => {
    const { ctx, sel } = setup([9], [5]);
    moveByArrow(sel, 'down', { extend: false, jump: true }, ctx);
    expect(sel.activeRow).toBe(8);
    moveByArrow(sel, 'right', { extend: false, jump: true }, ctx);
    expect(sel.activeCol).toBe(4);
    moveToEdge(sel, 'end', { ctrl: false, extend: false }, ctx);
    expect(sel.activeCol).toBe(4);
    sel.selectCell(0, 0);
    moveByPage(sel, 'down', 9, false, ctx);
    expect(sel.activeRow).toBe(8);
  });

  it('Tab and Enter skip hidden cells, also inside a range', () => {
    const { ctx, sel } = setup([1], [1]);
    advanceActive(sel, { horizontal: true, backward: false }, ctx);
    expect(sel.activeCol).toBe(2);
    advanceActive(sel, { horizontal: false, backward: false }, ctx);
    expect(sel.activeRow).toBe(2);
    sel.selectCell(0, 0);
    sel.extendTo(2, 2);
    advanceActive(sel, { horizontal: true, backward: false }, ctx);
    expect([sel.activeRow, sel.activeCol]).toEqual([0, 2]); // column 1 is hidden
    advanceActive(sel, { horizontal: true, backward: false }, ctx);
    expect([sel.activeRow, sel.activeCol]).toEqual([2, 0]); // wraps over hidden row 1
  });

  it('a fully hidden range does not hang', () => {
    const { ctx, sel } = setup([0, 1, 2], [0, 1, 2], 10, 6);
    sel.selectCell(0, 0);
    sel.extendTo(2, 2);
    advanceActive(sel, { horizontal: true, backward: false }, ctx);
    expect(sel.activeRow).toBeGreaterThanOrEqual(0);
  });
});
