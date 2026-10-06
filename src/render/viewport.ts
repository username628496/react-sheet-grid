import type { AxisLayout, VisibleRange } from '../core/layout/AxisLayout';

/**
 * One contiguous run of items on an axis. A screen position for item `i` is
 * `origin + layout.offsetOf(i) - base`. Frozen items use base 0; scrolling
 * items use base = frozenSize + scroll, which is how frozen panes stay put.
 */
export interface Segment {
  first: number;
  last: number; // inclusive; last < first means empty
  origin: number;
  base: number;
  clipStart: number;
  clipEnd: number;
  frozen: boolean;
}

function newSegment(frozen: boolean): Segment {
  return { first: 0, last: -1, origin: 0, base: 0, clipStart: 0, clipEnd: 0, frozen };
}

/** Geometry of the visible grid in CSS pixels. Scroll values are logical (unscaled). */
export class Viewport {
  width = 0;
  height = 0;
  scrollX = 0;
  scrollY = 0;
  headerWidth = 50;
  headerHeight = 24;
  frozenRows = 0;
  frozenCols = 0;

  // Reused every frame so the render loop never allocates.
  readonly rowSegments: [Segment, Segment] = [newSegment(true), newSegment(false)];
  readonly colSegments: [Segment, Segment] = [newSegment(true), newSegment(false)];
  private readonly range: VisibleRange = { first: 0, last: 0 };

  constructor(
    private readonly rows: AxisLayout,
    private readonly cols: AxisLayout,
  ) {}

  get frozenWidth(): number {
    return this.cols.offsetOf(Math.min(this.frozenCols, this.cols.count));
  }

  get frozenHeight(): number {
    return this.rows.offsetOf(Math.min(this.frozenRows, this.rows.count));
  }

  get scrollAreaWidth(): number {
    return Math.max(0, this.width - this.headerWidth - this.frozenWidth);
  }

  get scrollAreaHeight(): number {
    return Math.max(0, this.height - this.headerHeight - this.frozenHeight);
  }

  get maxScrollX(): number {
    return Math.max(0, this.cols.totalSize - this.frozenWidth - this.scrollAreaWidth);
  }

  get maxScrollY(): number {
    return Math.max(0, this.rows.totalSize - this.frozenHeight - this.scrollAreaHeight);
  }

  clampScroll(): void {
    this.scrollX = Math.min(Math.max(0, this.scrollX), this.maxScrollX);
    this.scrollY = Math.min(Math.max(0, this.scrollY), this.maxScrollY);
  }

  /** Recomputes the four segments for the current size and scroll position. */
  updateSegments(): void {
    this.fillAxis(this.colSegments, this.cols, this.frozenCols, this.headerWidth, this.width, this.scrollX);
    this.fillAxis(this.rowSegments, this.rows, this.frozenRows, this.headerHeight, this.height, this.scrollY);
  }

  private fillAxis(
    segments: [Segment, Segment],
    layout: AxisLayout,
    frozenCount: number,
    header: number,
    extent: number,
    scroll: number,
  ): void {
    const frozenN = Math.min(frozenCount, layout.count);
    const frozenSize = layout.offsetOf(frozenN);
    const [frozen, scrolling] = segments;

    frozen.first = 0;
    frozen.last = frozenN - 1;
    frozen.origin = header;
    frozen.base = 0;
    frozen.clipStart = header;
    frozen.clipEnd = Math.min(extent, header + frozenSize);

    const visibleSize = Math.max(0, extent - header - frozenSize);
    scrolling.origin = header + frozenSize;
    scrolling.base = frozenSize + scroll;
    scrolling.clipStart = header + frozenSize;
    scrolling.clipEnd = extent;
    if (frozenN >= layout.count || visibleSize === 0) {
      scrolling.first = 0;
      scrolling.last = -1;
      return;
    }
    layout.visibleRange(frozenSize + scroll, visibleSize, this.range);
    scrolling.first = Math.max(this.range.first, frozenN);
    scrolling.last = this.range.last;
  }

  /** Screen x of the left edge of `viewCol` (may be off-screen). */
  colLeft(viewCol: number): number {
    const off = this.cols.offsetOf(viewCol);
    return viewCol < this.frozenCols ? this.headerWidth + off : this.headerWidth + off - this.scrollX;
  }

  rowTop(viewRow: number): number {
    const off = this.rows.offsetOf(viewRow);
    return viewRow < this.frozenRows ? this.headerHeight + off : this.headerHeight + off - this.scrollY;
  }

  /** View column under screen x, or -1 over the header or past the last column. */
  colAt(x: number): number {
    const index = this.colAtClamped(x);
    if (x < this.headerWidth || index < 0) return -1;
    return x - this.colLeft(index) < this.cols.getSize(index) ? index : -1;
  }

  rowAt(y: number): number {
    const index = this.rowAtClamped(y);
    if (y < this.headerHeight || index < 0) return -1;
    return y - this.rowTop(index) < this.rows.getSize(index) ? index : -1;
  }

  /** Like colAt but clamps to the nearest column, for drag selection. */
  colAtClamped(x: number): number {
    const rel = x - this.headerWidth;
    const offset = this.frozenCols > 0 && rel < this.frozenWidth ? rel : rel + this.scrollX;
    return this.cols.indexAt(Math.max(offset, 0));
  }

  rowAtClamped(y: number): number {
    const rel = y - this.headerHeight;
    const offset = this.frozenRows > 0 && rel < this.frozenHeight ? rel : rel + this.scrollY;
    return this.rows.indexAt(Math.max(offset, 0));
  }

  /** Scrolls the minimum distance so the cell is fully inside the scrolling area. Returns true if it moved. */
  scrollIntoView(viewRow: number, viewCol: number): boolean {
    const beforeX = this.scrollX;
    const beforeY = this.scrollY;
    if (viewCol >= this.frozenCols) {
      const left = this.cols.offsetOf(viewCol) - this.frozenWidth;
      const right = left + this.cols.getSize(viewCol);
      if (left < this.scrollX) this.scrollX = left;
      else if (right > this.scrollX + this.scrollAreaWidth) this.scrollX = right - this.scrollAreaWidth;
    }
    if (viewRow >= this.frozenRows) {
      const top = this.rows.offsetOf(viewRow) - this.frozenHeight;
      const bottom = top + this.rows.getSize(viewRow);
      if (top < this.scrollY) this.scrollY = top;
      else if (bottom > this.scrollY + this.scrollAreaHeight) this.scrollY = bottom - this.scrollAreaHeight;
    }
    this.clampScroll();
    return this.scrollX !== beforeX || this.scrollY !== beforeY;
  }
}

/**
 * Browsers cap element height (~17.9M px in Firefox) and 1M rows x 21px is
 * 21M. The scroll host therefore gets at most CAP physical pixels and the
 * logical scroll is `physical * scale`.
 */
export const MAX_PHYSICAL_SCROLL = 8_000_000;

export interface ScrollMetrics {
  physical: number; // scrollable distance given to the native scroll host
  scale: number; // logical px per physical px, >= 1
}

export function computeScrollMetrics(maxLogicalScroll: number): ScrollMetrics {
  const physical = Math.min(maxLogicalScroll, MAX_PHYSICAL_SCROLL);
  return { physical, scale: physical > 0 ? maxLogicalScroll / physical : 1 };
}
