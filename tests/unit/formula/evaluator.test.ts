import { describe, expect, it } from 'vitest';
import { calc, e } from './helpers';

describe('arithmetic and coercion', () => {
  it.each([
    ['=1+2*3', 7],
    ['=(1+2)*3', 9],
    ['=10/4', 2.5],
    ['=2^3^2', 64],
    ['=-2^2', 4],
    ['=2^-1', 0.5],
    ['=50%', 0.5],
    ['=200*10%', 20],
    ['=-"3"', -3],
    ['="5"+1', 6],
    ['=TRUE+1', 2],
    ['=""+1', 1],
    ['=0.1+0.2', 0.30000000000000004],
  ])('%s = %j', (formula, expected) => {
    expect(calc(formula)).toBe(expected);
  });

  it.each([
    ['="abc"+1', '#VALUE!'],
    ['=1/0', '#DIV/0!'],
    ['=0/0', '#DIV/0!'],
    ['=0^-1', '#DIV/0!'],
    ['=10^1000', '#NUM!'],
    ['=-"x"', '#VALUE!'],
    ['=#N/A+1', '#N/A'],
    ['=1+#REF!', '#REF!'],
    ['=#DIV/0!&"x"', '#DIV/0!'],
    ['=FOO(1)', '#NAME?'],
    ['=foo', '#NAME?'],
  ])('%s gives %s', (formula, code) => {
    expect(calc(formula)).toEqual(e(code));
  });

  it('propagates the left error first', () => {
    expect(calc('=#N/A+#REF!')).toEqual(e('#N/A'));
  });

  it('an unparseable formula shows #ERROR!', () => {
    expect(calc('=1+')).toEqual(e('#ERROR!'));
    expect(calc('=SUM(1 2)')).toEqual(e('#ERROR!'));
  });

  it('a range cannot be used in arithmetic or as a whole result', () => {
    expect(calc('=A1:A2+1', { A1: 1, A2: 2 })).toEqual(e('#VALUE!'));
    expect(calc('=A1:A2', { A1: 1, A2: 2 })).toEqual(e('#VALUE!'));
  });
});

describe('text and comparison', () => {
  it.each([
    ['="a"&"b"', 'ab'],
    ['=1&2', '12'],
    ['=TRUE&"x"', 'TRUEx'],
    ['=1/3&""', '0.333333333333333'],
    ['=1+2&3', '33'],
  ])('%s = %j', (formula, expected) => {
    expect(calc(formula)).toBe(expected);
  });

  it.each([
    ['=1<2', true],
    ['=2<=2', true],
    ['=3<>3', false],
    ['="a"="A"', true],
    ['="b">"a"', true],
    ['=1="1"', false],
    ['=2>"a"', false],
    ['=TRUE>"z"', true],
    ['=TRUE>5', true],
    ['=1=1+0', true],
  ])('%s = %j', (formula, expected) => {
    expect(calc(formula)).toBe(expected);
  });

  it('treats an empty cell as 0, "" or FALSE depending on the other side', () => {
    expect(calc('=A1=0')).toBe(true);
    expect(calc('=A1=""')).toBe(true);
    expect(calc('=A1=FALSE')).toBe(true);
    expect(calc('=A1=1')).toBe(false);
    expect(calc('=A1+1')).toBe(1);
    expect(calc('=A1&"x"')).toBe('x');
  });

  it('reads cell values, including text numbers typed as text', () => {
    expect(calc('=A1+B1', { A1: 2, B1: 3 })).toBe(5);
    expect(calc('=A1&B1', { A1: 'x', B1: 'y' })).toBe('xy');
    expect(calc('=A1+1', { A1: "'7" })).toBe(8);
    expect(calc('=A1+1', { A1: 'hello' })).toEqual(e('#VALUE!'));
  });
});
