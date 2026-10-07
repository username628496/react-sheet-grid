import { columnLabel } from '../core/model/address';
import { MAX_COLS, MAX_ROWS } from '../core/model/SheetModel';
import type { Axis, BinaryOp, Expr } from './ast';

const BIN_PREC: Record<BinaryOp, number> = {
  '=': 1,
  '<>': 1,
  '<': 1,
  '>': 1,
  '<=': 1,
  '>=': 1,
  '&': 2,
  '+': 3,
  '-': 3,
  '*': 4,
  '/': 4,
  '^': 5,
};
const UNARY_PREC = 6;
const POSTFIX_PREC = 7;
const ATOM_PREC = 8;

function precOf(e: Expr): number {
  if (e.t === 'bin') return BIN_PREC[e.op];
  if (e.t === 'un') return e.op === '%' ? POSTFIX_PREC : UNARY_PREC;
  return ATOM_PREC;
}

/** Absolute 0-based position of an axis for a formula living at `base`. */
export function resolveAxis(a: Axis, base: number): number {
  return a.abs ? a.n : base + a.n;
}

/** `Sheet2!`, or `'My sheet'!` when the name needs quotes; nothing for a reference to the formula's own sheet. */
export function sheetPrefix(sheet: string | undefined): string {
  if (sheet === undefined) return '';
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(sheet) && !/^[A-Za-z]{1,3}\d+$/.test(sheet) ? `${sheet}!` : `'${sheet.replace(/'/g, "''")}'!`;
}
const prefix = sheetPrefix;

function colText(a: Axis, base: number): string | null {
  const index = resolveAxis(a, base);
  if (index < 0 || index >= MAX_COLS) return null;
  return `${a.abs ? '$' : ''}${columnLabel(index)}`;
}

function rowText(a: Axis, base: number): string | null {
  const index = resolveAxis(a, base);
  if (index < 0 || index >= MAX_ROWS) return null;
  return `${a.abs ? '$' : ''}${index + 1}`;
}

/** Prints a formula back in A1 notation as seen from the cell (row, col). Parenthesizes only where needed. */
export function printFormula(expr: Expr, row: number, col: number): string {
  if (expr.t === 'err' && expr.raw !== undefined) return expr.raw;
  return `=${print(expr, row, col)}`;
}

function print(e: Expr, row: number, col: number): string {
  switch (e.t) {
    case 'num':
      return String(e.v);
    case 'str':
      return `"${e.v.replace(/"/g, '""')}"`;
    case 'bool':
      return e.v ? 'TRUE' : 'FALSE';
    case 'err':
      return e.v;
    case 'ref': {
      const c = colText(e.col, col);
      const r = rowText(e.row, row);
      return c === null || r === null ? '#REF!' : `${prefix(e.sheet)}${c}${r}`;
    }
    case 'range': {
      const wholeCols = e.r1.abs && e.r1.n === 0 && e.r2.abs && e.r2.n === MAX_ROWS - 1;
      const wholeRows = e.c1.abs && e.c1.n === 0 && e.c2.abs && e.c2.n === MAX_COLS - 1;
      if (wholeCols) {
        const a = colText(e.c1, col);
        const b = colText(e.c2, col);
        return a === null || b === null ? '#REF!' : `${prefix(e.sheet)}${a}:${b}`;
      }
      if (wholeRows) {
        const a = rowText(e.r1, row);
        const b = rowText(e.r2, row);
        return a === null || b === null ? '#REF!' : `${prefix(e.sheet)}${a}:${b}`;
      }
      const c1 = colText(e.c1, col);
      const r1 = rowText(e.r1, row);
      const c2 = colText(e.c2, col);
      const r2 = rowText(e.r2, row);
      return c1 === null || r1 === null || c2 === null || r2 === null ? '#REF!' : `${prefix(e.sheet)}${c1}${r1}:${c2}${r2}`;
    }
    case 'un': {
      const inner = print(e.e, row, col);
      const wrapped = precOf(e.e) < precOf(e) ? `(${inner})` : inner;
      return e.op === '%' ? `${wrapped}%` : `${e.op}${wrapped}`;
    }
    case 'bin': {
      const p = BIN_PREC[e.op];
      const l = print(e.l, row, col);
      const r = print(e.r, row, col);
      // All binary operators are left-associative, so an equal-precedence right child needs parentheses.
      return `${precOf(e.l) < p ? `(${l})` : l}${e.op}${precOf(e.r) <= p ? `(${r})` : r}`;
    }
    case 'call':
      return `${e.name}(${e.args.map((a) => print(a, row, col)).join(',')})`;
  }
}
