import type { MergeRegion, MergeTable } from '../model/MergeTable';

/** Inclusive, normalized (start <= end), in *view* coordinates. */
export interface ViewRange {
  readonly startRow: number;
  readonly startCol: number;
  readonly endRow: number;
  readonly endCol: number;
}

export interface Bounds {
  readonly rowCount: number;
  readonly colCount: number;
}

function rect(r1: number, c1: number, r2: number, c2: number): ViewRange {
  return {
    startRow: Math.min(r1, r2),
    startCol: Math.min(c1, c2),
    endRow: Math.max(r1, r2),
    endCol: Math.max(c1, c2),
  };
}

/**
 * Ranges plus the active cell. The primary (last) range is always the
 * rectangle between the active cell and the moving `focus` corner, so
 * Shift+arrow only has to move `focus`.
 */
export class SelectionModel {
  activeRow = 0;
  activeCol = 0;
  focusRow = 0;
  focusCol = 0;
  private ranges: ViewRange[] = [rect(0, 0, 0, 0)];

  constructor(
    private readonly bounds: Bounds,
    private readonly onChange: () => void = () => {},
    /** When set, selections always cover whole merged regions and the active cell is a region's anchor. */
    private readonly merges: MergeTable | null = null,
  ) {}

  /** The merged region holding the cell, if any. */
  regionAt(row: number, col: number): MergeRegion | undefined {
    return this.merges?.regionAt(row, col);
  }

  /**
   * Re-applies the merge rules after any change: ranges grow to cover the regions they touch and the active cell
   * moves to its region's anchor. Free when the sheet has no merges.
   */
  private fit(): void {
    const merges = this.merges;
    if (merges === null || merges.size === 0) return;
    this.ranges = this.ranges.map((r) => merges.expand(r) as ViewRange);
    const region = merges.regionAt(this.activeRow, this.activeCol);
    if (region !== undefined) {
      this.activeRow = region.row;
      this.activeCol = region.col;
    }
  }

  /** Call after the merge table itself changed (merge, unmerge, undo, row edits). */
  refit(notify = true): void {
    this.fit();
    if (notify) this.onChange();
  }

  /** One cell, or exactly one merged block (which behaves as a single cell). */
  isSingleCell(): boolean {
    const p = this.primary;
    if (p.startRow === p.endRow && p.startCol === p.endCol) return true;
    const block = this.merges?.regionAt(p.startRow, p.startCol);
    return block !== undefined && block.row === p.startRow && block.col === p.startCol && block.rowSpan === p.endRow - p.startRow + 1 && block.colSpan === p.endCol - p.startCol + 1;
  }

  get primary(): ViewRange {
    return this.ranges[this.ranges.length - 1] as ViewRange;
  }

  get allRanges(): readonly ViewRange[] {
    return this.ranges;
  }

  selectCell(row: number, col: number): void {
    const r = this.clampRow(row);
    const c = this.clampCol(col);
    this.activeRow = this.focusRow = r;
    this.activeCol = this.focusCol = c;
    this.ranges = [rect(r, c, r, c)];
    this.fit();
    this.onChange();
  }

  /** Ctrl/Cmd+click: start an additional range without dropping the others. */
  addCell(row: number, col: number): void {
    const r = this.clampRow(row);
    const c = this.clampCol(col);
    this.activeRow = this.focusRow = r;
    this.activeCol = this.focusCol = c;
    this.ranges.push(rect(r, c, r, c));
    this.fit();
    this.onChange();
  }

  /** Moves the focus corner; the active cell stays as the anchor. */
  extendTo(row: number, col: number): void {
    this.focusRow = this.clampRow(row);
    this.focusCol = this.clampCol(col);
    this.ranges[this.ranges.length - 1] = rect(this.activeRow, this.activeCol, this.focusRow, this.focusCol);
    this.fit();
    this.onChange();
  }

  selectRow(row: number, extend = false, add = false): void {
    const r = this.clampRow(row);
    const last = this.bounds.colCount - 1;
    if (extend) {
      this.focusRow = r;
      this.focusCol = last;
      this.ranges[this.ranges.length - 1] = rect(this.activeRow, 0, r, last);
    } else {
      this.activeRow = this.focusRow = r;
      this.activeCol = 0;
      this.focusCol = last;
      const range = rect(r, 0, r, last);
      this.ranges = add ? [...this.ranges, range] : [range];
    }
    this.fit();
    this.onChange();
  }

  selectCol(col: number, extend = false, add = false): void {
    const c = this.clampCol(col);
    const last = this.bounds.rowCount - 1;
    if (extend) {
      this.focusRow = last;
      this.focusCol = c;
      this.ranges[this.ranges.length - 1] = rect(0, this.activeCol, last, c);
    } else {
      this.activeCol = this.focusCol = c;
      this.activeRow = 0;
      this.focusRow = last;
      const range = rect(0, c, last, c);
      this.ranges = add ? [...this.ranges, range] : [range];
    }
    this.fit();
    this.onChange();
  }

  selectAll(): void {
    this.activeRow = 0;
    this.activeCol = 0;
    this.focusRow = this.bounds.rowCount - 1;
    this.focusCol = this.bounds.colCount - 1;
    this.ranges = [rect(0, 0, this.focusRow, this.focusCol)];
    this.fit();
    this.onChange();
  }

  /** Moves only the active cell (Tab/Enter inside a multi-cell range); ranges stay. */
  setActive(row: number, col: number): void {
    this.activeRow = this.clampRow(row);
    this.activeCol = this.clampCol(col);
    this.fit();
    this.onChange();
  }

  contains(row: number, col: number): boolean {
    for (const range of this.ranges) {
      if (row >= range.startRow && row <= range.endRow && col >= range.startCol && col <= range.endCol) return true;
    }
    return false;
  }

  isRowSelected(row: number): boolean {
    for (const range of this.ranges) if (row >= range.startRow && row <= range.endRow) return true;
    return false;
  }

  isColSelected(col: number): boolean {
    for (const range of this.ranges) if (col >= range.startCol && col <= range.endCol) return true;
    return false;
  }

  /** Re-fits the selection after the grid shrank (filter, delete rows). */
  clamp(): void {
    this.activeRow = this.clampRow(this.activeRow);
    this.activeCol = this.clampCol(this.activeCol);
    this.focusRow = this.clampRow(this.focusRow);
    this.focusCol = this.clampCol(this.focusCol);
    this.ranges = this.ranges.map((r) =>
      rect(this.clampRow(r.startRow), this.clampCol(r.startCol), this.clampRow(r.endRow), this.clampCol(r.endCol)),
    );
    this.fit();
    this.onChange();
  }

  private clampRow(row: number): number {
    return Math.max(0, Math.min(this.bounds.rowCount - 1, row));
  }

  private clampCol(col: number): number {
    return Math.max(0, Math.min(this.bounds.colCount - 1, col));
  }
}
