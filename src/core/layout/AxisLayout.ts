export interface VisibleRange {
  first: number;
  last: number; // inclusive
}

/**
 * Sizes along one axis (rows or columns) in *view* coordinates.
 *
 * Only sizes that differ from the default are stored, so 1M rows cost memory
 * proportional to the number of resized rows. `prefix[k]` holds the summed
 * (size - defaultSize) of the first k overrides; that makes `offsetOf` a
 * binary search plus one multiply instead of an O(n) walk. The prefix array
 * is rebuilt lazily, so a burst of `setSize` calls pays for one rebuild.
 * A size of 0 means hidden.
 */
export class AxisLayout {
  readonly count: number;
  readonly defaultSize: number;

  private readonly overrideIndex: number[] = [];
  private readonly overrideSize: number[] = [];
  private prefix: number[] = [0];
  private prefixDirty = false;

  constructor(count: number, defaultSize: number) {
    if (!Number.isInteger(count) || count < 0) {
      throw new RangeError(`Invalid count: ${count}`);
    }
    if (!Number.isFinite(defaultSize) || defaultSize <= 0) {
      throw new RangeError(`Invalid default size: ${defaultSize}`);
    }
    this.count = count;
    this.defaultSize = defaultSize;
  }

  get totalSize(): number {
    return this.offsetOf(this.count);
  }

  getSize(viewIndex: number): number {
    const k = this.lowerBound(viewIndex);
    return this.overrideIndex[k] === viewIndex
      ? (this.overrideSize[k] as number)
      : this.defaultSize;
  }

  setSize(viewIndex: number, size: number): void {
    if (!Number.isInteger(viewIndex) || viewIndex < 0 || viewIndex >= this.count) {
      throw new RangeError(`Index ${viewIndex} is out of bounds`);
    }
    if (!Number.isFinite(size) || size < 0) {
      throw new RangeError(`Invalid size: ${size}`);
    }
    const k = this.lowerBound(viewIndex);
    const exists = this.overrideIndex[k] === viewIndex;
    if (size === this.defaultSize) {
      if (!exists) return;
      this.overrideIndex.splice(k, 1);
      this.overrideSize.splice(k, 1);
    } else if (exists) {
      this.overrideSize[k] = size;
    } else {
      this.overrideIndex.splice(k, 0, viewIndex);
      this.overrideSize.splice(k, 0, size);
    }
    this.prefixDirty = true;
  }

  resetSize(viewIndex: number): void {
    this.setSize(viewIndex, this.defaultSize);
  }

  /** Start position of `viewIndex`; `offsetOf(count)` is the total size. */
  offsetOf(viewIndex: number): number {
    this.ensurePrefix();
    return viewIndex * this.defaultSize + (this.prefix[this.lowerBound(viewIndex)] as number);
  }

  /**
   * Index of the item containing `offset`, clamped to [0, count - 1].
   * Picks the largest index whose start is <= offset, so hidden (zero-size)
   * items sharing a start position are skipped in favour of the visible one.
   */
  indexAt(offset: number): number {
    if (this.count === 0) return -1;
    let lo = 0;
    let hi = this.count - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1;
      if (this.offsetOf(mid) <= offset) lo = mid;
      else hi = mid - 1;
    }
    // Past the content the search lands on the last index even if it is
    // hidden; step back so callers always get the last visible item.
    if (this.getSize(lo) === 0 && offset >= this.totalSize) {
      while (lo > 0 && this.getSize(lo) === 0) lo--;
    }
    return lo;
  }

  /**
   * Fills `out` with the indices intersecting [scroll, scroll + viewportSize).
   * Writes into a caller-owned object because this runs every frame and the
   * render loop must not allocate.
   */
  visibleRange(scroll: number, viewportSize: number, out: VisibleRange): VisibleRange {
    out.first = this.indexAt(scroll);
    // The epsilon keeps an item that starts exactly at the viewport's end out.
    out.last = this.indexAt(scroll + viewportSize - 1e-9);
    return out;
  }

  // First position k in overrideIndex with overrideIndex[k] >= viewIndex.
  private lowerBound(viewIndex: number): number {
    let lo = 0;
    let hi = this.overrideIndex.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if ((this.overrideIndex[mid] as number) < viewIndex) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  private ensurePrefix(): void {
    if (!this.prefixDirty) return;
    const n = this.overrideIndex.length;
    const prefix = new Array<number>(n + 1);
    prefix[0] = 0;
    for (let k = 0; k < n; k++) {
      prefix[k + 1] = (prefix[k] as number) + (this.overrideSize[k] as number) - this.defaultSize;
    }
    this.prefix = prefix;
    this.prefixDirty = false;
  }
}
