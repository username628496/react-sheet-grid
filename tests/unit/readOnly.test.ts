import { describe, expect, it } from 'vitest';
import { Spreadsheet } from '../../src/core/Spreadsheet';
import { addr, makeSheet, set, value } from './formula/helpers';

describe('readOnly', () => {
  it('blocks every change to the document', () => {
    const s = makeSheet({ A1: 'keep', A2: 2 });
    s.readOnly = true;
    set(s, 'A1', 'changed');
    set(s, 'B1', 'new');
    s.selection.selectCell(...addr('A1'));
    s.toggleStyle('bold');
    s.formatSelection({ color: '#ff0000' });
    s.clearSelection();
    s.insertRows(0, 1);
    s.insertCols(0, 1);
    s.deleteRows(0, 1);
    s.setRowCount(5);
    s.setColCount(3);
    s.pasteText([['x']]);
    s.fillSelectionWithInput('z');
    s.insertFunction('SUM');
    expect(value(s, 'A1')).toBe('keep');
    expect(s.model.hasCell(...addr('B1'))).toBe(false);
    expect(s.styles.get(s.getCellByView(0, 0).styleId)).toEqual({});
    expect([s.rowCount, s.colCount]).toEqual([1000, 26]);
    expect(s.history.canUndo).toBe(true); // only what was done before readOnly was set: here the seed edits
    const before = s.revision;
    set(s, 'A3', 'nope');
    expect(s.revision).toBe(before);
  });

  it('blocks undo and redo, and works again once switched off', () => {
    const s = makeSheet({ A1: 1 });
    s.readOnly = true;
    expect(s.undo()).toBe(false);
    expect(value(s, 'A1')).toBe(1);
    s.readOnly = false;
    expect(s.undo()).toBe(true);
    expect(value(s, 'A1')).toBeNull();
    s.redo();
    set(s, 'A1', 5);
    expect(value(s, 'A1')).toBe(5);
  });

  it('still allows changing the view: sort, filter, sizes, hiding, freezing, selection', () => {
    const s = makeSheet({ A1: 3, A2: 1, A3: 2 });
    s.readOnly = true;
    s.sortByColumn(0, true);
    expect([0, 1, 2].map((r) => s.getCellByView(r, 0).value)).toEqual([1, 2, 3]);
    s.setColumnFilter(0, new Set(['1', '2']));
    expect(s.rowCount).toBeLessThan(1000);
    s.clearFilters();
    s.cols.setSize(1, 150);
    expect(s.hideLines('row', 5, 6)).toBe(2);
    s.setFrozen(1, 1);
    expect([s.frozenRows, s.frozenCols]).toEqual([1, 1]);
    s.selection.selectCell(2, 2);
    expect(s.selection.activeRow).toBe(2);
  });

  it('notifies listeners when toggled', () => {
    const s = new Spreadsheet();
    let calls = 0;
    s.subscribe(() => calls++);
    s.readOnly = true;
    s.readOnly = true;
    s.readOnly = false;
    expect(calls).toBe(2);
  });
});

describe('revision and subscribeChanges', () => {
  it('moves with edits, undo, redo and freezing, and not with selection or scrolling', () => {
    const s = makeSheet();
    const start = s.revision;
    s.selection.selectCell(3, 3);
    s.selection.extendTo(5, 5);
    expect(s.revision).toBe(start);
    set(s, 'A1', 1);
    const afterEdit = s.revision;
    expect(afterEdit).toBeGreaterThan(start);
    s.undo();
    expect(s.revision).toBeGreaterThan(afterEdit);
    s.redo();
    const beforeFreeze = s.revision;
    s.setFrozen(1, 0);
    expect(s.revision).toBeGreaterThan(beforeFreeze);
    const afterFreeze = s.revision;
    s.setFrozen(1, 0); // same value: nothing changed
    expect(s.revision).toBe(afterFreeze);
  });

  it('subscribeChanges ignores selection moves and reports each change once', () => {
    const s = makeSheet();
    let calls = 0;
    const off = s.subscribeChanges(() => calls++);
    s.selection.selectCell(2, 2);
    s.notify();
    expect(calls).toBe(0);
    set(s, 'A1', 1);
    expect(calls).toBe(1);
    s.selection.selectCell(3, 3);
    expect(calls).toBe(1);
    s.setFrozen(2, 0);
    s.undo();
    expect(calls).toBe(3);
    off();
    set(s, 'A2', 2);
    expect(calls).toBe(3);
  });
});
