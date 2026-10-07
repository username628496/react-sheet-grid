import type { ErrorCode } from '../core/model/Cell';

/**
 * One coordinate of a reference. Relative axes store an offset from the cell
 * that holds the formula (R1C1 style), so copying a formula is just sharing
 * this immutable tree; `$A$1` style axes store the absolute 0-based index.
 */
export interface Axis {
  readonly abs: boolean;
  readonly n: number;
}

export type BinaryOp = '+' | '-' | '*' | '/' | '^' | '&' | '=' | '<>' | '<' | '>' | '<=' | '>=';

export type Expr =
  | { readonly t: 'num'; readonly v: number }
  | { readonly t: 'str'; readonly v: string }
  | { readonly t: 'bool'; readonly v: boolean }
  /** `raw` keeps the source text of formulas that failed to parse so editing still shows what was typed. */
  | { readonly t: 'err'; readonly v: ErrorCode; readonly raw?: string }
  /** `sheet` names another sheet of the workbook (`Sheet2!A1`); absent means the sheet holding the formula. */
  | { readonly t: 'ref'; readonly row: Axis; readonly col: Axis; readonly sheet?: string }
  | { readonly t: 'range'; readonly r1: Axis; readonly c1: Axis; readonly r2: Axis; readonly c2: Axis; readonly sheet?: string }
  | { readonly t: 'un'; readonly op: '-' | '+' | '%'; readonly e: Expr }
  | { readonly t: 'bin'; readonly op: BinaryOp; readonly l: Expr; readonly r: Expr }
  | { readonly t: 'call'; readonly name: string; readonly args: readonly Expr[] };

/** Sheet names compare ignoring case, as in Sheets and Excel. */
export function sameSheetName(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}
