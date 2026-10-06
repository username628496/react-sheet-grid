import { describe, expect, it } from 'vitest';
import { findInText, replaceInText } from '../../src/core/find';
import { MAX_FIND_MATCHES, Spreadsheet } from '../../src/core/Spreadsheet';
import { addr, makeSheet, value } from './formula/helpers';

describe('findInText', () => {
  it.each([
    ['Hello hello HELLO', 'hello', {}, [[0, 5], [6, 11], [12, 17]]],
    ['Hello hello HELLO', 'hello', { matchCase: true }, [[6, 11]]],
    ['aaaa', 'aa', {}, [[0, 2], [2, 4]]], // non-overlapping, left to right
    ['abc', '', {}, []],
    ['abc', 'abcd', {}, []],
    ['Việt Nam', 'viet', {}, []], // accents matter unless told otherwise
    ['Việt Nam', 'viet', { ignoreAccents: true }, [[0, 4]]],
    ['Việt Nam', 'VIỆT', { ignoreAccents: true }, [[0, 4]]],
    ['Việt Nam', 'việt', { ignoreAccents: true }, [[0, 4]]], // a query with accents also matches
    ['Đà Nẵng đường', 'duong', { ignoreAccents: true }, [[8, 13]]],
    ['Đà Nẵng', 'da', { ignoreAccents: true }, [[0, 2]]],
    ['Đà Nẵng', 'Da', { ignoreAccents: true, matchCase: true }, [[0, 2]]], // Đ folds to D, so D matches
    ['Đà Nẵng', 'da', { ignoreAccents: true, matchCase: true }, []],
    ['abc', 'abc', { wholeCell: true }, [[0, 3]]],
    ['abc', 'AB', { wholeCell: true }, []],
    ['abc', 'ABC', { wholeCell: true }, [[0, 3]]],
    ['abc ', 'abc', { wholeCell: true }, []],
    ['a😀b😀', '😀', {}, [[1, 3], [4, 6]]], // surrogate pairs keep their two code units
    ['a.b*c', '.b*', {}, [[1, 4]]], // the query is plain text, not a pattern
    ['x', '́', { ignoreAccents: true }, []], // a query of only an accent finds nothing
  ] as const)('%j in %j', (text, query, options, expected) => {
    // (the table lists the text first: swap for readability)
    expect(findInText(text, query, options)).toEqual(expected);
  });

  it('finds accents written as base letter plus combining mark (decomposed text)', () => {
    const decomposed = 'Việt'; // ệ as e + dot below + circumflex
    expect(decomposed).toHaveLength(6);
    expect(findInText(decomposed, 'viet', { ignoreAccents: true })).toEqual([[0, 6]]);
    expect(findInText(decomposed, 'Việt')).toEqual([]); // precomposed query against decomposed text: not equal without folding
  });
});

describe('replaceInText', () => {
  it('replaces every match and reports how many', () => {
    expect(replaceInText('a-b-c', '-', '+')).toEqual({ text: 'a+b+c', count: 2 });
    expect(replaceInText('Hello HELLO', 'hello', 'x')).toEqual({ text: 'x x', count: 2 });
    expect(replaceInText('abc', 'zzz', 'x')).toEqual({ text: 'abc', count: 0 });
    expect(replaceInText('abc', 'b', '')).toEqual({ text: 'ac', count: 1 });
    expect(replaceInText('aaa', 'a', 'aa')).toEqual({ text: 'aaaaaa', count: 3 }); // no re-scan of the replacement
    expect(replaceInText('$1 $1', '$1', '$&')).toEqual({ text: '$& $&', count: 2 }); // replacement is literal text
  });

  it('works with accents ignored, keeping the surrounding text intact', () => {
    expect(replaceInText('Hà Nội - Việt Nam', 'viet nam', 'VN', { ignoreAccents: true })).toEqual({ text: 'Hà Nội - VN', count: 1 });
    expect(replaceInText('đường Đường', 'duong', 'road', { ignoreAccents: true })).toEqual({ text: 'road road', count: 2 });
  });

  it('whole-cell replaces everything or nothing', () => {
    expect(replaceInText('abc', 'ABC', 'x', { wholeCell: true })).toEqual({ text: 'x', count: 1 });
    expect(replaceInText('abcd', 'abc', 'x', { wholeCell: true })).toEqual({ text: 'abcd', count: 0 });
  });

  it('random texts: replacing a query by itself changes nothing, and counts agree with find', () => {
    let seed = 7;
    const rand = (n: number): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed % n;
    };
    const alphabet = ['a', 'A', 'e', 'ê', 'ệ', 'd', 'đ', 'Đ', ' ', '😀', '́', 'b'];
    for (let i = 0; i < 400; i++) {
      const text = Array.from({ length: rand(12) }, () => alphabet[rand(alphabet.length)]).join('');
      const query = Array.from({ length: 1 + rand(3) }, () => alphabet[rand(alphabet.length)]).join('');
      for (const options of [{}, { ignoreAccents: true }, { matchCase: true, ignoreAccents: true }]) {
        const ranges = findInText(text, query, options);
        const same = replaceInText(text, query, '\u0000', options);
        expect(same.count).toBe(ranges.length);
        // Ranges are inside the text, ordered and disjoint.
        let previous = 0;
        for (const [start, end] of ranges) {
          expect(start).toBeGreaterThanOrEqual(previous);
          expect(end).toBeGreaterThan(start);
          expect(end).toBeLessThanOrEqual(text.length);
          previous = end;
        }
        // Putting the matched text back where it was gives the original string.
        const rebuilt = replaceInText(text, query, '\u0001', options).text;
        let restored = '';
        let at = 0;
        const parts = rebuilt.split('\u0001');
        ranges.forEach(([start, end], k) => {
          restored += parts[k] + text.slice(start, end);
          at = k + 1;
        });
        restored += parts[at] ?? '';
        expect(restored).toBe(text);
      }
    }
  });
});

describe('Spreadsheet.findCells', () => {
  it('lists matching cells in reading order, from what they display', () => {
    const s = makeSheet({ C1: 'apple', A2: 'Apple pie', B2: 'pear', A3: 42, B3: '=A3*2' });
    const result = s.findCells({ query: 'apple' });
    expect(result.matches).toEqual([{ row: 0, col: 2 }, { row: 1, col: 0 }]);
    expect(result.truncated).toBe(false);
    s.selection.selectCell(...addr('A3'));
    s.formatSelection({ numberFormat: '#,##0.00' });
    expect(s.findCells({ query: '42.00' }).matches).toEqual([{ row: 2, col: 0 }]); // the displayed text
    expect(s.findCells({ query: '84' }).matches).toEqual([{ row: 2, col: 1 }]);
  });

  it('formulas are searched only on request', () => {
    const s = makeSheet({ A1: 5, B1: '=SUM(A1:A3)' });
    expect(s.findCells({ query: 'SUM' }).matches).toEqual([]);
    expect(s.findCells({ query: 'SUM', inFormulas: true }).matches).toEqual([{ row: 0, col: 1 }]);
  });

  it('can be limited to a range, and skips hidden and filtered-out rows', () => {
    const s = makeSheet({ A1: 'x', A2: 'x', A3: 'x', A4: 'x', B2: 'x' });
    expect(s.findCells({ query: 'x', range: { startRow: 1, startCol: 0, endRow: 2, endCol: 0 } }).matches).toEqual([{ row: 1, col: 0 }, { row: 2, col: 0 }]);
    s.hideLines('row', 1, 1);
    expect(s.findCells({ query: 'x' }).matches.map((m) => m.row)).toEqual([0, 2, 3]);
    s.showLines('row', 0, 5);
    s.setColumnFilter(0, new Set(['x']));
    expect(s.findCells({ query: 'x' }).matches).toHaveLength(5);
    const t = makeSheet({ A1: 'k', A2: 'a', A3: 'k', B3: 'k' });
    t.setColumnFilter(0, new Set(['k']));
    expect(t.findCells({ query: 'a' }).matches).toEqual([]); // row 2 is filtered out
  });

  it('positions follow the sorted view', () => {
    const s = makeSheet({ A1: 'z', A2: 'a', A3: 'm' });
    s.sortByColumn(0, true);
    expect(s.findCells({ query: 'm' }).matches).toEqual([{ row: 1, col: 0 }]);
  });

  it('stops collecting at the limit and says so', () => {
    const s = new Spreadsheet({ rowCount: 200_000, colCount: 2 });
    for (let r = 0; r < MAX_FIND_MATCHES + 5; r++) s.model.setCell(r, 0, { value: 'hit', styleId: 0 });
    const result = s.findCells({ query: 'hit' });
    expect(result.matches).toHaveLength(MAX_FIND_MATCHES);
    expect(result.truncated).toBe(true);
  });
});

describe('Spreadsheet.replaceInCells', () => {
  it('replaces in the content of every found cell as one undo step', () => {
    const s = makeSheet({ A1: 'red apple', A2: 'green apple', A3: 'pear' });
    expect(s.replaceInCells({ query: 'apple' }, 'plum')).toEqual({ cells: 2, occurrences: 2 });
    expect([value(s, 'A1'), value(s, 'A2'), value(s, 'A3')]).toEqual(['red plum', 'green plum', 'pear']);
    s.undo();
    expect([value(s, 'A1'), value(s, 'A2')]).toEqual(['red apple', 'green apple']);
  });

  it('the new text is read as if typed: numbers become numbers, formulas stay live', () => {
    const s = makeSheet({ A1: 'x5', B1: '=A2+1', A2: 10 });
    s.replaceInCells({ query: 'x' }, '');
    expect(value(s, 'A1')).toBe(5);
    s.replaceInCells({ query: 'A2', inFormulas: true }, 'A1');
    expect(s.getEditText(...addr('B1'))).toBe('=A1+1');
    expect(value(s, 'B1')).toBe(6);
  });

  it('only the given cells when a list is passed, and formatting is kept', () => {
    const s = makeSheet({ A1: 'x', A2: 'x' });
    s.selection.selectCell(0, 0);
    s.toggleStyle('bold');
    expect(s.replaceInCells({ query: 'x' }, 'y', [{ row: 0, col: 0 }])).toEqual({ cells: 1, occurrences: 1 });
    expect(value(s, 'A1')).toBe('y');
    expect(value(s, 'A2')).toBe('x');
    expect(s.styles.get(s.getCellByView(0, 0).styleId).bold).toBe(true);
  });

  it('a cell that matched only through its display is left alone', () => {
    const s = makeSheet({ A1: 1234.5 });
    s.selection.selectCell(0, 0);
    s.formatSelection({ numberFormat: '#,##0.00' });
    expect(s.findCells({ query: ',' }).matches).toHaveLength(1); // found in "1,234.50"
    expect(s.replaceInCells({ query: ',' }, '')).toEqual({ cells: 0, occurrences: 0 }); // but 1234.5 has no comma to replace
    expect(value(s, 'A1')).toBe(1234.5);
  });

  it('does nothing when read-only or the query is empty', () => {
    const s = makeSheet({ A1: 'x' });
    expect(s.replaceInCells({ query: '' }, 'y')).toEqual({ cells: 0, occurrences: 0 });
    s.readOnly = true;
    expect(s.replaceInCells({ query: 'x' }, 'y')).toEqual({ cells: 0, occurrences: 0 });
    expect(value(s, 'A1')).toBe('x');
  });

  it('accent-insensitive replace across Vietnamese text', () => {
    const s = makeSheet({ A1: 'Hà Nội', A2: 'HA NOI', A3: 'Đà Nẵng' });
    expect(s.replaceInCells({ query: 'ha noi', ignoreAccents: true }, 'HN').cells).toBe(2);
    expect([value(s, 'A1'), value(s, 'A2'), value(s, 'A3')]).toEqual(['HN', 'HN', 'Đà Nẵng']);
  });
});
