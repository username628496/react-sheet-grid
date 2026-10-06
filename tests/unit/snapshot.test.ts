import { describe, expect, it } from 'vitest';
import { deserializeSheet, serializeSheet, SnapshotError } from '../../src/core/snapshot';
import { Spreadsheet } from '../../src/core/Spreadsheet';
import { addr, makeSheet, set, value } from './formula/helpers';

/** Through real JSON, as a stored save would travel. */
function roundTrip(sheet: Spreadsheet): Spreadsheet {
  return deserializeSheet(JSON.parse(JSON.stringify(serializeSheet(sheet))));
}

describe('serializeSheet / deserializeSheet', () => {
  it('restores values, formulas (recalculated) and number types', () => {
    const s = makeSheet({ A1: 1, A2: 2.5, A3: 'text', A4: 'TRUE', B1: '=SUM(A1:A2)', B2: "'007", C1: '=A3&"!"' });
    const t = roundTrip(s);
    expect(value(t, 'A1')).toBe(1);
    expect(value(t, 'A2')).toBe(2.5);
    expect(value(t, 'A3')).toBe('text');
    expect(value(t, 'A4')).toBe(true);
    expect(value(t, 'B1')).toBe(3.5);
    expect(t.getEditText(...addr('B1'))).toBe('=SUM(A1:A2)');
    expect(value(t, 'B2')).toBe('007');
    expect(t.getEditText(...addr('B2'))).toBe("'007");
  });

  it('restores formatting, sizes and the sheet size', () => {
    const s = new Spreadsheet({ rowCount: 50, colCount: 26 });
    s.setCellInput(0, 0, 'x');
    s.selection.selectCell(0, 0);
    s.toggleStyle('bold');
    s.formatSelection({ color: '#ff0000', background: '#eeeeee', align: 'center', numberFormat: '0.00' });
    s.cols.setSize(2, 180);
    s.rows.setSize(3, 40);
    const t = roundTrip(s);
    expect(t.rowCount).toBe(50);
    expect(t.colCount).toBe(26);
    expect(t.styles.get(t.getCellByView(0, 0).styleId)).toEqual({
      bold: true,
      color: '#ff0000',
      background: '#eeeeee',
      align: 'center',
      numberFormat: '0.00',
    });
    expect(t.cols.getSize(2)).toBe(180);
    expect(t.rows.getSize(3)).toBe(40);
    expect(t.cols.getSize(1)).toBe(100);
  });

  it('keeps a sort, a filter and the view order (including rows inserted into a sorted view)', () => {
    const s = makeSheet({ A1: 3, A2: 1, A3: 2 });
    s.sortByColumn(0, true);
    s.insertRows(1, 1);
    s.setCellInput(1, 0, 'new');
    const t = roundTrip(s);
    expect([0, 1, 2, 3].map((r) => t.getCellByView(r, 0).value)).toEqual([1, 'new', 2, 3]);
    expect(t.viewState.sort).toEqual({ col: 0, asc: true });
    expect(serializeSheet(t)).toEqual(serializeSheet(s));

    const f = makeSheet({ A1: 'a', A2: 'b', A3: 'a' });
    f.setColumnFilter(0, new Set(['a']));
    const g = roundTrip(f);
    expect(g.rowCount).toBe(f.rowCount);
    expect([...g.viewState.filters.get(0)!]).toEqual(['a']);
    expect(g.getCellByView(1, 0).value).toBe('a');
  });

  it('keeps errors, including broken formulas typed by the user', () => {
    const s = makeSheet({ A1: '=1/0', B1: '=1+', C1: '=#N/A' });
    const t = roundTrip(s);
    expect(value(t, 'A1')).toEqual({ error: '#DIV/0!' });
    expect(t.getEditText(...addr('B1'))).toBe('=1+');
    expect(value(t, 'B1')).toEqual({ error: '#ERROR!' });
    expect(value(t, 'C1')).toEqual({ error: '#N/A' });
  });

  it('is stable: serializing a restored sheet gives the same snapshot', () => {
    const s = makeSheet({ A1: 1, B1: '=A1*2', C5: 'z', D9: '=B1+1' });
    s.cols.setSize(1, 77);
    const first = serializeSheet(s);
    expect(serializeSheet(deserializeSheet(JSON.parse(JSON.stringify(first))))).toEqual(first);
  });

  it('the restored sheet is live: formulas react to edits and undo history starts empty', () => {
    const t = roundTrip(makeSheet({ A1: 1, B1: '=A1+1' }));
    expect(t.history.canUndo).toBe(false);
    set(t, 'A1', 10);
    expect(value(t, 'B1')).toBe(11);
    t.undo();
    expect(value(t, 'B1')).toBe(2);
  });

  it('an empty sheet round-trips', () => {
    const t = roundTrip(new Spreadsheet({ rowCount: 50, colCount: 26 }));
    expect([t.rowCount, t.colCount, t.model.cellCount]).toEqual([50, 26, 0]);
  });

  it('survives random edit sequences', () => {
    for (let seed = 1; seed <= 30; seed++) {
      let x = seed * 7919;
      const rand = (n: number): number => {
        x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
        return x % n;
      };
      const s = new Spreadsheet({ rowCount: 30, colCount: 6 });
      for (let i = 0; i < 80; i++) {
        const r = rand(s.rowCount);
        const c = rand(s.colCount);
        switch (rand(9)) {
          case 0:
            s.setCellInput(r, c, String(rand(100)));
            break;
          case 1:
            s.setCellInput(r, c, `=${String.fromCharCode(65 + rand(6))}${1 + rand(30)}+1`);
            break;
          case 2:
            s.setCellInput(r, c, ['a', 'b', 'TRUE', '', '=SUM(A:A)'][rand(5)] as string);
            break;
          case 3:
            s.selection.selectCell(r, c);
            s.toggleStyle(['bold', 'italic', 'underline', 'strike'][rand(4)] as 'bold');
            break;
          case 4:
            s.insertRows(r, 1 + rand(2));
            break;
          case 5:
            s.deleteRows(r, 1);
            break;
          case 6:
            s.sortByColumn(c, rand(2) === 0);
            break;
          case 7:
            s.cols.setSize(c, 50 + rand(100));
            break;
          default:
            s.undo();
        }
      }
      const t = roundTrip(s);
      expect(serializeSheet(t), `seed ${seed}`).toEqual(serializeSheet(s));
      for (let r = 0; r < s.rowCount; r++) {
        for (let c = 0; c < s.colCount; c++) {
          expect(t.getCellByView(r, c).value, `seed ${seed} ${r},${c}`).toEqual(s.getCellByView(r, c).value);
        }
      }
    }
  });
});

describe('deserializeSheet validation', () => {
  const good = () => JSON.parse(JSON.stringify(serializeSheet(makeSheet({ A1: 1, B1: '=A1' })))) as Record<string, unknown>;

  it.each([
    ['not an object', null],
    ['a string', 'x'],
    ['an array', []],
  ])('rejects %s', (_name, data) => {
    expect(() => deserializeSheet(data)).toThrow(SnapshotError);
  });

  it('rejects an unknown version and bad sizes', () => {
    expect(() => deserializeSheet({ ...good(), version: 2 })).toThrow(/version/);
    expect(() => deserializeSheet({ ...good(), rowCount: 0 })).toThrow(/rowCount/);
    expect(() => deserializeSheet({ ...good(), colCount: 1.5 })).toThrow(/colCount/);
    expect(() => deserializeSheet({ ...good(), defaultRowHeight: -1 })).toThrow(/defaultRowHeight/);
  });

  it('rejects cells outside the sheet, bad values and bad style ids', () => {
    const base = good();
    expect(() => deserializeSheet({ ...base, cells: [[5000, 0, 0, 1]] })).toThrow(/row/);
    expect(() => deserializeSheet({ ...base, cells: [[0, 0, 9, 1]] })).toThrow(/style/);
    expect(() => deserializeSheet({ ...base, cells: [[0, 0, 0, { x: 1 }]] })).toThrow(/value/);
    expect(() => deserializeSheet({ ...base, cells: 'nope' })).toThrow(/cells/);
  });

  it('rejects a broken order, sort or sizes', () => {
    const base = good();
    expect(() => deserializeSheet({ ...base, order: [0, 0] })).toThrow(/twice/);
    expect(() => deserializeSheet({ ...base, sort: { col: 99, asc: true } })).toThrow(/sort column/);
    expect(() => deserializeSheet({ ...base, colSizes: [[3, 10], [2, 10]] })).toThrow(/sorted/);
  });

  it('never returns a half-built sheet: failures throw before any sheet is handed out', () => {
    expect(() => deserializeSheet({ ...good(), cells: [[0, 0, 0, 1], 'junk'] })).toThrow(SnapshotError);
  });
});
