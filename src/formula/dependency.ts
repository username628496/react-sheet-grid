import { cellKey, keyCol, keyRow, MAX_COLS, MAX_ROWS } from '../core/model/SheetModel';
import type { Expr } from './ast';
import { resolveAxis } from './print';

export interface RangeBounds {
  readonly r1: number;
  readonly c1: number;
  readonly r2: number;
  readonly c2: number;
}

export interface Precedents {
  cells: number[];
  ranges: RangeBounds[];
  /** Lower-cased names of the other sheets the formula reads. Those cells are not tracked here: the workbook recomputes the formula when such a sheet changes. */
  sheets?: string[];
}

/** Everything a formula at (row, col) reads, as absolute data coordinates. */
export function collectPrecedents(expr: Expr, row: number, col: number, isLocal: (sheet: string | undefined) => boolean = (s) => s === undefined): Precedents & { sheets: string[] } {
  const out: Precedents & { sheets: string[] } = { cells: [], ranges: [], sheets: [] };
  const external = (sheet: string): void => {
    const key = sheet.toLowerCase();
    if (!out.sheets.includes(key)) out.sheets.push(key);
  };
  const inBounds = (r: number, c: number): boolean => r >= 0 && c >= 0 && r < MAX_ROWS && c < MAX_COLS;
  const visit = (e: Expr): void => {
    switch (e.t) {
      case 'ref': {
        if (e.sheet !== undefined && !isLocal(e.sheet)) {
          external(e.sheet);
          break;
        }
        const r = resolveAxis(e.row, row);
        const c = resolveAxis(e.col, col);
        if (inBounds(r, c)) out.cells.push(cellKey(r, c));
        break;
      }
      case 'range': {
        if (e.sheet !== undefined && !isLocal(e.sheet)) {
          external(e.sheet);
          break;
        }
        const ra = resolveAxis(e.r1, row);
        const rb = resolveAxis(e.r2, row);
        const ca = resolveAxis(e.c1, col);
        const cb = resolveAxis(e.c2, col);
        if (inBounds(ra, ca) && inBounds(rb, cb)) {
          out.ranges.push({ r1: Math.min(ra, rb), c1: Math.min(ca, cb), r2: Math.max(ra, rb), c2: Math.max(ca, cb) });
        }
        break;
      }
      case 'un':
        visit(e.e);
        break;
      case 'bin':
        visit(e.l);
        visit(e.r);
        break;
      case 'call':
        e.args.forEach(visit);
        break;
      default:
        break;
    }
  };
  visit(expr);
  return out;
}

interface RangeDep extends RangeBounds {
  readonly dependent: number;
}

// Ranges spanning more columns than this are kept in one list instead of being indexed per column.
const WIDE_SPAN = 32;

/**
 * "Who must be recomputed when this cell changes?" Single-cell references are
 * a map; ranges are indexed by the columns they cover so a change in column C
 * only tests ranges that include C (a whole-column SUM is one entry, not a million).
 */
export class DependencyGraph {
  private readonly cellDependents = new Map<number, Set<number>>();
  private readonly rangesByCol = new Map<number, Set<RangeDep>>();
  private readonly wideRanges = new Set<RangeDep>();
  private readonly owned = new Map<number, { cells: number[]; ranges: RangeDep[] }>();

  get size(): number {
    return this.owned.size;
  }

  clear(): void {
    this.cellDependents.clear();
    this.rangesByCol.clear();
    this.wideRanges.clear();
    this.owned.clear();
  }

  /** Replaces the precedents of the formula cell `dependent`. */
  set(dependent: number, precedents: Precedents): void {
    this.remove(dependent);
    const cells = [...new Set(precedents.cells)];
    const ranges = precedents.ranges.map((r): RangeDep => ({ ...r, dependent }));
    for (const key of cells) {
      let set = this.cellDependents.get(key);
      if (set === undefined) {
        set = new Set();
        this.cellDependents.set(key, set);
      }
      set.add(dependent);
    }
    for (const range of ranges) {
      if (range.c2 - range.c1 >= WIDE_SPAN) {
        this.wideRanges.add(range);
        continue;
      }
      for (let c = range.c1; c <= range.c2; c++) {
        let set = this.rangesByCol.get(c);
        if (set === undefined) {
          set = new Set();
          this.rangesByCol.set(c, set);
        }
        set.add(range);
      }
    }
    this.owned.set(dependent, { cells, ranges });
  }

  remove(dependent: number): void {
    const prev = this.owned.get(dependent);
    if (prev === undefined) return;
    for (const key of prev.cells) {
      const set = this.cellDependents.get(key);
      set?.delete(dependent);
      if (set !== undefined && set.size === 0) this.cellDependents.delete(key);
    }
    for (const range of prev.ranges) {
      if (range.c2 - range.c1 >= WIDE_SPAN) {
        this.wideRanges.delete(range);
        continue;
      }
      for (let c = range.c1; c <= range.c2; c++) {
        const set = this.rangesByCol.get(c);
        set?.delete(range);
        if (set !== undefined && set.size === 0) this.rangesByCol.delete(c);
      }
    }
    this.owned.delete(dependent);
  }

  /** Formula cells that read the cell `key` directly (through a reference or a range). */
  dependentsOf(key: number): Set<number> {
    const result = new Set<number>(this.cellDependents.get(key));
    const row = keyRow(key);
    const col = keyCol(key);
    const test = (range: RangeDep): void => {
      if (row >= range.r1 && row <= range.r2 && col >= range.c1 && col <= range.c2) result.add(range.dependent);
    };
    this.rangesByCol.get(col)?.forEach(test);
    this.wideRanges.forEach(test);
    return result;
  }
}
