import { describe, expect, it } from 'vitest';
import { AxisLayout, type VisibleRange } from '../../src/core/layout/AxisLayout';

describe('AxisLayout', () => {
  it('uses the default size when nothing is overridden', () => {
    const axis = new AxisLayout(100, 20);
    expect(axis.getSize(5)).toBe(20);
    expect(axis.offsetOf(5)).toBe(100);
    expect(axis.totalSize).toBe(2000);
  });

  it('shifts later offsets when an item is resized', () => {
    const axis = new AxisLayout(10, 20);
    axis.setSize(3, 50);
    expect(axis.getSize(3)).toBe(50);
    expect(axis.offsetOf(3)).toBe(60);
    expect(axis.offsetOf(4)).toBe(110);
    expect(axis.totalSize).toBe(230);
  });

  it('supports several overrides set out of order', () => {
    const axis = new AxisLayout(10, 10);
    axis.setSize(7, 30);
    axis.setSize(2, 0);
    axis.setSize(5, 15);
    expect(axis.offsetOf(2)).toBe(20);
    expect(axis.offsetOf(3)).toBe(20);
    expect(axis.offsetOf(6)).toBe(55);
    expect(axis.offsetOf(8)).toBe(95);
    expect(axis.totalSize).toBe(115);
  });

  it('drops the override when the size returns to the default', () => {
    const axis = new AxisLayout(10, 20);
    axis.setSize(3, 50);
    axis.resetSize(3);
    expect(axis.totalSize).toBe(200);
    axis.setSize(4, 20);
    expect(axis.totalSize).toBe(200);
  });

  it('finds the index at a pixel offset, including boundaries', () => {
    const axis = new AxisLayout(10, 20);
    axis.setSize(1, 40);
    expect(axis.indexAt(0)).toBe(0);
    expect(axis.indexAt(19.9)).toBe(0);
    expect(axis.indexAt(20)).toBe(1);
    expect(axis.indexAt(59.9)).toBe(1);
    expect(axis.indexAt(60)).toBe(2);
  });

  it('clamps offsets outside the content', () => {
    const axis = new AxisLayout(10, 20);
    expect(axis.indexAt(-50)).toBe(0);
    expect(axis.indexAt(99999)).toBe(9);
    expect(new AxisLayout(0, 20).indexAt(5)).toBe(-1);
  });

  it('skips hidden items when looking up by offset', () => {
    const axis = new AxisLayout(5, 20);
    axis.setSize(1, 0);
    axis.setSize(2, 0);
    expect(axis.indexAt(20)).toBe(3);
    axis.setSize(4, 0);
    expect(axis.indexAt(79)).toBe(3);
  });

  it('computes the visible range without allocating a new object', () => {
    const axis = new AxisLayout(1000, 20);
    const out: VisibleRange = { first: 0, last: 0 };
    expect(axis.visibleRange(0, 100, out)).toBe(out);
    expect(out).toEqual({ first: 0, last: 4 });
    axis.visibleRange(10, 100, out);
    expect(out).toEqual({ first: 0, last: 5 });
    axis.visibleRange(20, 100, out);
    expect(out).toEqual({ first: 1, last: 5 });
  });

  it('rejects invalid input', () => {
    expect(() => new AxisLayout(-1, 20)).toThrow(RangeError);
    expect(() => new AxisLayout(10, 0)).toThrow(RangeError);
    const axis = new AxisLayout(10, 20);
    expect(() => axis.setSize(10, 5)).toThrow(RangeError);
    expect(() => axis.setSize(0, -1)).toThrow(RangeError);
    expect(() => axis.setSize(0, Number.NaN)).toThrow(RangeError);
  });

  it('matches a brute-force model on random resizes', () => {
    let seed = 12345;
    const rand = (n: number): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed % n;
    };
    const count = 500;
    const axis = new AxisLayout(count, 21);
    const sizes = new Array<number>(count).fill(21);
    for (let step = 0; step < 300; step++) {
      const i = rand(count);
      const size = rand(4) === 0 ? 0 : 5 + rand(80);
      axis.setSize(i, size);
      sizes[i] = size;
      const probe = rand(count + 1);
      let expected = 0;
      for (let k = 0; k < probe; k++) expected += sizes[k] as number;
      expect(axis.offsetOf(probe)).toBe(expected);
    }
    let start = 0;
    for (let i = 0; i < count; i++) {
      const size = sizes[i] as number;
      if (size > 0) {
        expect(axis.indexAt(start)).toBe(i);
        expect(axis.indexAt(start + size - 0.5)).toBe(i);
      }
      start += size;
    }
  });

  it('handles 1,000,000 rows with a few overrides quickly', () => {
    const axis = new AxisLayout(1_000_000, 21);
    for (let i = 0; i < 1000; i++) axis.setSize(i * 997, 40);
    expect(axis.totalSize).toBe(21 * 1_000_000 + 1000 * 19);
    const t0 = performance.now();
    let acc = 0;
    for (let i = 0; i < 100_000; i++) acc += axis.indexAt(i * 200);
    expect(acc).toBeGreaterThan(0);
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});
