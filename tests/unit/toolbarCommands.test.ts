import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../../src/react/messages';
import { buildCommands, type Command, fold, matchCommands, rememberCommand } from '../../src/react/toolbarCommands';
import { makeSheet } from './formula/helpers';

const c = (id: string, label: string, group = 'Group', disabled = false): Command => ({ id, label, group, disabled, run: () => {} });

describe('fold', () => {
  it('drops accents and case, and treats đ as d', () => {
    expect(fold('Định dạng Số')).toBe('dinh dang so');
    expect(fold('Ơ ư Ê')).toBe('o u e');
  });
});

describe('matchCommands', () => {
  const commands = [c('a', 'Bold'), c('b', 'Borders: All', 'Borders'), c('c', 'Insert 1 row above', 'Insert'), c('d', 'Format as bold text', 'Number'), c('e', 'Undo', 'History', true)];

  it('needs every word, in the name or the group, ignoring case', () => {
    expect(matchCommands(commands, 'insert row').map((x) => x.id)).toEqual(['c']);
    expect(matchCommands(commands, 'BORDER all').map((x) => x.id)).toEqual(['b']);
    expect(matchCommands(commands, 'zzz')).toEqual([]);
  });

  it('ranks names that start with the query, then word starts, then other substrings', () => {
    // "Insert 1 row above" has "bo" inside a word ("above"), so it comes last.
    expect(matchCommands(commands, 'bo').map((x) => x.id)).toEqual(['a', 'b', 'd', 'c']);
    expect(matchCommands(commands, 'old').map((x) => x.id)).toEqual(['a', 'd']);
  });

  it('finds Vietnamese names without accents', () => {
    const vi = [c('x', 'Định dạng số'), c('y', 'Đồng')];
    expect(matchCommands(vi, 'dinh dang').map((x) => x.id)).toEqual(['x']);
    expect(matchCommands(vi, 'dong').map((x) => x.id)).toEqual(['y']);
  });

  it('puts recently used commands first within a rank, and disabled ones last', () => {
    // Both names start with "bo" (rank 0): the recent one wins. "bold" starts a word of the third (rank 1), "above" is inside one (rank 2).
    expect(matchCommands(commands, 'bo', ['d', 'b']).map((x) => x.id)).toEqual(['b', 'a', 'd', 'c']);
    expect(matchCommands(commands, '').map((x) => x.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(matchCommands(commands, '', ['d']).map((x) => x.id)).toEqual(['d', 'a', 'b', 'c', 'e']);
    expect(matchCommands(commands, 'undo').map((x) => x.disabled)).toEqual([true]);
  });
});

describe('rememberCommand', () => {
  it('moves to the front, without duplicates, and is bounded', () => {
    expect(rememberCommand(['a', 'b', 'c'], 'c')).toEqual(['c', 'a', 'b']);
    expect(rememberCommand(['a'], 'z')).toEqual(['z', 'a']);
    expect(rememberCommand(['1', '2', '3'], '4', 3)).toEqual(['4', '1', '2']);
  });
});

describe('buildCommands', () => {
  const build = (sheet = makeSheet({ A1: 5 })) => buildCommands({ sheet, grid: null, m: MESSAGES.en, fileEntries: [] });
  const by = (list: Command[], label: string) => list.find((x) => x.label === label)!;

  it('lists every toolbar action once, with stable ids', () => {
    const list = build();
    const ids = list.map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ['undo', 'redo', 'bold', 'merge', 'sortAsc', 'validation', 'conditional', 'currency', 'alignLeft']) expect(ids).toContain(id);
    expect(ids.some((id) => id.startsWith('insert:'))).toBe(true);
    expect(ids.some((id) => id.startsWith('borders:'))).toBe(true);
  });

  it('runs the same code as the buttons', () => {
    const sheet = makeSheet({ A1: 5 });
    sheet.selection.selectCell(0, 0);
    by(build(sheet), 'Bold').run();
    expect(sheet.styles.get(sheet.getCellByView(0, 0).styleId).bold).toBe(true);
    expect(by(build(sheet), 'Bold').checked).toBe(true);
    sheet.selection.selectCell(2, 0);
    sheet.selection.extendTo(3, 0);
    by(build(sheet), 'Insert 2 rows above').run();
    expect(sheet.getCellByView(0, 0).value).toBe(5);
    expect(sheet.rowCount).toBe(1002);
  });

  it('knows what is not possible now', () => {
    const sheet = makeSheet({ A1: 5 });
    sheet.history.clear(); // makeSheet typed a value, which is an undo step
    sheet.selection.selectCell(0, 0);
    let list = build(sheet);
    expect(by(list, 'Undo').disabled).toBe(true);
    expect(by(list, 'Merge cells').disabled).toBe(true); // one cell
    sheet.selection.extendTo(1, 1);
    sheet.setCellInput(0, 0, '7');
    list = build(sheet);
    expect(by(list, 'Undo').disabled).toBe(false);
    expect(by(list, 'Merge cells').disabled).toBe(false);
    sheet.mergeSelection();
    expect(by(build(sheet), 'Unmerge cells').checked).toBe(true);
  });

  it('disables everything that changes the document on a read-only sheet, but not viewing', () => {
    const sheet = makeSheet({ A1: 5 });
    sheet.readOnly = true;
    const list = build(sheet);
    expect(by(list, 'Bold').disabled).toBe(true);
    expect(by(list, 'Insert 1 row above').disabled).toBe(true);
    expect(by(list, MESSAGES.en.sortAsc).disabled).toBe(false);
    expect(by(list, 'Copy').disabled).toBe(true); // no grid in this test: needs the clipboard
    expect(list.find((x) => x.id.startsWith('freeze:'))!.disabled).toBe(false);
  });
});
