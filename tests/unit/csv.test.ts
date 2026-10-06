import { describe, expect, it } from 'vitest';
import { csvField, detectDelimiter, neutralizeFormula, parseCsv, toCsv } from '../../src/core/csv';
import { MAX_EXPORT_CELLS, Spreadsheet } from '../../src/core/Spreadsheet';
import { addr, makeSheet, set, value } from './formula/helpers';

describe('parseCsv', () => {
  it.each([
    ['a,b,c', [['a', 'b', 'c']]],
    ['a,b\r\nc,d', [['a', 'b'], ['c', 'd']]],
    ['a,b\nc,d\n', [['a', 'b'], ['c', 'd']]], // a trailing line break is not a row
    ['a,b\rc,d', [['a', 'b'], ['c', 'd']]], // old Mac line breaks
    ['a,,c', [['a', '', 'c']]],
    [',', [['', '']]],
    ['"a,b",c', [['a,b', 'c']]],
    ['"say ""hi""",x', [['say "hi"', 'x']]],
    ['"line1\nline2",x', [['line1\nline2', 'x']]],
    ['"a\r\nb",x\r\nnext', [['a\r\nb', 'x'], ['next']]],
    ['a\n\nb', [['a'], [''], ['b']]], // an empty line inside the data is a blank row
    ['', []],
    ['\n', [['']]],
    ['"unterminated', [['unterminated']]],
    ['ab"c,d', [['ab"c', 'd']]], // a quote in the middle of a field is ordinary text
    ['﻿name,qty\nx,1', [['name', 'qty'], ['x', '1']]], // BOM from Excel
    ['Việt Nam,😀', [['Việt Nam', '😀']]],
  ])('%j', (text, expected) => {
    expect(parseCsv(text, ',')).toEqual(expected);
  });

  it('reads other delimiters', () => {
    expect(parseCsv('a;b;c\n1,5;2;3', ';')).toEqual([['a', 'b', 'c'], ['1,5', '2', '3']]);
    expect(parseCsv('a\tb\n"x\ty"\tz', '\t')).toEqual([['a', 'b'], ['x\ty', 'z']]);
  });
});

describe('detectDelimiter', () => {
  it('picks the most frequent delimiter of the first record, ignoring quoted ones', () => {
    expect(detectDelimiter('a,b,c\n1,2,3')).toBe(',');
    expect(detectDelimiter('a;b;c\n1,5;2;3')).toBe(';');
    expect(detectDelimiter('a\tb\tc')).toBe('\t');
    expect(detectDelimiter('"a,b,c";d;e')).toBe(';');
    expect(detectDelimiter('single')).toBe(',');
    expect(detectDelimiter('')).toBe(',');
    expect(parseCsv('x;y\n1;2')).toEqual([['x', 'y'], ['1', '2']]); // detected when not given
  });
});

describe('toCsv', () => {
  it('quotes only when needed and uses CRLF', () => {
    expect(csvField('plain', ',')).toBe('plain');
    expect(csvField('a,b', ',')).toBe('"a,b"');
    expect(csvField('a,b', ';')).toBe('a,b');
    expect(csvField('a;b', ';')).toBe('"a;b"');
    expect(csvField('say "hi"', ',')).toBe('"say ""hi"""');
    expect(csvField('two\nlines', ',')).toBe('"two\nlines"');
    expect(toCsv([['a', 'b'], ['c,d', '']])).toBe('a,b\r\n"c,d",');
  });

  it('round-trips any text, including quotes, delimiters, line breaks and unicode (random)', () => {
    let seed = 12345;
    const rand = (n: number): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed % n;
    };
    const alphabet = ['a', 'b', ' ', ',', ';', '\t', '"', '\n', '\r', "'", 'é', 'ệ', '😀', '=', '\\'];
    for (const delimiter of [',', ';', '\t'] as const) {
      for (let round = 0; round < 60; round++) {
        const rows = 1 + rand(5);
        const cols = 1 + rand(4);
        const matrix = Array.from({ length: rows }, () =>
          Array.from({ length: cols }, () => Array.from({ length: rand(6) }, () => alphabet[rand(alphabet.length)]).join('')),
        );
        // A record that is a single empty field is written as an empty line, which reads back as one empty field too.
        expect(parseCsv(toCsv(matrix, delimiter), delimiter)).toEqual(matrix);
      }
    }
  });
});

describe('neutralizeFormula', () => {
  it.each([
    ['=SUM(A1)', "'=SUM(A1)"],
    ['+1', "'+1"],
    ['-1', "'-1"],
    ['@cmd', "'@cmd"],
    ['\tx', "'\tx"],
    ['plain', 'plain'],
    ['a=b', 'a=b'],
    ['', ''],
  ])('%j', (input, expected) => {
    expect(neutralizeFormula(input)).toBe(expected);
  });
});

describe('Spreadsheet.exportCsv', () => {
  it('writes what the cells display, from A1 to the last used cell', () => {
    const s = makeSheet({ A1: 'name', B1: 'qty', A2: 'tea, green', B2: 1234.5, B3: '=B2*2' });
    s.selection.selectCell(...addr('B2'));
    s.formatSelection({ numberFormat: '#,##0.00' });
    // B3 has no number format, so it shows 2469; B2's format adds a thousands comma, which makes the field quoted.
    expect(s.exportCsv()).toBe('name,qty\r\n"tea, green","1,234.50"\r\n,2469');
  });

  it('can write raw values or formulas instead', () => {
    const s = makeSheet({ A1: 1234.5, A2: '=A1*2', A3: 'x' });
    s.selection.selectCell(...addr('A1'));
    s.formatSelection({ numberFormat: '$#,##0.00' });
    expect(s.exportCsv({ content: 'raw' })).toBe('1234.5\r\n2469\r\nx');
    expect(s.exportCsv({ content: 'formulas' })).toBe('"$1,234.50"\r\n=A1*2\r\nx'); // the comma in $1,234.50 needs quoting
  });

  it('uses the chosen delimiter and an explicit range, in view order', () => {
    const s = makeSheet({ A1: 3, A2: 1, A3: 2, B1: 'c', B2: 'a', B3: 'b' });
    s.sortByColumn(0, true);
    expect(s.exportCsv({ delimiter: ';' })).toBe('1;a\r\n2;b\r\n3;c');
    expect(s.exportCsv({ range: { startRow: 1, startCol: 1, endRow: 2, endCol: 1 } })).toBe('b\r\nc');
  });

  it('neutralizes text that would run as a formula, but not numbers or real formulas', () => {
    const s = makeSheet({ A1: "'=HYPERLINK(1)", A2: -5, A3: '=1+1' });
    expect(s.getCellByView(0, 0).value).toBe('=HYPERLINK(1)');
    expect(s.exportCsv()).toBe("'=HYPERLINK(1)\r\n-5\r\n2");
    expect(s.exportCsv({ neutralize: false })).toBe('=HYPERLINK(1)\r\n-5\r\n2');
  });

  it('an empty sheet is an empty string, and a huge area is refused with a notice', () => {
    expect(new Spreadsheet().exportCsv()).toBe('');
    const s = new Spreadsheet({ rowCount: 1_000_000, colCount: 100 });
    const notices: unknown[] = [];
    s.subscribeNotices((n) => notices.push(n));
    expect(s.exportCsv({ range: { startRow: 0, startCol: 0, endRow: 999_999, endCol: 99 } })).toBeNull();
    expect(notices).toEqual([{ code: 'exportTooLarge', cells: 100_000_000, limit: MAX_EXPORT_CELLS }]);
  });
});

describe('Spreadsheet.importCsv', () => {
  it('fills from the active cell, typing values like the editor does', () => {
    const s = makeSheet();
    s.selection.selectCell(...addr('B2'));
    expect(s.importCsv('name,qty,ok\r\ntea,2.5,TRUE\r\ncoffee,=B3*2,')).toEqual({ rows: 3, cols: 3 });
    expect(value(s, 'B2')).toBe('name');
    expect(value(s, 'C3')).toBe(2.5);
    expect(value(s, 'D3')).toBe(true);
    expect(s.getEditText(...addr('C4'))).toBe('=B3*2');
    expect(value(s, 'C4')).toEqual({ error: '#VALUE!' }); // the formula is live: B3 is the text "tea", and text * 2 is an error
    expect(s.selection.primary).toEqual({ startRow: 1, startCol: 1, endRow: 3, endCol: 3 });
  });

  it('is one undo step, even when the sheet had to grow', () => {
    const s = new Spreadsheet({ rowCount: 3, colCount: 2 });
    const text = Array.from({ length: 10 }, (_, r) => `a${r},b${r},c${r}`).join('\n');
    s.importCsv(text);
    expect([s.rowCount, s.colCount]).toEqual([10, 3]);
    expect(s.getCellByView(9, 2).value).toBe('c9');
    s.undo();
    expect([s.rowCount, s.colCount]).toEqual([3, 2]);
    expect(s.model.cellCount).toBe(0);
    s.redo();
    expect([s.rowCount, s.colCount]).toEqual([10, 3]);
    expect(s.getCellByView(9, 2).value).toBe('c9');
  });

  it('detects the delimiter, handles quotes and a BOM, and ignores empty input', () => {
    const s = makeSheet();
    s.importCsv('﻿x;y\n"1,5";"say ""hi"""');
    expect(value(s, 'A1')).toBe('x');
    expect(value(s, 'A2')).toBe('1,5');
    expect(value(s, 'B2')).toBe('say "hi"');
    expect(s.importCsv('')).toBeNull();
  });

  it('is refused when read-only or too large, and changes nothing', () => {
    const s = makeSheet({ A1: 'keep' });
    s.readOnly = true;
    expect(s.importCsv('x,y')).toBeNull();
    s.readOnly = false;
    const notices: unknown[] = [];
    s.subscribeNotices((n) => notices.push(n));
    const big = `${'1,'.repeat(999)}1\n`.repeat(1100);
    expect(s.importCsv(big)).toBeNull();
    expect(notices).toHaveLength(1);
    expect(value(s, 'A1')).toBe('keep');
  });

  it('export then import reproduces the values', () => {
    const s = makeSheet({ A1: 'a,b', B1: 'say "x"', A2: 'line\nbreak', B2: 5, C3: 'é😀' });
    const csv = s.exportCsv({ content: 'raw' }) as string;
    const t = makeSheet();
    t.importCsv(csv, { delimiter: ',' });
    for (const a1 of ['A1', 'B1', 'A2', 'B2', 'C3']) expect(value(t, a1)).toBe(value(s, a1));
  });
});

describe('transaction', () => {
  it('groups commands into one undo step and keeps what happened if the work throws', () => {
    const s = makeSheet();
    s.transaction('two edits', () => {
      set(s, 'A1', 1);
      set(s, 'A2', 2);
    });
    expect(s.history.canUndo).toBe(true);
    s.undo();
    expect(s.model.cellCount).toBe(0);
    expect(s.history.canUndo).toBe(false);
    expect(() =>
      s.transaction('fails halfway', () => {
        set(s, 'A1', 1);
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(value(s, 'A1')).toBe(1);
    s.undo();
    expect(value(s, 'A1')).toBeNull();
  });

  it('nested transactions join the outer one, and an empty one records nothing', () => {
    const s = makeSheet();
    s.transaction('outer', () => {
      set(s, 'A1', 1);
      s.transaction('inner', () => set(s, 'A2', 2));
    });
    s.undo();
    expect(s.model.cellCount).toBe(0);
    const before = s.revision;
    s.transaction('nothing', () => undefined);
    expect(s.revision).toBe(before);
  });
});
