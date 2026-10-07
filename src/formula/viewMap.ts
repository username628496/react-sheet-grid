import { MAX_COLS, MAX_ROWS } from '../core/model/SheetModel';
import type { Axis, Expr } from './ast';
import { resolveAxis } from './print';

export interface Position {
  readonly row: number;
  readonly col: number;
}

/** Maps one axis index to another (data to view or view to data). */
export type IndexMap = (index: number) => number;

const REF_ERROR: Expr = { t: 'err', v: '#REF!' };

/**
 * Re-expresses a formula's references: the formula that lives at `from` is rewritten as it would be written for a
 * formula living at `to`, with every absolute row/column index translated by `mapRow`/`mapCol`. A relative axis keeps
 * its offset in the *target* space, an absolute one (`$A$1`) keeps pointing at the translated index.
 *
 * This is how formulas speak the language of the screen while the data keeps its own coordinates: in a sorted or
 * filtered sheet the user types and reads references by displayed row, and the sheet stores them by data row.
 * References whose sheet qualifier `applies` rejects (another sheet) are not translated, only re-based.
 */
export function convertFormula(
  expr: Expr,
  from: Position,
  to: Position,
  mapRow: IndexMap,
  mapCol: IndexMap,
  applies: (sheet: string | undefined) => boolean = (s) => s === undefined,
  /**
   * Translates the rows a range covers as a whole: given its first and last row (in the source space) it returns the
   * first and last row in the target space, or null when those rows do not form one block there (so the range cannot
   * be written down faithfully). Without it a range is translated by its two end rows.
   */
  mapRowRange?: (first: number, last: number) => readonly [number, number] | null,
): Expr {
  const put = (a: Axis, absolute: number, base: number): Axis => (a.abs ? { abs: true, n: absolute } : { abs: false, n: absolute - base });
  const visit = (e: Expr): Expr => {
    switch (e.t) {
      case 'ref': {
        const mapped = applies(e.sheet);
        const r = mapped ? mapRow(resolveAxis(e.row, from.row)) : resolveAxis(e.row, from.row);
        const c = mapped ? mapCol(resolveAxis(e.col, from.col)) : resolveAxis(e.col, from.col);
        if (r < 0 || c < 0 || r >= MAX_ROWS || c >= MAX_COLS) return REF_ERROR;
        const out: Expr = { t: 'ref', row: put(e.row, r, to.row), col: put(e.col, c, to.col) };
        return e.sheet === undefined ? out : { ...out, sheet: e.sheet };
      }
      case 'range': {
        const mapped = applies(e.sheet);
        const wholeCols = e.r1.abs && e.r1.n === 0 && e.r2.abs && e.r2.n === MAX_ROWS - 1;
        const wholeRows = e.c1.abs && e.c1.n === 0 && e.c2.abs && e.c2.n === MAX_COLS - 1;
        const rowOf = (a: Axis): number => (mapped ? mapRow(resolveAxis(a, from.row)) : resolveAxis(a, from.row));
        const colOf = (a: Axis): number => (mapped ? mapCol(resolveAxis(a, from.col)) : resolveAxis(a, from.col));
        // After translation the two ends may swap (a sorted view reverses order); keep each end's absolute/relative flag with it.
        const [rLo, rHi] = resolveAxis(e.r1, from.row) <= resolveAxis(e.r2, from.row) ? [e.r1, e.r2] : [e.r2, e.r1];
        const [cLo, cHi] = wholeRows ? [e.c1, e.c2] : colOf(e.c1) <= colOf(e.c2) ? [e.c1, e.c2] : [e.c2, e.c1];
        let r1 = 0;
        let r2 = MAX_ROWS - 1;
        if (!wholeCols) {
          if (mapped && mapRowRange !== undefined) {
            const block = mapRowRange(resolveAxis(rLo, from.row), resolveAxis(rHi, from.row));
            if (block === null) return REF_ERROR;
            [r1, r2] = block;
          } else {
            // Without a block mapping, the two ends decide; they may swap (a reversed order), so order them again.
            const a = rowOf(rLo);
            const b = rowOf(rHi);
            [r1, r2] = a <= b ? [a, b] : [b, a];
          }
        }
        const c1 = wholeRows ? 0 : colOf(cLo);
        const c2 = wholeRows ? MAX_COLS - 1 : colOf(cHi);
        if (r1 < 0 || c1 < 0 || r2 >= MAX_ROWS || c2 >= MAX_COLS) return REF_ERROR;
        const out: Expr = { t: 'range', r1: put(rLo, r1, to.row), r2: put(rHi, r2, to.row), c1: put(cLo, c1, to.col), c2: put(cHi, c2, to.col) };
        return e.sheet === undefined ? out : { ...out, sheet: e.sheet };
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
