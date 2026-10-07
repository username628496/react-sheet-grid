/**
 * A merged block of cells. The top-left cell (the anchor) holds the content; the others are covered. Coordinates are
 * view = data coordinates: merges only exist while the sheet is not sorted or filtered (sorting a sheet with merged
 * cells is refused, as in Google Sheets), so the two coincide.
 */
export interface MergeRegion {
  readonly row: number;
  readonly col: number;
  readonly rowSpan: number;
  readonly colSpan: number;
}

export interface CellRect {
  readonly startRow: number;
  readonly startCol: number;
  readonly endRow: number;
  readonly endCol: number;
}

export const endRowOf = (m: MergeRegion): number => m.row + m.rowSpan - 1;
export const endColOf = (m: MergeRegion): number => m.col + m.colSpan - 1;

/** Shifts a region's extent along one axis after inserting/deleting; null when nothing of it is left. */
function shiftSpan(start: number, span: number, kind: 'insert' | 'delete', at: number, count: number): [number, number] | null {
  const end = start + span - 1;
  if (kind === 'insert') {
    if (start >= at) return [start + count, span];
    if (end >= at) return [start, span + count]; // the new lines open up inside the region
    return [start, span];
  }
  const cutEnd = at + count - 1;
  const overlap = Math.max(0, Math.min(end, cutEnd) - Math.max(start, at) + 1);
  const left = span - overlap;
  if (left <= 0) return null;
  const newStart = start < at ? start : start > cutEnd ? start - count : at;
  return [newStart, left];
}

/**
 * The set of merged regions. Few in practice, so lookups scan the list; the renderer asks once per pane for the
 * regions that touch it (`intersecting`), never per cell.
 */
export class MergeTable {
  private list: MergeRegion[] = [];
  // Reused by `intersecting`, which runs on every draw and must not allocate.
  private readonly scratch: MergeRegion[] = [];

  get size(): number {
    return this.list.length;
  }

  get all(): readonly MergeRegion[] {
    return this.list;
  }

  regionAt(row: number, col: number): MergeRegion | undefined {
    for (const m of this.list) {
      if (row >= m.row && row < m.row + m.rowSpan && col >= m.col && col < m.col + m.colSpan) return m;
    }
    return undefined;
  }

  /** The regions overlapping the inclusive rectangle. The returned array is reused by the next call. */
  intersecting(startRow: number, startCol: number, endRow: number, endCol: number): readonly MergeRegion[] {
    this.scratch.length = 0;
    for (const m of this.list) {
      if (m.row <= endRow && endRowOf(m) >= startRow && m.col <= endCol && endColOf(m) >= startCol) this.scratch.push(m);
    }
    return this.scratch;
  }

  /** Grows `range` until it fully contains every region it touches. */
  expand(range: CellRect): CellRect {
    if (this.list.length === 0) return range;
    let { startRow, startCol, endRow, endCol } = range;
    for (let changed = true; changed; ) {
      changed = false;
      for (const m of this.list) {
        if (m.row > endRow || endRowOf(m) < startRow || m.col > endCol || endColOf(m) < startCol) continue;
        if (m.row < startRow || endRowOf(m) > endRow || m.col < startCol || endColOf(m) > endCol) {
          startRow = Math.min(startRow, m.row);
          endRow = Math.max(endRow, endRowOf(m));
          startCol = Math.min(startCol, m.col);
          endCol = Math.max(endCol, endColOf(m));
          changed = true;
        }
      }
    }
    return startRow === range.startRow && startCol === range.startCol && endRow === range.endRow && endCol === range.endCol ? range : { startRow, startCol, endRow, endCol };
  }

  /** Replaces everything. Callers pass regions that do not overlap and cover more than one cell. */
  set(regions: readonly MergeRegion[]): void {
    this.list = regions.map((m) => ({ row: m.row, col: m.col, rowSpan: m.rowSpan, colSpan: m.colSpan }));
  }

  snapshot(): MergeRegion[] {
    return this.list.slice();
  }

  /** Follows an insert/delete of rows or columns. Regions reduced to a single cell stop being merges. */
  shift(axis: 'row' | 'col', kind: 'insert' | 'delete', at: number, count: number): void {
    const next: MergeRegion[] = [];
    for (const m of this.list) {
      const along = axis === 'row' ? shiftSpan(m.row, m.rowSpan, kind, at, count) : shiftSpan(m.col, m.colSpan, kind, at, count);
      if (along === null) continue;
      const region = axis === 'row' ? { ...m, row: along[0], rowSpan: along[1] } : { ...m, col: along[0], colSpan: along[1] };
      if (region.rowSpan * region.colSpan > 1) next.push(region);
    }
    this.list = next;
  }
}

/** Overlap test for validating loaded data. */
export function regionsOverlap(a: MergeRegion, b: MergeRegion): boolean {
  return a.row <= endRowOf(b) && endRowOf(a) >= b.row && a.col <= endColOf(b) && endColOf(a) >= b.col;
}
