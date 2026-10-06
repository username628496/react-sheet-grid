import { describe, expect, it } from 'vitest';
import { cellAddress, columnLabel, parseColumnLabel } from '../../src/core/model/address';
import { defaultAlign, formatValue, shiftDecimals } from '../../src/core/model/format';
import { parseInput } from '../../src/core/model/parseInput';

describe('formatValue', () => {
  it('formats by type', () => {
    expect(formatValue(null)).toBe('');
    expect(formatValue('abc')).toBe('abc');
    expect(formatValue(true)).toBe('TRUE');
    expect(formatValue(false)).toBe('FALSE');
    expect(formatValue({ error: '#DIV/0!' })).toBe('#DIV/0!');
  });

  it('hides floating point noise in general format', () => {
    expect(formatValue(0.1 + 0.2)).toBe('0.3');
    expect(formatValue(1234567)).toBe('1234567');
    expect(formatValue(-2.5)).toBe('-2.5');
  });

  it('applies number formats', () => {
    expect(formatValue(1234.5, '0')).toBe('1235');
    expect(formatValue(1234.5, '0.00')).toBe('1234.50');
    expect(formatValue(1234567.891, '#,##0.00')).toBe('1,234,567.89');
    expect(formatValue(0.256, '0%')).toBe('26%');
    expect(formatValue(0.2567, '0.00%')).toBe('25.67%');
    expect(formatValue(-1234.5, '$#,##0.00')).toBe('-$1,234.50');
    expect(formatValue(5, 'general')).toBe('5');
  });

  it('does not format text or non-finite numbers', () => {
    expect(formatValue('12', '0.00')).toBe('12');
    expect(formatValue(Infinity, '0.00')).toBe('Infinity');
  });
});

describe('defaultAlign', () => {
  it('matches Sheets defaults', () => {
    expect(defaultAlign(1)).toBe('right');
    expect(defaultAlign('a')).toBe('left');
    expect(defaultAlign(true)).toBe('center');
    expect(defaultAlign({ error: '#N/A' })).toBe('center');
    expect(defaultAlign(null)).toBe('left');
  });
});

describe('parseInput', () => {
  it('parses numbers, booleans and text', () => {
    expect(parseInput('')).toBeNull();
    expect(parseInput('42')).toBe(42);
    expect(parseInput(' -3.5 ')).toBe(-3.5);
    expect(parseInput('1e3')).toBe(1000);
    expect(parseInput('.5')).toBe(0.5);
    expect(parseInput('true')).toBe(true);
    expect(parseInput('FALSE')).toBe(false);
    expect(parseInput('hello')).toBe('hello');
    expect(parseInput('12abc')).toBe('12abc');
    expect(parseInput('Việt Nam')).toBe('Việt Nam');
  });

  it('forces text with a leading apostrophe', () => {
    expect(parseInput("'007")).toBe('007');
  });
});

describe('column addresses', () => {
  it('converts both ways', () => {
    expect(columnLabel(0)).toBe('A');
    expect(columnLabel(25)).toBe('Z');
    expect(columnLabel(26)).toBe('AA');
    expect(columnLabel(701)).toBe('ZZ');
    expect(columnLabel(702)).toBe('AAA');
    for (const i of [0, 1, 25, 26, 51, 701, 702, 16383]) expect(parseColumnLabel(columnLabel(i))).toBe(i);
    expect(parseColumnLabel('a')).toBe(0);
    expect(parseColumnLabel('1')).toBe(-1);
    expect(cellAddress(0, 0)).toBe('A1');
    expect(cellAddress(9, 27)).toBe('AB10');
  });
});

describe('number format patterns', () => {
  it.each([
    [1234.5, '0.0', '1234.5'],
    [1234.5, '0.000', '1234.500'],
    [1234567.891, '#,##0.0', '1,234,567.9'],
    [0.256, '0.0%', '25.6%'],
    [-0.256, '0%', '-26%'],
    [1234.5, '€#,##0.00', '€1,234.50'],
    [-1234.5, '£#,##0', '-£1,235'],
    [1234567, '#,##0 ₫', '1,234,567 ₫'],
    [1234.5, '#,##0.00 USD', '1,234.50 USD'],
    [-0.001, '0.00', '0.00'], // no "-0.00"
    [-0.001, '$#,##0.00', '$0.00'],
    [5, '0.0000000000', '5.0000000000'],
  ])('%s with %s', (n, format, expected) => {
    expect(formatValue(n, format)).toBe(expected);
  });

  it('an unknown pattern falls back to the automatic format', () => {
    expect(formatValue(1.5, 'nonsense')).toBe('1.5');
    expect(formatValue(1.5, '0.00000000000')).toBe('1.5'); // more than the supported decimals
  });
});

describe('shiftDecimals', () => {
  it('moves the decimals of an existing pattern and keeps the rest of it', () => {
    expect(shiftDecimals('0', 1, 3)).toBe('0.0');
    expect(shiftDecimals('#,##0.00', -1, 3)).toBe('#,##0.0');
    expect(shiftDecimals('$#,##0.00', -1, 3)).toBe('$#,##0.0');
    expect(shiftDecimals('0.0%', 1, 0.5)).toBe('0.00%');
    expect(shiftDecimals('#,##0 ₫', 1, 3)).toBe('#,##0.0 ₫');
  });

  it('never goes below zero or above the maximum', () => {
    expect(shiftDecimals('0', -1, 3)).toBe('0');
    expect(shiftDecimals('0.0000000000', 1, 3)).toBe('0.0000000000');
  });

  it('starts from what the automatic format shows', () => {
    expect(shiftDecimals(undefined, 1, 1.5)).toBe('0.00');
    expect(shiftDecimals(undefined, 1, 3)).toBe('0.0');
    expect(shiftDecimals(undefined, -1, 3.14)).toBe('0.0');
    expect(shiftDecimals(undefined, 1, null)).toBe('0.0');
    expect(shiftDecimals('nonsense', 1, 2.5)).toBe('0.00');
  });
});
