import { MAX_COLS, MAX_ROWS } from '../core/model/SheetModel';
import type { Axis, Expr } from './ast';
import { resolveAxis } from './print';

/** How one axis (rows or columns) moves when rows/columns are inserted or deleted. null means "deleted". */
export interface AxisMap {
  point(index: number): number | null;
  rangeStart(index: number): number | null;
  rangeEnd(index: number): number | null;
}

export const IDENTITY_MAP: AxisMap = {
  point: (i) => i,
  rangeStart: (i) => i,
  rangeEnd: (i) => i,
};

export function insertMap(at: number, count: number): AxisMap {
  const shift = (i: number): number => (i >= at ? i + count : i);
  return { point: shift, rangeStart: shift, rangeEnd: shift };
}

export function deleteMap(at: number, count: number): AxisMap {
  const end = at + count; // first surviving index after the block
  return {
    point: (i) => (i < at ? i : i >= end ? i - count : null),
    // A range loses the deleted part: its start moves to the first survivor after, its end to the last before.
    rangeStart: (i) => (i < at ? i : i >= end ? i - count : at),
    rangeEnd: (i) => (i < at ? i : i >= end ? i - count : at - 1),
  };
}

/** Number of values in the sorted array `sorted` that are strictly less than `x`. */
function countLess(sorted: readonly number[], x: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((sorted[mid] as number) < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Deleting an arbitrary, not necessarily contiguous, set of rows (what a delete looks like in a sorted or
 * filtered view). `deleted` must be sorted ascending and unique. Generalizes deleteMap.
 */
export function deleteSetMap(deleted: readonly number[]): AxisMap {
  const isDeleted = (i: number): boolean => {
    const k = countLess(deleted, i);
    return deleted[k] === i;
  };
  return {
    point: (i) => (isDeleted(i) ? null : i - countLess(deleted, i)),
    // A range keeps its surviving part: the start moves to the first survivor at or after it, the end to the last survivor before it.
    rangeStart: (i) => i - countLess(deleted, i),
    rangeEnd: (i) => (isDeleted(i) ? i - countLess(deleted, i) - 1 : i - countLess(deleted, i)),
  };
}

const REF_ERROR: Expr = { t: 'err', v: '#REF!' };

/**
 * Rewrites every reference in a formula that moves from (oldRow, oldCol) to
 * (newRow, newCol) while rows/columns shift according to the two maps. The
 * result keeps relative axes relative to the *new* position. Used for
 * insert/delete (maps) and for cut-paste (identity maps, different position).
 */
export function remapFormula(
  expr: Expr,
  oldRow: number,
  oldCol: number,
  newRow: number,
  newCol: number,
  rowMap: AxisMap,
  colMap: AxisMap,
): Expr {
  const store = (a: Axis, abs: number, base: number): Axis => (a.abs ? { abs: true, n: abs } : { abs: false, n: abs - base });

  const visit = (e: Expr): Expr => {
    switch (e.t) {
      case 'ref': {
        const r = rowMap.point(resolveAxis(e.row, oldRow));
        const c = colMap.point(resolveAxis(e.col, oldCol));
        if (r === null || c === null || r < 0 || c < 0 || r >= MAX_ROWS || c >= MAX_COLS) return REF_ERROR;
        return { t: 'ref', row: store(e.row, r, newRow), col: store(e.col, c, newCol) };
      }
      case 'range': {
        const wholeCols = e.r1.abs && e.r1.n === 0 && e.r2.abs && e.r2.n === MAX_ROWS - 1;
        const wholeRows = e.c1.abs && e.c1.n === 0 && e.c2.abs && e.c2.n === MAX_COLS - 1;
        const r1o = resolveAxis(e.r1, oldRow);
        const r2o = resolveAxis(e.r2, oldRow);
        const c1o = resolveAxis(e.c1, oldCol);
        const c2o = resolveAxis(e.c2, oldCol);
        // Orient first so "start" is always the smaller index, whatever order the user typed.
        const [rLo, rHi] = r1o <= r2o ? [e.r1, e.r2] : [e.r2, e.r1];
        const [cLo, cHi] = c1o <= c2o ? [e.c1, e.c2] : [e.c2, e.c1];
        const rs = wholeCols ? 0 : rowMap.rangeStart(Math.min(r1o, r2o));
        const re = wholeCols ? MAX_ROWS - 1 : rowMap.rangeEnd(Math.max(r1o, r2o));
        const cs = wholeRows ? 0 : colMap.rangeStart(Math.min(c1o, c2o));
        const ce = wholeRows ? MAX_COLS - 1 : colMap.rangeEnd(Math.max(c1o, c2o));
        if (rs === null || re === null || cs === null || ce === null || rs > re || cs > ce) return REF_ERROR;
        if (rs < 0 || cs < 0 || re >= MAX_ROWS || ce >= MAX_COLS) return REF_ERROR;
        return {
          t: 'range',
          r1: store(rLo, rs, newRow),
          r2: store(rHi, re, newRow),
          c1: store(cLo, cs, newCol),
          c2: store(cHi, ce, newCol),
        };
      }
      case 'un':
        return { t: 'un', op: e.op, e: visit(e.e) };
      case 'bin':
        return { t: 'bin', op: e.op, l: visit(e.l), r: visit(e.r) };
      case 'call':
        return { t: 'call', name: e.name, args: e.args.map(visit) };
      default:
        return e;
    }
  };
  return visit(expr);
}

/** Cut-paste: the formula moves but still points at the same cells. */
export function rebaseFormula(expr: Expr, fromRow: number, fromCol: number, toRow: number, toCol: number): Expr {
  return remapFormula(expr, fromRow, fromCol, toRow, toCol, IDENTITY_MAP, IDENTITY_MAP);
}

export interface CellRect {
  readonly r1: number;
  readonly c1: number;
  readonly r2: number;
  readonly c2: number;
}

/**
 * Cut-paste of a block: references to cells inside `rect` follow the cells to their new place (shifted by
 * dr/dc). A range follows only when it lies entirely inside the block; a partially overlapping range stays,
 * like in Excel and Sheets. The formula itself stays where it is. Returns the same object when nothing changed.
 */
export function moveReferences(expr: Expr, row: number, col: number, rect: CellRect, dr: number, dc: number): Expr {
  const inside = (r: number, c: number): boolean => r >= rect.r1 && r <= rect.r2 && c >= rect.c1 && c <= rect.c2;
  const shift: Shift = [dr, dc];
  return moveReferencesWith(
    expr,
    row,
    col,
    (r, c) => (inside(r, c) ? shift : null),
    (r1, c1, r2, c2) => (inside(r1, c1) && inside(r2, c2) ? shift : null),
  );
}

export type Shift = readonly [dr: number, dc: number];

/**
 * Generalisation of moveReferences for moves that are not one rectangle shifted as a whole (cut-paste in a sorted
 * or filtered view scatters the cells in data coordinates). `cellShift` tells how far a cell moved (null: it did not),
 * `rangeShift` the shift of a whole range, or null when the range must stay as it is.
 */
export function moveReferencesWith(
  expr: Expr,
  row: number,
  col: number,
  cellShift: (r: number, c: number) => Shift | null,
  rangeShift: (r1: number, c1: number, r2: number, c2: number) => Shift | null,
): Expr {
  const store = (a: Axis, abs: number, base: number): Axis => (a.abs ? { abs: true, n: abs } : { abs: false, n: abs - base });
  const visit = (e: Expr): Expr => {
    switch (e.t) {
      case 'ref': {
        const r = resolveAxis(e.row, row);
        const c = resolveAxis(e.col, col);
        const shift = cellShift(r, c);
        if (shift === null) return e;
        const nr = r + shift[0];
        const nc = c + shift[1];
        if (nr < 0 || nc < 0 || nr >= MAX_ROWS || nc >= MAX_COLS) return REF_ERROR;
        return { t: 'ref', row: store(e.row, nr, row), col: store(e.col, nc, col) };
      }
      case 'range': {
        const ra = resolveAxis(e.r1, row);
        const rb = resolveAxis(e.r2, row);
        const ca = resolveAxis(e.c1, col);
        const cb = resolveAxis(e.c2, col);
        const shift = rangeShift(Math.min(ra, rb), Math.min(ca, cb), Math.max(ra, rb), Math.max(ca, cb));
        if (shift === null) return e;
        const [dr, dc] = shift;
        const out = [ra + dr, rb + dr, ca + dc, cb + dc];
        if (out[0] as number < 0 || out[1] as number < 0 || out[2] as number < 0 || out[3] as number < 0) return REF_ERROR;
        return {
          t: 'range',
          r1: store(e.r1, ra + dr, row),
          r2: store(e.r2, rb + dr, row),
          c1: store(e.c1, ca + dc, col),
          c2: store(e.c2, cb + dc, col),
        };
      }
      case 'un': {
        const inner = visit(e.e);
        return inner === e.e ? e : { t: 'un', op: e.op, e: inner };
      }
      case 'bin': {
        const l = visit(e.l);
        const r = visit(e.r);
        return l === e.l && r === e.r ? e : { t: 'bin', op: e.op, l, r };
      }
      case 'call': {
        const args = e.args.map(visit);
        return args.every((a, i) => a === e.args[i]) ? e : { t: 'call', name: e.name, args };
      }
      default:
        return e;
    }
  };
  return visit(expr);
}
