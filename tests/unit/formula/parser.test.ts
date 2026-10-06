import { describe, expect, it } from 'vitest';
import { parseFormula, parseFormulaSafe } from '../../../src/formula/parser';
import { printFormula } from '../../../src/formula/print';
import { FormulaSyntaxError } from '../../../src/formula/tokenizer';

// Parse at C3 (row 2, col 2) and print back at the same cell.
const roundTrip = (text: string): string => printFormula(parseFormula(text, 2, 2), 2, 2);

describe('parser -> printer round trip', () => {
  it.each([
    ['=1+2*3', '=1+2*3'],
    ['=(1+2)*3', '=(1+2)*3'],
    ['=1-(2-3)', '=1-(2-3)'],
    ['=1-2-3', '=1-2-3'],
    ['=(1+2)+3', '=1+2+3'],
    ['=2^3^2', '=2^3^2'],
    ['=2^(3^2)', '=2^(3^2)'],
    ['=-2^2', '=-2^2'],
    ['=-(2^2)', '=-(2^2)'],
    ['=2^-1', '=2^-1'],
    ['=50%', '=50%'],
    ['=(1+2)%', '=(1+2)%'],
    ['=A1&"x"&B2', '=A1&"x"&B2'],
    ['="a""b"', '="a""b"'],
    ['=1+2&3', '=1+2&3'],
    ['=(1&2)+3', '=(1&2)+3'],
    ['=A1=B1', '=A1=B1'],
    ['=A1<>1', '=A1<>1'],
    ['=SUM(A1:B2,$C$3,D$4)', '=SUM(A1:B2,$C$3,D$4)'],
    ['=sum(a1:b2)', '=SUM(A1:B2)'],
    ['=SUM(1;2)', '=SUM(1,2)'],
    ['=IF(A1>1,"y","n")', '=IF(A1>1,"y","n")'],
    ['=SUM(A:A)', '=SUM(A:A)'],
    ['=SUM($A:B)', '=SUM($A:B)'],
    ['=SUM(1:3)', '=SUM(1:3)'],
    ['=TRUE', '=TRUE'],
    ['=false', '=FALSE'],
    ['=#N/A', '=#N/A'],
    ['=SUM()', '=SUM()'],
    ['=B2:A1', '=B2:A1'],
  ])('%s -> %s', (input, expected) => {
    expect(roundTrip(input)).toBe(expected);
  });
});

describe('relative storage', () => {
  it('stores relative refs as offsets so the same tree prints differently elsewhere', () => {
    const expr = parseFormula('=A1+$B$1', 2, 2); // at C3: A1 is (-2,-2), $B$1 is absolute
    expect(printFormula(expr, 2, 2)).toBe('=A1+$B$1');
    expect(printFormula(expr, 3, 2)).toBe('=A2+$B$1'); // pasted one row down
    expect(printFormula(expr, 3, 5)).toBe('=D2+$B$1'); // and three columns right
  });

  it('prints #REF! for a relative ref pushed off the sheet', () => {
    const expr = parseFormula('=A1', 2, 2);
    expect(printFormula(expr, 0, 0)).toBe('=#REF!');
  });

  it('mixed absolute row / relative column', () => {
    const expr = parseFormula('=A$1', 5, 5);
    expect(printFormula(expr, 9, 7)).toBe('=C$1');
  });
});

describe('precedence', () => {
  it('has & looser than + and comparison loosest', () => {
    expect(parseFormula('=1+2&3', 0, 0)).toMatchObject({ t: 'bin', op: '&' });
    expect(parseFormula('=1&2=3', 0, 0)).toMatchObject({ t: 'bin', op: '=' });
  });

  it('applies unary minus before ^', () => {
    expect(parseFormula('=-2^2', 0, 0)).toMatchObject({ t: 'bin', op: '^', l: { t: 'un', op: '-' } });
  });
});

describe('syntax errors', () => {
  it.each(['=', '=1+', '=(1', '=1)', '=SUM(1,', '=SUM(1 2)', '=*2', '="abc', '=1 2', '=A1:'])('throws for %s', (text) => {
    expect(() => parseFormula(text, 0, 0)).toThrow(FormulaSyntaxError);
  });

  it('parseFormulaSafe keeps the source text for display', () => {
    const expr = parseFormulaSafe('=1+', 0, 0);
    expect(expr).toMatchObject({ t: 'err', v: '#ERROR!', raw: '=1+' });
    expect(printFormula(expr, 0, 0)).toBe('=1+');
  });

  it('turns unknown names into #NAME? and out-of-range refs into #REF!', () => {
    expect(parseFormula('=foo', 0, 0)).toMatchObject({ t: 'err', v: '#NAME?' });
    expect(parseFormula('=ZZZ1', 0, 0)).toMatchObject({ t: 'err', v: '#REF!' });
    expect(parseFormula('=A9999999', 0, 0)).toMatchObject({ t: 'err', v: '#REF!' });
  });
});
