import { describe, expect, it } from 'vitest';
import { canInsertReference, cycleReference, findReferences, refToText } from '../../../src/formula/refText';

const texts = (s: string): string[] => findReferences(s).map((r) => r.text);

describe('findReferences', () => {
  it('finds cells, absolute refs and ranges with their positions', () => {
    const refs = findReferences('=SUM(A1:B2)+$C$3*d4');
    expect(refs.map((r) => r.text)).toEqual(['A1:B2', '$C$3', 'd4']);
    expect(refs[0]).toMatchObject({ start: 5, end: 10, r1: 0, c1: 0, r2: 1, c2: 1 });
    expect(refs[2]).toMatchObject({ r1: 3, c1: 3, r2: 3, c2: 3 });
  });

  it('normalizes reversed ranges', () => {
    expect(findReferences('=B2:A1')[0]).toMatchObject({ r1: 0, c1: 0, r2: 1, c2: 1 });
  });

  it('ignores text in strings, function names and non-formulas', () => {
    expect(texts('="A1"&B2')).toEqual(['B2']);
    expect(texts('="say ""A1"" now"&C3')).toEqual(['C3']);
    expect(texts('=LOG10(5)+ATAN2(1,2)')).toEqual([]);
    expect(texts('A1+B2')).toEqual([]);
    expect(texts('=ABCD1+XFE1+A9999999')).toEqual([]);
  });

  it('never throws on half-typed input', () => {
    expect(texts('=IF(A1>"abc')).toEqual(['A1']);
    expect(texts('=A1+')).toEqual(['A1']);
    expect(texts('=SUM(A1:')).toEqual(['A1']);
    expect(texts('=')).toEqual([]);
  });

  it('does not match references glued to identifiers', () => {
    expect(texts('=x_A1+B2')).toEqual(['B2']);
    expect(texts('=1A1')).toEqual([]);
  });
});

describe('refToText', () => {
  it('builds a cell or a normalized range', () => {
    expect(refToText(0, 0, 0, 0)).toBe('A1');
    expect(refToText(3, 2, 1, 0)).toBe('A2:C4');
    expect(refToText(0, 27, 0, 27)).toBe('AB1');
  });
});

describe('canInsertReference', () => {
  it.each([
    ['=', 1, true],
    ['=SUM(', 5, true],
    ['=A1+', 4, true],
    ['=A1+ ', 5, true],
    ['=SUM(A1,', 8, true],
    ['=SUM(A1;', 8, true],
    ['=A1:', 4, true],
    ['=IF(A1>', 7, true],
    ['=A1', 3, false],
    ['=SUM', 4, false],
    ['=SUM(A1)', 8, false],
    ['="abc', 5, false],
    ['="a(', 4, false], // an operator inside a string does not count
    ['="a"&', 5, true],
    ['abc+', 4, false],
    ['', 0, false],
    ['=5', 2, false],
  ])('%j at %i -> %s', (text, caret, expected) => {
    expect(canInsertReference(text, caret)).toBe(expected);
  });
});

describe('cycleReference (F4)', () => {
  it('cycles A1 -> $A$1 -> A$1 -> $A1 -> A1', () => {
    let text = '=B2+1';
    const seen: string[] = [];
    for (let i = 0; i < 5; i++) {
      const r = cycleReference(text, 3);
      expect(r).not.toBeNull();
      text = r!.text;
      seen.push(text);
    }
    expect(seen).toEqual(['=$B$2+1', '=B$2+1', '=$B2+1', '=B2+1', '=$B$2+1']);
  });

  it('applies the mode of the first cell to a whole range', () => {
    expect(cycleReference('=SUM(A1:B2)', 8)?.text).toBe('=SUM($A$1:$B$2)');
    expect(cycleReference('=SUM($A$1:$B$2)', 8)?.text).toBe('=SUM(A$1:B$2)');
  });

  it('works with the caret at the end of the reference and returns the new span', () => {
    const r = cycleReference('=A1+B1', 3);
    expect(r).toEqual({ text: '=$A$1+B1', start: 1, end: 5 });
  });

  it('picks the reference under the caret among several', () => {
    expect(cycleReference('=A1+B1', 6)?.text).toBe('=A1+$B$1');
  });

  it('returns null away from references', () => {
    expect(cycleReference('=SUM(1)', 3)).toBeNull();
    expect(cycleReference('plain', 2)).toBeNull();
  });
});
