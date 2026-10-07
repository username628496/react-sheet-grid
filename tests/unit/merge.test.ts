import { describe, expect, it } from 'vitest';
import { MergeTable } from '../../src/core/model/MergeTable';
import { deserializeSheet, SnapshotError, serializeSheet } from '../../src/core/snapshot';
import type { SheetNotice } from '../../src/core/Spreadsheet';
import { moveByArrow, advanceActive } from '../../src/core/selection/navigation';
import { makeSheet, value } from './formula/helpers';

const nav = (s: ReturnType<typeof makeSheet>) => ({ rowCount: s.rowCount, colCount: s.colCount, isEmpty: () => true, usedEnd: () => null });
const table = (...regions: Array<[number, number, number, number]>): MergeTable => {
  const t = new MergeTable();
  t.set(regions.map(([row, col, rowSpan, colSpan]) => ({ row, col, rowSpan, colSpan })));
  return t;
};
const list = (t: MergeTable): number[][] => t.all.map((m) => [m.row, m.col, m.rowSpan, m.colSpan]);

describe('MergeTable', () => {
  it('finds the region at any of its cells', () => {
    const t = table([2, 2, 2, 3]);
    expect(t.regionAt(3, 4)?.row).toBe(2);
    expect(t.regionAt(4, 2)).toBeUndefined();
    expect(t.regionAt(2, 5)).toBeUndefined();
  });

  it('expands a range to whole regions, transitively', () => {
    // The first block sticks out below the range, which brings the second one into it.
    const t = table([1, 0, 2, 1], [2, 2, 2, 2]);
    expect(t.expand({ startRow: 0, startCol: 0, endRow: 1, endCol: 3 })).toEqual({ startRow: 0, startCol: 0, endRow: 3, endCol: 3 });
    expect(t.expand({ startRow: 0, startCol: 0, endRow: 0, endCol: 3 })).toEqual({ startRow: 0, startCol: 0, endRow: 0, endCol: 3 });
    const r = { startRow: 8, startCol: 8, endRow: 9, endCol: 9 };
    expect(t.expand(r)).toBe(r);
  });

  it('inserting rows moves, grows or leaves a region', () => {
    const cases: Array<[number, number, number[]]> = [
      [0, 2, [4, 1, 3, 2]], // above: moves down
      [4, 2, [2, 1, 5, 2]], // at its last row: opens inside, grows
      [3, 2, [2, 1, 5, 2]], // inside: grows
      [2, 1, [3, 1, 3, 2]], // at its first row: moves (the insert is above it)
      [5, 1, [2, 1, 3, 2]], // just below its last row: untouched
    ];
    for (const [at, count, expected] of cases) {
      const t = table([2, 1, 3, 2]);
      t.shift('row', 'insert', at, count);
      expect(list(t)[0], `insert ${count} at ${at}`).toEqual(expected);
    }
  });

  it('deleting rows moves, shrinks or removes a region', () => {
    const cases: Array<[number, number, number[] | undefined]> = [
      [0, 1, [1, 1, 3, 2]],
      [6, 2, [2, 1, 3, 2]],
      [3, 1, [2, 1, 2, 2]], // from the middle
      [1, 2, [1, 1, 2, 2]], // overlapping the top
      [4, 5, [2, 1, 2, 2]], // overlapping the bottom
      [2, 3, undefined], // all of it
    ];
    for (const [at, count, expected] of cases) {
      const t = table([2, 1, 3, 2]);
      t.shift('row', 'delete', at, count);
      expect(list(t)[0], `delete ${count} at ${at}`).toEqual(expected);
    }
  });

  it('a region reduced to one cell stops being a merge', () => {
    const t = table([0, 0, 2, 1]);
    t.shift('row', 'delete', 1, 1);
    expect(t.size).toBe(0);
    const u = table([0, 0, 1, 3]);
    u.shift('col', 'delete', 0, 2);
    expect(u.size).toBe(0);
  });

  it('columns work the same way', () => {
    const t = table([0, 3, 1, 3]);
    t.shift('col', 'insert', 4, 2);
    expect(list(t)[0]).toEqual([0, 3, 1, 5]);
    t.shift('col', 'delete', 0, 1);
    expect(list(t)[0]).toEqual([0, 2, 1, 5]);
  });
});

describe('Spreadsheet merging', () => {
  function merged() {
    const s = makeSheet({ B2: 'keep', C2: 'drop', B3: 5, C3: 6 });
    s.selection.selectCell(1, 1);
    s.selection.extendTo(2, 2);
    expect(s.mergeSelection()).toBe(true);
    return s;
  }

  it('keeps the top-left content, empties the rest, and selects the block; undo restores everything', () => {
    const s = merged();
    expect(value(s, 'B2')).toBe('keep');
    expect(value(s, 'C2')).toBeNull();
    expect(value(s, 'B3')).toBeNull();
    expect(s.merges.regionAt(2, 2)).toEqual({ row: 1, col: 1, rowSpan: 2, colSpan: 2 });
    expect(s.selection.primary).toEqual({ startRow: 1, startCol: 1, endRow: 2, endCol: 2 });
    s.undo();
    expect(s.merges.size).toBe(0);
    expect([value(s, 'C2'), value(s, 'B3'), value(s, 'C3')]).toEqual(['drop', 5, 6]);
    s.redo();
    expect(s.merges.size).toBe(1);
    expect(value(s, 'C3')).toBeNull();
  });

  it('merging needs more than one cell, and is refused on a read-only sheet', () => {
    const s = makeSheet({});
    s.selection.selectCell(1, 1);
    expect(s.canMerge()).toBe(false);
    s.selection.extendTo(1, 2);
    s.readOnly = true;
    expect(s.mergeSelection()).toBe(false);
  });

  it('clicking a covered cell selects the whole block with the anchor active', () => {
    const s = merged();
    s.selection.selectCell(5, 5);
    s.selection.selectCell(2, 2);
    expect([s.selection.activeRow, s.selection.activeCol]).toEqual([1, 1]);
    expect(s.selection.primary).toEqual({ startRow: 1, startCol: 1, endRow: 2, endCol: 2 });
  });

  it('a drag that touches a block grows to cover it', () => {
    const s = merged();
    s.selection.selectCell(0, 0);
    s.selection.extendTo(1, 1);
    expect(s.selection.primary).toEqual({ startRow: 0, startCol: 0, endRow: 2, endCol: 2 });
  });

  it('arrow keys step over the block', () => {
    const s = merged();
    const n = nav(s);
    s.selection.selectCell(1, 1);
    moveByArrow(s.selection, 'down', { extend: false, jump: false }, n);
    expect([s.selection.activeRow, s.selection.activeCol]).toEqual([3, 1]);
    moveByArrow(s.selection, 'up', { extend: false, jump: false }, n);
    expect([s.selection.activeRow, s.selection.activeCol]).toEqual([1, 1]); // lands in the block: its anchor
    moveByArrow(s.selection, 'right', { extend: false, jump: false }, n);
    expect([s.selection.activeRow, s.selection.activeCol]).toEqual([1, 3]);
    moveByArrow(s.selection, 'left', { extend: false, jump: false }, n);
    expect([s.selection.activeRow, s.selection.activeCol]).toEqual([1, 1]);
  });

  it('Enter and Tab step over the block as well', () => {
    const s = merged();
    s.selection.selectCell(1, 1);
    advanceActive(s.selection, { horizontal: false, backward: false });
    expect([s.selection.activeRow, s.selection.activeCol]).toEqual([3, 1]);
    s.selection.selectCell(1, 1);
    advanceActive(s.selection, { horizontal: true, backward: false });
    expect([s.selection.activeRow, s.selection.activeCol]).toEqual([1, 3]);
  });

  it('unmerge splits the block back into cells; a second call does nothing', () => {
    const s = merged();
    expect(s.hasMergeInSelection()).toBe(true);
    expect(s.unmergeSelection()).toBe(true);
    expect(s.merges.size).toBe(0);
    expect(s.unmergeSelection()).toBe(false);
    s.undo();
    expect(s.merges.size).toBe(1);
  });

  it('merging over blocks absorbs them', () => {
    const s = merged();
    s.selection.selectCell(0, 0);
    s.selection.extendTo(4, 4);
    expect(s.mergeSelection()).toBe(true);
    expect(s.merges.all).toEqual([{ row: 0, col: 0, rowSpan: 5, colSpan: 5 }]);
  });

  it('sorting and filtering are refused while merged, with a notice', () => {
    const s = merged();
    const notices: SheetNotice[] = [];
    s.subscribeNotices((n) => notices.push(n));
    s.sortByColumn(0, true);
    s.setColumnFilter(0, new Set(['x']));
    expect(s.mapping.isIdentity).toBe(true);
    expect(notices).toEqual([{ code: 'mergeConflict' }, { code: 'mergeConflict' }]);
    s.unmergeSelection();
    s.sortByColumn(0, true);
    expect(s.viewState.sort).not.toBeNull();
  });

  it('merging a sorted sheet is refused', () => {
    const s = makeSheet({ A1: 2, A2: 1 });
    s.sortByColumn(0, true);
    s.selection.selectCell(0, 0);
    s.selection.extendTo(1, 1);
    expect(s.mergeSelection()).toBe(false);
    expect(s.merges.size).toBe(0);
  });

  it('inserting and deleting rows moves the block, and undo puts it back', () => {
    const s = merged();
    s.insertRows(0, 2);
    expect(s.merges.all).toEqual([{ row: 3, col: 1, rowSpan: 2, colSpan: 2 }]);
    s.undo();
    expect(s.merges.all).toEqual([{ row: 1, col: 1, rowSpan: 2, colSpan: 2 }]);
    s.deleteRows(1, 1);
    expect(s.merges.all).toEqual([{ row: 1, col: 1, rowSpan: 1, colSpan: 2 }]);
    s.undo();
    expect(s.merges.all).toEqual([{ row: 1, col: 1, rowSpan: 2, colSpan: 2 }]);
  });

  it('survives a snapshot round trip and rejects bad ones', () => {
    const s = merged();
    const snap = JSON.parse(JSON.stringify(serializeSheet(s)));
    expect(snap.merges).toEqual([[1, 1, 2, 2]]);
    expect(deserializeSheet(snap).merges.all).toEqual([{ row: 1, col: 1, rowSpan: 2, colSpan: 2 }]);
    const bad = (merges: unknown): void => expect(() => deserializeSheet({ ...snap, merges })).toThrow(SnapshotError);
    bad([[1, 1, 1, 1]]);
    bad([[1, 1, 2, 2], [2, 2, 2, 2]]);
    bad([[999999, 1, 2, 2]]);
    bad([[0, 0, 0, 3]]);
    bad('x');
  });
});
