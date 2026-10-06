import { type Cell, isEmptyCell } from './Cell';
import { DEFAULT_STYLE_ID } from './StyleTable';

export const MAX_ROWS = 1_048_576;
export const MAX_COLS = 16_384;

export interface CellRange {
  readonly startRow: number;
  readonly startCol: number;
  readonly endRow: number; // inclusive
  readonly endCol: number; // inclusive
}

const EMPTY_CELL: Cell = Object.freeze({ value: null, styleId: DEFAULT_STYLE_ID });

// Row * MAX_COLS + col stays below 2^34, exactly representable as a double,
// and a numeric Map key avoids allocating a string per lookup.
export function cellKey(dataRow: number, dataCol: number): number {
  return dataRow * MAX_COLS + dataCol;
}

export function keyRow(key: number): number {
  return Math.floor(key / MAX_COLS);
}

export function keyCol(key: number): number {
  return key - keyRow(key) * MAX_COLS;
}

const keyOf = cellKey;

function assertInBounds(dataRow: number, dataCol: number): void {
  if (
    !Number.isInteger(dataRow) ||
    !Number.isInteger(dataCol) ||
    dataRow < 0 ||
    dataCol < 0 ||
    dataRow >= MAX_ROWS ||
    dataCol >= MAX_COLS
  ) {
    throw new RangeError(`Cell (${dataRow}, ${dataCol}) is out of bounds`);
  }
}

/**
 * Sparse single source of truth for cell data. Coordinates are always data
 * coordinates. The low-level writers are meant to be called by commands only.
 */
export class SheetModel {
  private readonly cells = new Map<number, Cell>();

  /** Fired after every write so the formula engine can learn what to recompute. */
  onCellChange: ((dataRow: number, dataCol: number, cell: Cell) => void) | null = null;

  get cellCount(): number {
    return this.cells.size;
  }

  getCell(dataRow: number, dataCol: number): Cell {
    return this.cells.get(keyOf(dataRow, dataCol)) ?? EMPTY_CELL;
  }

  hasCell(dataRow: number, dataCol: number): boolean {
    return this.cells.has(keyOf(dataRow, dataCol));
  }

  /** Stores `cell`; an empty, unstyled cell removes the entry to stay sparse. */
  setCell(dataRow: number, dataCol: number, cell: Cell): void {
    assertInBounds(dataRow, dataCol);
    const key = keyOf(dataRow, dataCol);
    if (isEmptyCell(cell)) this.cells.delete(key);
    else {
      this.cells.set(
        key,
        cell.formula === undefined
          ? { value: cell.value, styleId: cell.styleId }
          : { value: cell.value, styleId: cell.styleId, formula: cell.formula },
      );
    }
    this.onCellChange?.(dataRow, dataCol, cell);
  }

  deleteCell(dataRow: number, dataCol: number): void {
    if (this.cells.delete(keyOf(dataRow, dataCol))) this.onCellChange?.(dataRow, dataCol, EMPTY_CELL);
  }

  /** Stores a formula's result without signalling a change (the engine is the one writing it). */
  setComputedValue(dataRow: number, dataCol: number, value: Cell['value']): void {
    const key = keyOf(dataRow, dataCol);
    const cell = this.cells.get(key);
    if (cell !== undefined) this.cells.set(key, { ...cell, value });
  }

  /** Visits every stored cell in no particular order. */
  forEachCell(visit: (dataRow: number, dataCol: number, cell: Cell) => void): void {
    for (const [key, cell] of this.cells) {
      const r = Math.floor(key / MAX_COLS);
      visit(r, key - r * MAX_COLS, cell);
    }
  }

  /** Visits only stored cells inside `range`, in no particular order. */
  forEachCellInRange(
    range: CellRange,
    visit: (dataRow: number, dataCol: number, cell: Cell) => void,
  ): void {
    const area = (range.endRow - range.startRow + 1) * (range.endCol - range.startCol + 1);
    // Iterate whichever is smaller: the range area or the stored cells.
    if (area <= this.cells.size) {
      for (let r = range.startRow; r <= range.endRow; r++) {
        for (let c = range.startCol; c <= range.endCol; c++) {
          const cell = this.cells.get(keyOf(r, c));
          if (cell !== undefined) visit(r, c, cell);
        }
      }
      return;
    }
    for (const [key, cell] of this.cells) {
      const r = Math.floor(key / MAX_COLS);
      const c = key - r * MAX_COLS;
      if (r >= range.startRow && r <= range.endRow && c >= range.startCol && c <= range.endCol) {
        visit(r, c, cell);
      }
    }
  }

  /** Smallest rectangle containing every stored cell, or null when empty. */
  getUsedRange(): CellRange | null {
    if (this.cells.size === 0) return null;
    let startRow = Infinity;
    let startCol = Infinity;
    let endRow = -1;
    let endCol = -1;
    for (const key of this.cells.keys()) {
      const r = Math.floor(key / MAX_COLS);
      const c = key - r * MAX_COLS;
      if (r < startRow) startRow = r;
      if (r > endRow) endRow = r;
      if (c < startCol) startCol = c;
      if (c > endCol) endCol = c;
    }
    return { startRow, startCol, endRow, endCol };
  }
}
