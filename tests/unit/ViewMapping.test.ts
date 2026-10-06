import { describe, expect, it } from 'vitest';
import { ViewMapping } from '../../src/core/mapping/ViewMapping';

describe('ViewMapping', () => {
  it('is the identity by default', () => {
    const m = new ViewMapping(10, 3);
    expect(m.isIdentity).toBe(true);
    expect(m.viewRowCount).toBe(10);
    expect(m.toDataRow(7)).toBe(7);
    expect(m.toViewRow(7)).toBe(7);
  });

  it('maps through an order and back, hiding rows that are not in it', () => {
    const m = new ViewMapping(5, 2);
    m.setOrder(Int32Array.from([3, 1, 4]));
    expect(m.viewRowCount).toBe(3);
    expect(m.dataRowCount).toBe(5);
    expect(m.toDataRow(0)).toBe(3);
    expect(m.toDataRow(2)).toBe(4);
    expect(m.toViewRow(1)).toBe(1);
    expect(m.toViewRow(4)).toBe(2);
    expect(m.toViewRow(0)).toBe(-1);
    expect(m.toDataRow(9)).toBe(-1);
  });

  it('restores identity', () => {
    const m = new ViewMapping(5, 2);
    m.setOrder(Int32Array.from([4]));
    m.setOrder(null);
    expect(m.viewRowCount).toBe(5);
    expect(m.toViewRow(0)).toBe(0);
  });
});
