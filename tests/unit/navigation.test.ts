import { describe, expect, it } from 'vitest';
import {
  advanceActive,
  moveByArrow,
  moveByPage,
  moveToEdge,
  type NavContext,
} from '../../src/core/selection/navigation';
import { SelectionModel } from '../../src/core/selection/SelectionModel';

function setup(filled: string[], rowCount = 20, colCount = 10) {
  const set = new Set(filled);
  const ctx: NavContext = {
    rowCount,
    colCount,
    isEmpty: (r, c) => !set.has(`${r},${c}`),
    usedEnd: () => {
      if (set.size === 0) return null;
      let row = 0;
      let col = 0;
      for (const k of set) {
        const [r, c] = k.split(',').map(Number) as [number, number];
        row = Math.max(row, r);
        col = Math.max(col, c);
      }
      return { row, col };
    },
  };
  return { ctx, sel: new SelectionModel({ rowCount, colCount }) };
}

describe('arrow movement', () => {
  it('moves one cell and stops at the edges', () => {
    const { ctx, sel } = setup([]);
    moveByArrow(sel, 'down', { extend: false, jump: false }, ctx);
    moveByArrow(sel, 'right', { extend: false, jump: false }, ctx);
    expect([sel.activeRow, sel.activeCol]).toEqual([1, 1]);
    moveByArrow(sel, 'up', { extend: false, jump: false }, ctx);
    moveByArrow(sel, 'up', { extend: false, jump: false }, ctx);
    expect(sel.activeRow).toBe(0);
  });

  it('extends the focus corner with shift', () => {
    const { ctx, sel } = setup([]);
    moveByArrow(sel, 'down', { extend: true, jump: false }, ctx);
    moveByArrow(sel, 'down', { extend: true, jump: false }, ctx);
    moveByArrow(sel, 'right', { extend: true, jump: false }, ctx);
    expect(sel.primary).toEqual({ startRow: 0, startCol: 0, endRow: 2, endCol: 1 });
    expect([sel.activeRow, sel.activeCol]).toEqual([0, 0]);
  });
});

describe('ctrl+arrow jumps', () => {
  const data = ['2,0', '3,0', '4,0', '8,0'];

  it('runs to the end of a block from inside it', () => {
    const { ctx, sel } = setup(data);
    sel.selectCell(2, 0);
    moveByArrow(sel, 'down', { extend: false, jump: true }, ctx);
    expect(sel.activeRow).toBe(4);
  });

  it('goes to the next filled cell from the end of a block or an empty cell', () => {
    const { ctx, sel } = setup(data);
    sel.selectCell(4, 0);
    moveByArrow(sel, 'down', { extend: false, jump: true }, ctx);
    expect(sel.activeRow).toBe(8);
    sel.selectCell(0, 0);
    moveByArrow(sel, 'down', { extend: false, jump: true }, ctx);
    expect(sel.activeRow).toBe(2);
  });

  it('goes to the edge when nothing follows', () => {
    const { ctx, sel } = setup(data);
    sel.selectCell(8, 0);
    moveByArrow(sel, 'down', { extend: false, jump: true }, ctx);
    expect(sel.activeRow).toBe(19);
    moveByArrow(sel, 'right', { extend: false, jump: true }, ctx);
    expect(sel.activeCol).toBe(9);
    moveByArrow(sel, 'left', { extend: false, jump: true }, ctx);
    expect(sel.activeCol).toBe(0);
    moveByArrow(sel, 'up', { extend: false, jump: true }, ctx);
    expect(sel.activeRow).toBe(8);
  });

  it('extends the selection with shift', () => {
    const { ctx, sel } = setup(data);
    sel.selectCell(2, 0);
    moveByArrow(sel, 'down', { extend: true, jump: true }, ctx);
    expect(sel.primary).toMatchObject({ startRow: 2, endRow: 4 });
  });
});

describe('page, home, end', () => {
  it('pages by a given number of rows, clamped', () => {
    const { sel } = setup([]);
    moveByPage(sel, 'down', 7, false);
    expect(sel.activeRow).toBe(7);
    moveByPage(sel, 'down', 50, false);
    expect(sel.activeRow).toBe(19);
    moveByPage(sel, 'up', 5, true);
    expect(sel.primary).toMatchObject({ startRow: 14, endRow: 19 });
  });

  it('home/end stay on the row, ctrl variants jump to the sheet corners', () => {
    const { ctx, sel } = setup(['5,3', '9,7']);
    sel.selectCell(4, 4);
    moveToEdge(sel, 'end', { ctrl: false, extend: false }, ctx);
    expect([sel.activeRow, sel.activeCol]).toEqual([4, 9]);
    moveToEdge(sel, 'home', { ctrl: false, extend: false }, ctx);
    expect([sel.activeRow, sel.activeCol]).toEqual([4, 0]);
    moveToEdge(sel, 'end', { ctrl: true, extend: false }, ctx);
    expect([sel.activeRow, sel.activeCol]).toEqual([9, 7]);
    moveToEdge(sel, 'home', { ctrl: true, extend: false }, ctx);
    expect([sel.activeRow, sel.activeCol]).toEqual([0, 0]);
  });
});

describe('Tab / Enter', () => {
  it('moves one step with a single cell', () => {
    const { sel } = setup([]);
    advanceActive(sel, { horizontal: true, backward: false });
    advanceActive(sel, { horizontal: false, backward: false });
    expect([sel.activeRow, sel.activeCol]).toEqual([1, 1]);
    advanceActive(sel, { horizontal: false, backward: true });
    expect(sel.activeRow).toBe(0);
  });

  it('cycles inside a multi-cell range without changing it', () => {
    const { sel } = setup([]);
    sel.selectCell(1, 1);
    sel.extendTo(2, 2);
    advanceActive(sel, { horizontal: true, backward: false });
    expect([sel.activeRow, sel.activeCol]).toEqual([1, 2]);
    advanceActive(sel, { horizontal: true, backward: false });
    expect([sel.activeRow, sel.activeCol]).toEqual([2, 1]);
    advanceActive(sel, { horizontal: false, backward: false });
    expect([sel.activeRow, sel.activeCol]).toEqual([1, 2]); // wraps to the top of the next column
    expect(sel.primary).toEqual({ startRow: 1, startCol: 1, endRow: 2, endCol: 2 });
  });

  it('wraps around at the end of the range, both ways', () => {
    const { sel } = setup([]);
    sel.selectCell(1, 1);
    sel.extendTo(2, 2);
    sel.setActive(2, 2);
    advanceActive(sel, { horizontal: true, backward: false });
    expect([sel.activeRow, sel.activeCol]).toEqual([1, 1]);
    advanceActive(sel, { horizontal: true, backward: true });
    expect([sel.activeRow, sel.activeCol]).toEqual([2, 2]);
  });
});
