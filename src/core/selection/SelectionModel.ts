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
  ) {}

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
    this.onChange();
  }

  /** Ctrl/Cmd+click: start an additional range without dropping the others. */
  addCell(row: number, col: number): void {
    const r = this.clampRow(row);
    const c = this.clampCol(col);
    this.activeRow = this.focusRow = r;
    this.activeCol = this.focusCol = c;
    this.ranges.push(rect(r, c, r, c));
    this.onChange();
  }

  /** Moves the focus corner; the active cell stays as the anchor. */
  extendTo(row: number, col: number): void {
    this.focusRow = this.clampRow(row);
    this.focusCol = this.clampCol(col);
    this.ranges[this.ranges.length - 1] = rect(this.activeRow, this.activeCol, this.focusRow, this.focusCol);
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
    this.onChange();
  }

  selectAll(): void {
    this.activeRow = 0;
    this.activeCol = 0;
    this.focusRow = this.bounds.rowCount - 1;
    this.focusCol = this.bounds.colCount - 1;
    this.ranges = [rect(0, 0, this.focusRow, this.focusCol)];
    this.onChange();
  }

  /** Moves only the active cell (Tab/Enter inside a multi-cell range); ranges stay. */
  setActive(row: number, col: number): void {
    this.activeRow = this.clampRow(row);
    this.activeCol = this.clampCol(col);
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

  isSingleCell(): boolean {
    const p = this.primary;
    return p.startRow === p.endRow && p.startCol === p.endCol;
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
    this.onChange();
  }

  private clampRow(row: number): number {
    return Math.max(0, Math.min(this.bounds.rowCount - 1, row));
  }

  private clampCol(col: number): number {
    return Math.max(0, Math.min(this.bounds.colCount - 1, col));
  }
}
