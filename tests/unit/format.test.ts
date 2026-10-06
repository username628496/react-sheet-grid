import { describe, expect, it } from 'vitest';
import { cellAddress, columnLabel, parseColumnLabel } from '../../src/core/model/address';
import { defaultAlign, formatValue } from '../../src/core/model/format';
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
