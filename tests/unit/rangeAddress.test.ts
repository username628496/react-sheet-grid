import { describe, expect, it } from 'vitest';
import { formatRangeAddress, parseRangeAddress } from '../../src/core/model/address';

const parse = (t: string) => parseRangeAddress(t, 1000, 26);

describe('parseRangeAddress', () => {
  it.each([
    ['B3', { startRow: 2, startCol: 1, endRow: 2, endCol: 1 }],
    ['b3', { startRow: 2, startCol: 1, endRow: 2, endCol: 1 }],
    ['$B$3', { startRow: 2, startCol: 1, endRow: 2, endCol: 1 }],
    ['A1:C5', { startRow: 0, startCol: 0, endRow: 4, endCol: 2 }],
    ['C5:A1', { startRow: 0, startCol: 0, endRow: 4, endCol: 2 }], // corners in any order
    [' B2 ', { startRow: 1, startCol: 1, endRow: 1, endCol: 1 }],
    ['B:B', { startRow: 0, startCol: 1, endRow: 999, endCol: 1 }],
    ['A:C', { startRow: 0, startCol: 0, endRow: 999, endCol: 2 }],
    ['2:2', { startRow: 1, startCol: 0, endRow: 1, endCol: 25 }],
    ['3:5', { startRow: 2, startCol: 0, endRow: 4, endCol: 25 }],
  ])('%s', (text, expected) => {
    expect(parse(text)).toEqual(expected);
  });

  it.each(['', 'abc1x', 'A0', 'A1:', ':A1', 'A1:B2:C3', 'AA1', 'A1001', 'A:1', '1:B', '0:3', 'Z27x', '-1'])('rejects %j', (text) => {
    expect(parse(text)).toBeNull();
  });
});

describe('formatRangeAddress', () => {
  const fmt = (r: [number, number, number, number]) =>
    formatRangeAddress({ startRow: r[0], startCol: r[1], endRow: r[2], endCol: r[3] }, 1000, 26);
  it('shows a cell, a range, whole columns and whole rows', () => {
    expect(fmt([2, 1, 2, 1])).toBe('B3');
    expect(fmt([0, 0, 4, 2])).toBe('A1:C5');
    expect(fmt([0, 1, 999, 1])).toBe('B:B');
    expect(fmt([0, 0, 999, 2])).toBe('A:C');
    expect(fmt([1, 0, 1, 25])).toBe('2:2');
    expect(fmt([0, 0, 999, 25])).toBe('A1:Z1000');
  });

  it('round-trips through parseRangeAddress', () => {
    for (const r of [[2, 1, 2, 1], [0, 0, 4, 2], [0, 1, 999, 1], [1, 0, 3, 25]] as const) {
      const text = fmt([...r]);
      expect(parse(text)).toEqual({ startRow: r[0], startCol: r[1], endRow: r[2], endCol: r[3] });
    }
  });
});
