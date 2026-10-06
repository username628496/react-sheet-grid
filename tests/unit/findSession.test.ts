import { describe, expect, it } from 'vitest';
import { FindSession, type FindHost } from '../../src/input/FindSession';
import { addr, makeSheet, value } from './formula/helpers';

function setup(cells: Record<string, string | number>) {
  const sheet = makeSheet(cells);
  const scrolled: Array<[number, number]> = [];
  let repaints = 0;
  const host: FindHost = {
    scrollCellIntoView: (r, c) => scrolled.push([r, c]),
    invalidate: () => repaints++,
  };
  const session = new FindSession(sheet, host);
  return { sheet, session, scrolled, repaints: () => repaints };
}

const active = (s: ReturnType<typeof setup>): string => `${s.sheet.selection.activeRow},${s.sheet.selection.activeCol}`;

describe('FindSession', () => {
  it('finds as you type, jumping to the first match at or after the active cell', () => {
    const t = setup({ A1: 'cat', A3: 'cat', C2: 'cat' });
    t.sheet.selection.selectCell(...addr('A2'));
    t.session.show(false);
    t.session.update({ query: 'cat' });
    expect(t.session.getSnapshot().count).toBe(3);
    expect(active(t)).toBe('1,2'); // C2 comes first in reading order after A2
    expect(t.scrolled.at(-1)).toEqual([1, 2]);
  });

  it('next and previous wrap around and keep the count and position', () => {
    const t = setup({ A1: 'x', A2: 'x', A3: 'x' });
    t.session.show(false);
    t.session.update({ query: 'x' });
    expect(t.session.getSnapshot().index).toBe(0);
    t.session.next();
    t.session.next();
    expect(active(t)).toBe('2,0');
    t.session.next();
    expect(t.session.getSnapshot().index).toBe(0);
    t.session.previous();
    expect(t.session.getSnapshot().index).toBe(2);
    expect(t.session.getSnapshot().count).toBe(3);
  });

  it('highlights matches while open and clears them on close', () => {
    const t = setup({ A1: 'x', B2: 'x', C3: 'y' });
    t.session.show(false);
    t.session.update({ query: 'x' });
    expect(t.session.isMatch(0, 0)).toBe(true);
    expect(t.session.isMatch(1, 1)).toBe(true);
    expect(t.session.isMatch(2, 2)).toBe(false);
    expect(t.session.isCurrent(0, 0)).toBe(true);
    expect(t.session.isCurrent(1, 1)).toBe(false);
    t.session.hide();
    expect(t.session.isMatch(0, 0)).toBe(false);
    expect(t.session.getSnapshot().open).toBe(false);
  });

  it('prefills the query from a single selected cell, and offers the selection as a scope when several are selected', () => {
    const t = setup({ A1: 'needle', B1: 'needle', C1: 'other' });
    t.sheet.selection.selectCell(...addr('A1'));
    t.session.show(false);
    expect(t.session.getSnapshot().settings.query).toBe('needle');
    expect(t.session.getSnapshot().scopeRange).toBeNull();
    t.session.hide();
    t.sheet.selection.selectCell(...addr('B1'));
    t.sheet.selection.extendTo(...addr('C1'));
    t.session.show(false);
    expect(t.session.getSnapshot().scopeRange).toEqual({ startRow: 0, startCol: 1, endRow: 0, endCol: 2 });
    t.session.update({ query: 'needle', scope: 'selection' });
    expect(t.session.getSnapshot().count).toBe(1);
    t.session.update({ scope: 'sheet' });
    expect(t.session.getSnapshot().count).toBe(2);
  });

  it('replace goes cell by cell and moves to the next match', () => {
    const t = setup({ A1: 'red apple', A2: 'green apple', A3: 'apple' });
    t.session.show(true);
    t.session.update({ query: 'apple', replacement: 'plum' });
    t.session.replaceCurrent();
    expect(value(t.sheet, 'A1')).toBe('red plum');
    expect(active(t)).toBe('1,0'); // moved on to the next match
    expect(t.session.getSnapshot().replaced).toEqual({ occurrences: 1, cells: 1 });
    t.session.replaceCurrent();
    expect(value(t.sheet, 'A2')).toBe('green plum');
    expect(value(t.sheet, 'A3')).toBe('apple');
    expect(active(t)).toBe('2,0');
  });

  it('replace all is one undo step and reports what it did', () => {
    const t = setup({ A1: 'a-b', A2: 'c-d-e', A3: 'none' });
    t.session.show(true);
    t.session.update({ query: '-', replacement: '+' });
    t.session.replaceAll();
    expect([value(t.sheet, 'A1'), value(t.sheet, 'A2'), value(t.sheet, 'A3')]).toEqual(['a+b', 'c+d+e', 'none']);
    expect(t.session.getSnapshot().replaced).toEqual({ occurrences: 3, cells: 2 });
    expect(t.session.getSnapshot().count).toBe(0);
    t.sheet.undo();
    expect([value(t.sheet, 'A1'), value(t.sheet, 'A2')]).toEqual(['a-b', 'c-d-e']);
  });

  it('a replacement that still contains the query does not loop or re-replace', () => {
    const t = setup({ A1: 'a', A2: 'a' });
    t.session.show(true);
    t.session.update({ query: 'a', replacement: 'aa' });
    t.session.replaceAll();
    expect([value(t.sheet, 'A1'), value(t.sheet, 'A2')]).toEqual(['aa', 'aa']);
    t.session.replaceCurrent();
    expect(value(t.sheet, 'A1')).toBe('aaaa'); // one more replace, one cell, no runaway
    expect(value(t.sheet, 'A2')).toBe('aa');
  });

  it('keeps the matches in step with later edits, once they settle', async () => {
    const t = setup({ A1: 'x' });
    t.session.show(false);
    t.session.update({ query: 'x' });
    expect(t.session.getSnapshot().count).toBe(1);
    t.sheet.setCellInput(1, 0, 'x');
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(t.session.getSnapshot().count).toBe(2);
    t.session.hide();
    t.sheet.setCellInput(2, 0, 'x');
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(t.session.getSnapshot().count).toBe(0); // closed: no more work
  });

  it('options change the results; no matches means index -1 and navigation does nothing', () => {
    const t = setup({ A1: 'Việt', A2: 'viet' });
    t.session.show(false);
    t.session.update({ query: 'viet' });
    expect(t.session.getSnapshot().count).toBe(1);
    t.session.update({ ignoreAccents: true });
    expect(t.session.getSnapshot().count).toBe(2);
    t.session.update({ matchCase: true });
    expect(t.session.getSnapshot().count).toBe(1); // case now matters: "Việt" starts with a capital V, only "viet" matches
    t.session.update({ query: 'zzz' });
    expect(t.session.getSnapshot().index).toBe(-1);
    t.session.next();
    t.session.previous();
    expect(t.session.getSnapshot().index).toBe(-1);
  });

  it('read-only sheets cannot replace', () => {
    const t = setup({ A1: 'x' });
    t.sheet.readOnly = true;
    t.session.show(true);
    t.session.update({ query: 'x', replacement: 'y' });
    t.session.replaceAll();
    expect(value(t.sheet, 'A1')).toBe('x');
  });

  it('subscribers hear about every change and the snapshot is stable between them', () => {
    const t = setup({ A1: 'x' });
    let calls = 0;
    t.session.subscribe(() => calls++);
    t.session.show(false);
    const a = t.session.getSnapshot();
    expect(t.session.getSnapshot()).toBe(a);
    t.session.update({ query: 'x' });
    expect(calls).toBeGreaterThan(0);
    expect(t.session.getSnapshot()).not.toBe(a);
  });
});
