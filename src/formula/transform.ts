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
