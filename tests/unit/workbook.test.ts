import { describe, expect, it } from 'vitest';
import { parseFormula } from '../../src/formula/parser';
import { printFormula } from '../../src/formula/print';
import { deserializeWorkbook, serializeWorkbook } from '../../src/core/workbookSnapshot';
import { SnapshotError } from '../../src/core/snapshot';
import { Workbook } from '../../src/core/Workbook';

/** A workbook of `names.length` small sheets named as given. */
function book(...names: string[]): Workbook {
  const wb = new Workbook();
  wb.active.name = names[0] ?? 'Sheet1';
  for (const name of names.slice(1)) wb.addSheet({ name, rowCount: 30, colCount: 10 });
  wb.setActive(0);
  return wb;
}
const at = (wb: Workbook, sheet: string, a1: string): unknown => {
  const s = wb.sheetByName(sheet)!;
  const m = /^([A-Z]+)(\d+)$/.exec(a1)!;
  return s.getCellByView(Number(m[2]) - 1, (m[1] as string).charCodeAt(0) - 65).value;
};
const put = (wb: Workbook, sheet: string, a1: string, text: string): void => {
  const s = wb.sheetByName(sheet)!;
  const m = /^([A-Z]+)(\d+)$/.exec(a1)!;
  s.setCellInput(Number(m[2]) - 1, (m[1] as string).charCodeAt(0) - 65, text);
};

describe('sheet references in formulas', () => {
  it('parse and print round trip, quoting names that need it', () => {
    for (const f of ['=Sheet2!A1', '=Sheet2!$B$2:C3', "='My sheet'!A1", "='It''s'!A1+1", '=SUM(Data!A:A)', "='A1'!B2", "='Bảng 1'!A1"]) {
      expect(printFormula(parseFormula(f, 0, 0), 0, 0), f).toBe(f);
    }
    expect(printFormula(parseFormula("='Sheet2'!A1", 0, 0), 0, 0)).toBe('=Sheet2!A1');
  });

  it('relative references stay relative to the formula cell', () => {
    const e = parseFormula('=Other!B3', 4, 4);
    expect(printFormula(e, 4, 4)).toBe('=Other!B3');
    expect(printFormula(e, 5, 5)).toBe('=Other!C4');
  });

  it('reject a sheet qualifier on something that is not a reference', () => {
    expect(() => parseFormula('=Sheet2!5', 0, 0)).toThrow();
    expect(() => parseFormula("='Sheet2'+1", 0, 0)).toThrow();
  });
});

describe('Workbook basics', () => {
  it('starts with one sheet; names are unique, validated, case-insensitive', () => {
    const wb = book('Data', 'Totals');
    expect(wb.sheets.map((s) => s.name)).toEqual(['Data', 'Totals']);
    expect(wb.nameProblem('data')).toBe('duplicate');
    expect(wb.nameProblem('  ')).toBe('empty');
    expect(wb.nameProblem('a/b')).toBe('invalid');
    expect(wb.nameProblem("'x")).toBe('invalid');
    expect(wb.nameProblem('x'.repeat(51))).toBe('tooLong');
    expect(wb.nameProblem('data', wb.sheets[0])).toBeNull(); // renaming a sheet to its own name is fine
    expect(wb.uniqueName()).toBe('Sheet3');
  });

  it('adds after the active sheet and activates it', () => {
    const wb = book('A', 'B');
    wb.setActive(0);
    const c = wb.addSheet({ name: 'C' })!;
    expect(wb.sheets.map((s) => s.name)).toEqual(['A', 'C', 'B']);
    expect(wb.active).toBe(c);
  });

  it('moves sheets and keeps the active one active', () => {
    const wb = book('A', 'B', 'C');
    wb.setActive(2);
    wb.moveSheet(wb.sheetByName('C')!, 0);
    expect(wb.sheets.map((s) => s.name)).toEqual(['C', 'A', 'B']);
    expect(wb.active.name).toBe('C');
    wb.moveSheet(wb.sheetByName('A')!, 99);
    expect(wb.sheets.map((s) => s.name)).toEqual(['C', 'B', 'A']);
    expect(wb.active.name).toBe('C');
  });

  it('never deletes the last sheet; deleting before the active one keeps it active', () => {
    const wb = book('A', 'B', 'C');
    wb.setActive(2);
    expect(wb.deleteSheet(wb.sheetByName('A')!)).toBe(true);
    expect(wb.active.name).toBe('C');
    wb.deleteSheet(wb.sheetByName('B')!);
    expect(wb.deleteSheet(wb.sheetByName('C')!)).toBe(false);
    expect(wb.sheets).toHaveLength(1);
  });

  it('read-only blocks the sheet-level actions and every sheet', () => {
    const wb = book('A', 'B');
    wb.readOnly = true;
    expect(wb.addSheet()).toBeNull();
    expect(wb.renameSheet(wb.sheets[0] as never, 'Z')).toBe(false);
    expect(wb.deleteSheet(wb.sheets[1] as never)).toBe(false);
    expect(wb.sheets.every((s) => s.readOnly)).toBe(true);
  });

  it('notifies subscribers of structural changes', () => {
    const wb = book('A');
    let n = 0;
    wb.subscribe(() => n++);
    wb.addSheet({ name: 'B' });
    wb.renameSheet(wb.sheetByName('B')!, 'C');
    wb.setActive(0);
    expect(n).toBe(3);
  });
});

describe('formulas across sheets', () => {
  it('read another sheet, and follow its edits', () => {
    const wb = book('Data', 'Totals');
    put(wb, 'Data', 'A1', '5');
    put(wb, 'Data', 'A2', '7');
    put(wb, 'Totals', 'A1', '=SUM(Data!A1:A2)');
    put(wb, 'Totals', 'B1', '=Data!A1*2');
    expect(at(wb, 'Totals', 'A1')).toBe(12);
    expect(at(wb, 'Totals', 'B1')).toBe(10);
    put(wb, 'Data', 'A2', '100');
    expect(at(wb, 'Totals', 'A1')).toBe(105);
    wb.sheetByName('Data')!.undo();
    expect(at(wb, 'Totals', 'A1')).toBe(12);
  });

  it('work with ranges in every function that reads cells', () => {
    const wb = book('Data', 'Calc');
    put(wb, 'Data', 'A1', 'x');
    put(wb, 'Data', 'B1', '10');
    put(wb, 'Data', 'A2', 'y');
    put(wb, 'Data', 'B2', '20');
    put(wb, 'Calc', 'A1', '=VLOOKUP("y",Data!A1:B2,2,FALSE)');
    put(wb, 'Calc', 'A2', '=SUMIF(Data!A1:A2,"y",Data!B1:B2)');
    put(wb, 'Calc', 'A3', '=INDEX(Data!A1:B2,2,2)');
    put(wb, 'Calc', 'A4', '=COUNTIF(Data!A1:A2,"x")');
    put(wb, 'Calc', 'A5', '=MATCH("y",Data!A1:A2,0)');
    expect([1, 2, 3, 4, 5].map((n) => at(wb, 'Calc', `A${n}`))).toEqual([20, 20, 20, 1, 2]);
  });

  it('a name that does not exist is #REF!, and starts working once the sheet appears', () => {
    const wb = book('A');
    put(wb, 'A', 'A1', '=Later!B2');
    expect(at(wb, 'A', 'A1')).toEqual({ error: '#REF!' });
    const later = wb.addSheet({ name: 'Later' })!;
    later.setCellInput(1, 1, '42');
    wb.setActive(0);
    expect(at(wb, 'A', 'A1')).toBe(42);
  });

  it('chains through several sheets in any order', () => {
    const wb = book('A', 'B', 'C');
    put(wb, 'C', 'A1', '=B!A1+1');
    put(wb, 'B', 'A1', '=A!A1+1');
    put(wb, 'A', 'A1', '1');
    expect(at(wb, 'C', 'A1')).toBe(3);
    put(wb, 'A', 'A1', '10');
    expect(at(wb, 'C', 'A1')).toBe(12);
  });

  it('a cycle through sheets settles instead of looping', () => {
    const wb = book('A', 'B');
    put(wb, 'A', 'A1', '=B!A1+1');
    put(wb, 'B', 'A1', '=A!A1+1');
    expect(typeof at(wb, 'A', 'A1')).not.toBe('undefined'); // terminated
  });

  it('a sheet may name itself', () => {
    const wb = book('A');
    put(wb, 'A', 'A1', '5');
    put(wb, 'A', 'B1', '=A!A1+1');
    expect(at(wb, 'A', 'B1')).toBe(6);
    put(wb, 'A', 'A1', '9');
    expect(at(wb, 'A', 'B1')).toBe(10);
  });

  it('names compare ignoring case', () => {
    const wb = book('Data', 'X');
    put(wb, 'Data', 'A1', '3');
    put(wb, 'X', 'A1', '=data!a1+1');
    expect(at(wb, 'X', 'A1')).toBe(4);
  });
});

describe('renaming and deleting sheets', () => {
  it('rename rewrites formulas everywhere, including quoting', () => {
    const wb = book('Data', 'X');
    put(wb, 'Data', 'A1', '5');
    put(wb, 'X', 'A1', '=Data!A1+1');
    put(wb, 'Data', 'B1', '=Data!A1*2');
    expect(wb.renameSheet(wb.sheetByName('Data')!, 'My data')).toBe(true);
    expect(wb.sheetByName('X')!.getEditText(0, 0)).toBe("='My data'!A1+1");
    expect(wb.sheetByName('My data')!.getEditText(0, 1)).toBe("='My data'!A1*2");
    expect(at(wb, 'X', 'A1')).toBe(6);
    put(wb, 'My data', 'A1', '8');
    expect(at(wb, 'X', 'A1')).toBe(9);
  });

  it('rename refuses bad or taken names', () => {
    const wb = book('A', 'B');
    expect(wb.renameSheet(wb.sheetByName('A')!, 'b')).toBe(false);
    expect(wb.renameSheet(wb.sheetByName('A')!, '')).toBe(false);
    expect(wb.sheetByName('A')).toBeDefined();
  });

  it('delete turns the references into #REF!', () => {
    const wb = book('Data', 'X');
    put(wb, 'Data', 'A1', '5');
    put(wb, 'X', 'A1', '=Data!A1+1');
    wb.deleteSheet(wb.sheetByName('Data')!);
    expect(at(wb, 'X', 'A1')).toEqual({ error: '#REF!' });
    expect(wb.sheetByName('X')!.getEditText(0, 0)).toBe('=#REF!+1');
  });

  it('drops the undo history of sheets whose formulas were rewritten', () => {
    const wb = book('Data', 'X');
    put(wb, 'X', 'A1', '=Data!A1');
    expect(wb.sheetByName('X')!.history.canUndo).toBe(true);
    wb.renameSheet(wb.sheetByName('Data')!, 'D2');
    expect(wb.sheetByName('X')!.history.canUndo).toBe(false);
  });
});

describe('structure edits in the sheet that is read', () => {
  it('inserting rows moves the references that point into it, and undo restores them', () => {
    const wb = book('Data', 'X');
    put(wb, 'Data', 'A3', '30');
    put(wb, 'X', 'A1', '=Data!A3');
    put(wb, 'X', 'A2', '=SUM(Data!A1:A5)');
    const data = wb.sheetByName('Data')!;
    data.insertRows(0, 2);
    expect(wb.sheetByName('X')!.getEditText(0, 0)).toBe('=Data!A5');
    expect(wb.sheetByName('X')!.getEditText(1, 0)).toBe('=SUM(Data!A3:A7)');
    expect(at(wb, 'X', 'A1')).toBe(30);
    data.undo();
    expect(wb.sheetByName('X')!.getEditText(0, 0)).toBe('=Data!A3');
    expect(wb.sheetByName('X')!.getEditText(1, 0)).toBe('=SUM(Data!A1:A5)');
    expect(at(wb, 'X', 'A1')).toBe(30);
  });

  it('deleting the row a reference points at gives #REF!; undo brings it back', () => {
    const wb = book('Data', 'X');
    put(wb, 'Data', 'A2', '9');
    put(wb, 'X', 'A1', '=Data!A2');
    const data = wb.sheetByName('Data')!;
    data.deleteRows(1, 1);
    expect(at(wb, 'X', 'A1')).toEqual({ error: '#REF!' });
    data.undo();
    expect(at(wb, 'X', 'A1')).toBe(9);
    expect(wb.sheetByName('X')!.getEditText(0, 0)).toBe('=Data!A2');
  });

  it("editing a sheet's own structure keeps its references to other sheets pointing at the same cells", () => {
    const wb = book('Data', 'X');
    put(wb, 'Data', 'A1', '5');
    put(wb, 'X', 'A5', '=Data!A1');
    wb.sheetByName('X')!.insertRows(0, 3); // the formula moves from row 5 to row 8
    expect(wb.sheetByName('X')!.getEditText(7, 0)).toBe('=Data!A1');
    expect(at(wb, 'X', 'A8')).toBe(5);
  });
});

describe('workbook snapshots', () => {
  it('round trip sheets, names, order, the active sheet and cross-sheet formulas', () => {
    const wb = book('Data', 'My totals');
    put(wb, 'Data', 'A1', '4');
    put(wb, 'My totals', 'A1', "=Data!A1*3");
    put(wb, 'Data', 'B1', "='My totals'!A1+1");
    wb.setActive(1);
    const copy = deserializeWorkbook(JSON.parse(JSON.stringify(serializeWorkbook(wb))));
    expect(copy.sheets.map((s) => s.name)).toEqual(['Data', 'My totals']);
    expect(copy.activeIndex).toBe(1);
    expect(at(copy, 'My totals', 'A1')).toBe(12);
    expect(at(copy, 'Data', 'B1')).toBe(13);
    put(copy, 'Data', 'A1', '1');
    expect(at(copy, 'My totals', 'A1')).toBe(3);
  });

  it('a plain sheet snapshot (an older save) becomes a one-sheet workbook', () => {
    const wb = book('Only');
    put(wb, 'Only', 'A1', '7');
    const sheetSnapshot = JSON.parse(JSON.stringify(serializeWorkbook(wb))).sheets[0];
    const loaded = deserializeWorkbook(sheetSnapshot);
    expect(loaded.sheets).toHaveLength(1);
    expect(at(loaded, 'Only', 'A1')).toBe(7);
  });

  it('refuses clashing, missing and unusable data', () => {
    const wb = book('A', 'B');
    const snap = JSON.parse(JSON.stringify(serializeWorkbook(wb)));
    const dup = { ...snap, sheets: [snap.sheets[0], { ...snap.sheets[1], name: 'a' }] };
    expect(() => deserializeWorkbook(dup)).toThrow(SnapshotError);
    expect(() => deserializeWorkbook({ ...snap, sheets: [] })).toThrow(SnapshotError);
    expect(() => deserializeWorkbook({ ...snap, sheets: [{ ...snap.sheets[0], name: 'a/b' }] })).toThrow(SnapshotError);
    expect(() => deserializeWorkbook({ ...snap, version: 99 })).toThrow(SnapshotError);
    expect(deserializeWorkbook({ ...snap, active: 99 }).activeIndex).toBe(0);
  });

  it('duplicates a sheet with its content under a fresh name, right after it', () => {
    const wb = book('A', 'B');
    put(wb, 'A', 'A1', '5');
    put(wb, 'A', 'A2', '=A!A1+1');
    const copy = wb.duplicateSheet(wb.sheetByName('A')!)!;
    expect(wb.sheets.map((s) => s.name)).toEqual(['A', 'A (copy)', 'B']);
    expect(wb.active).toBe(copy);
    expect(at(wb, 'A (copy)', 'A1')).toBe(5);
    expect(copy.getEditText(1, 0)).toBe('=A!A1+1'); // still reads the original, as copying a sheet does in Sheets
    put(wb, 'A', 'A1', '6');
    expect(at(wb, 'A (copy)', 'A2')).toBe(7);
  });
});
