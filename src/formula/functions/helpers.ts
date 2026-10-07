import type { CellError, CellValue, ErrorCode } from '../../core/model/Cell';
import { isCellError } from '../../core/model/Cell';
import { parseDateInput } from '../../core/model/dates';
import type { SheetModel } from '../../core/model/SheetModel';

/** What a formula evaluates to. null is an empty cell. */
export type Value = CellValue | null;

/** A reference to cells, absolute 0-based data coordinates, normalized so r1 <= r2 and c1 <= c2. */
export interface RangeRef {
  readonly kind: 'range';
  readonly r1: number;
  readonly c1: number;
  readonly r2: number;
  readonly c2: number;
}

export type Arg = Value | RangeRef;

export interface FnContext {
  readonly model: SheetModel;
}

export interface FunctionDef {
  readonly min: number;
  readonly max: number;
  readonly fn: (args: Arg[], ctx: FnContext) => Value;
}

const ERRORS = new Map<ErrorCode, CellError>();

export function err(code: ErrorCode): CellError {
  let e = ERRORS.get(code);
  if (e === undefined) {
    e = Object.freeze({ error: code });
    ERRORS.set(code, e);
  }
  return e;
}

export function isRange(a: Arg): a is RangeRef {
  return typeof a === 'object' && a !== null && 'kind' in a;
}

/** A single cell used where a value is expected; bigger ranges are not implicitly intersected. */
export function scalar(a: Arg, ctx: FnContext): Value {
  if (!isRange(a)) return a;
  if (a.r1 !== a.r2 || a.c1 !== a.c2) return err('#VALUE!');
  return ctx.model.getCell(a.r1, a.c1).value;
}

const NUMERIC_TEXT = /^\s*[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?\s*$/i;

export function toNumber(v: Value): number | CellError {
  if (typeof v === 'number') return v;
  if (v === null) return 0;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (isCellError(v)) return v;
  // Sheets treats an empty string as 0 in arithmetic.
  if (v.trim() === '') return 0;
  if (NUMERIC_TEXT.test(v)) return Number(v);
  // Text that reads as a date or time works in arithmetic, as in Sheets ("2026-01-01" + 1).
  const date = parseDateInput(v);
  return date === null ? err('#VALUE!') : date.serial;
}

export function toText(v: Value): string | CellError {
  if (v === null) return '';
  if (typeof v === 'string') return v;
  // 15 significant digits is what a double can hold without showing binary noise.
  if (typeof v === 'number') return Number.isFinite(v) ? String(Number(v.toPrecision(15))) : String(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return v;
}

export function toBool(v: Value): boolean | CellError {
  if (typeof v === 'boolean') return v;
  if (v === null) return false;
  if (typeof v === 'number') return v !== 0;
  if (isCellError(v)) return v;
  const u = v.trim().toUpperCase();
  if (u === 'TRUE') return true;
  if (u === 'FALSE') return false;
  return err('#VALUE!');
}

export function isErr(v: unknown): v is CellError {
  return isCellError(v);
}

/** Visits stored (non-empty) cells of a range. Never scans the empty area, so whole-column ranges stay cheap. */
export function forEachStored(
  range: RangeRef,
  ctx: FnContext,
  visit: (value: Value, row: number, col: number) => void,
): void {
  ctx.model.forEachCellInRange(
    { startRow: range.r1, startCol: range.c1, endRow: range.r2, endCol: range.c2 },
    (row, col, cell) => visit(cell.value, row, col),
  );
}

/**
 * Numbers a SUM-like function sees. Inside ranges only real numbers count;
 * directly passed values are coerced (TRUE = 1, "5" = 5, "abc" = #VALUE!).
 * Errors anywhere win, and are returned instead.
 */
export function collectNumbers(args: Arg[], ctx: FnContext, direct: 'coerce' | 'count-only'): number[] | CellError {
  const out: number[] = [];
  let failure: CellError | null = null;
  for (const arg of args) {
    if (isRange(arg)) {
      forEachStored(arg, ctx, (v) => {
        if (failure !== null) return;
        if (isErr(v)) failure = v;
        else if (typeof v === 'number') out.push(v);
      });
      if (failure !== null) return failure;
      continue;
    }
    if (isErr(arg)) return arg;
    if (arg === null) continue;
    if (direct === 'count-only') {
      if (typeof arg === 'number' || typeof arg === 'boolean') out.push(Number(arg));
      continue;
    }
    const n = toNumber(arg);
    if (isErr(n)) return n;
    out.push(n);
  }
  return out;
}
