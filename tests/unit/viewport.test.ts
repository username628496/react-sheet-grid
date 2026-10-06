import { describe, expect, it } from 'vitest';
import { AxisLayout } from '../../src/core/layout/AxisLayout';
import { computeScrollMetrics, MAX_PHYSICAL_SCROLL, Viewport } from '../../src/render/viewport';

function make(opts: { frozenRows?: number; frozenCols?: number } = {}): Viewport {
  const vp = new Viewport(new AxisLayout(1000, 20), new AxisLayout(50, 100));
  vp.width = 650; // 50 header + 600 content
  vp.height = 224; // 24 header + 200 content
  vp.frozenRows = opts.frozenRows ?? 0;
  vp.frozenCols = opts.frozenCols ?? 0;
  return vp;
}

describe('Viewport segments', () => {
  it('shows the first visible rows and columns at scroll 0', () => {
    const vp = make();
    vp.updateSegments();
    expect(vp.colSegments[1]).toMatchObject({ first: 0, last: 5, origin: 50 });
    expect(vp.rowSegments[1]).toMatchObject({ first: 0, last: 9, origin: 24 });
    expect(vp.colSegments[0].last).toBeLessThan(vp.colSegments[0].first);
  });

  it('follows the scroll position', () => {
    const vp = make();
    vp.scrollX = 250;
    vp.scrollY = 105;
    vp.updateSegments();
    expect(vp.colSegments[1].first).toBe(2);
    expect(vp.colSegments[1].last).toBe(8);
    expect(vp.rowSegments[1].first).toBe(5);
    expect(vp.colLeft(2)).toBe(50 + 200 - 250);
    expect(vp.rowTop(5)).toBe(24 + 100 - 105);
  });

  it('keeps frozen items pinned while the rest scrolls beneath', () => {
    const vp = make({ frozenRows: 1, frozenCols: 1 });
    vp.scrollX = 300;
    vp.scrollY = 400;
    vp.updateSegments();
    expect(vp.colSegments[0]).toMatchObject({ first: 0, last: 0, clipStart: 50, clipEnd: 150 });
    // scroll is measured past the frozen area, so 300px scrolled = columns from index 4.
    expect(vp.colSegments[1].first).toBe(4);
    expect(vp.colSegments[1].clipStart).toBe(150);
    expect(vp.colLeft(0)).toBe(50);
    expect(vp.colLeft(4)).toBe(150);
    expect(vp.rowTop(0)).toBe(24);
    expect(vp.rowSegments[1].first).toBe(21);
  });

  it('computes max scroll from content minus the scrolling area', () => {
    const vp = make({ frozenCols: 1 });
    expect(vp.maxScrollX).toBe(5000 - 100 - 500);
    expect(vp.maxScrollY).toBe(20000 - 200);
    vp.scrollX = 1e9;
    vp.clampScroll();
    expect(vp.scrollX).toBe(vp.maxScrollX);
  });
});

describe('Viewport hit testing', () => {
  it('maps pixels to cells and rejects headers', () => {
    const vp = make();
    vp.scrollX = 30;
    vp.scrollY = 10;
    expect(vp.colAt(10)).toBe(-1);
    expect(vp.rowAt(10)).toBe(-1);
    expect(vp.colAt(50)).toBe(0); // 30px into column 0
    expect(vp.colAt(50 + 70)).toBe(1);
    expect(vp.rowAt(24)).toBe(0);
    expect(vp.rowAt(24 + 10)).toBe(1);
  });

  it('prefers frozen cells under the frozen area', () => {
    const vp = make({ frozenCols: 1 });
    vp.scrollX = 200;
    expect(vp.colAt(60)).toBe(0);
    expect(vp.colAt(160)).toBe(3);
  });

  it('clamps to the nearest cell for drag selection', () => {
    const vp = make();
    expect(vp.colAtClamped(-100)).toBe(0);
    expect(vp.colAtClamped(1e9)).toBe(49);
    expect(vp.rowAtClamped(1e9)).toBe(999);
  });

  it('returns -1 past the last column', () => {
    const vp = new Viewport(new AxisLayout(10, 20), new AxisLayout(2, 100));
    vp.width = 1000;
    vp.height = 300;
    expect(vp.colAt(50 + 250)).toBe(-1);
  });
});

describe('Viewport.scrollIntoView', () => {
  it('scrolls minimally to reveal a cell below and to the right', () => {
    const vp = make();
    expect(vp.scrollIntoView(20, 10)).toBe(true);
    expect(vp.scrollY).toBe(21 * 20 - 200);
    expect(vp.scrollX).toBe(11 * 100 - 600);
  });

  it('does nothing for a visible cell and for frozen cells', () => {
    const vp = make({ frozenRows: 1, frozenCols: 1 });
    vp.scrollX = 100;
    expect(vp.scrollIntoView(3, 2)).toBe(false);
    expect(vp.scrollIntoView(0, 0)).toBe(false);
  });

  it('scrolls back up and left', () => {
    const vp = make();
    vp.scrollX = 500;
    vp.scrollY = 500;
    vp.scrollIntoView(2, 1);
    expect(vp.scrollX).toBe(100);
    expect(vp.scrollY).toBe(40);
  });
});

describe('computeScrollMetrics', () => {
  it('is 1:1 below the cap', () => {
    expect(computeScrollMetrics(5000)).toEqual({ physical: 5000, scale: 1 });
  });

  it('scales down huge extents so the host stays within browser limits', () => {
    const m = computeScrollMetrics(21_000_000);
    expect(m.physical).toBe(MAX_PHYSICAL_SCROLL);
    expect(m.scale).toBeCloseTo(21_000_000 / MAX_PHYSICAL_SCROLL);
  });

  it('handles nothing to scroll', () => {
    expect(computeScrollMetrics(0)).toEqual({ physical: 0, scale: 1 });
  });
});
