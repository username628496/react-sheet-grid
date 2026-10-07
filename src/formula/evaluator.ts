import { isCellError } from '../core/model/Cell';
import { MAX_COLS, MAX_ROWS, type SheetModel } from '../core/model/SheetModel';
import { type Axis, type BinaryOp, type Expr, sameSheetName } from './ast';
import { FUNCTIONS } from './functions';
import {
  type Arg,
  err,
  type FnContext,
  isErr,
  isRange,
  type RangeRef,
  toBool,
  toNumber,
  toText,
  type Value,
} from './functions/helpers';
import { resolveAxis } from './print';

// null (empty) takes the type of the other side; booleans sort after text, text after numbers.
function compare(a: Value, b: Value): number {
  let x = a;
  let y = b;
  if (x === null && y === null) return 0;
  if (x === null) x = typeof y === 'number' ? 0 : typeof y === 'string' ? '' : false;
  if (y === null) y = typeof x === 'number' ? 0 : typeof x === 'string' ? '' : false;
  const rank = (v: Value): number => (typeof v === 'number' ? 0 : typeof v === 'string' ? 1 : 2);
  if (rank(x) !== rank(y)) return rank(x) - rank(y);
  if (typeof x === 'number' && typeof y === 'number') return x - y;
  if (typeof x === 'string' && typeof y === 'string') {
    const l = x.toLowerCase();
    const r = y.toLowerCase();
    return l < r ? -1 : l > r ? 1 : 0;
  }
  return Number(x) - Number(y);
}

function finite(n: number): Value {
  return Number.isFinite(n) ? n : err('#NUM!');
}

/** How a formula finds the other sheets of its workbook. */
export interface SheetEnvironment {
  /** The name of the sheet whose formulas are being evaluated (`Sheet1!A1` inside Sheet1 is a local reference). */
  ownName(): string;
  /** The cells of the named sheet, or null when there is no such sheet (the reference is then #REF!). */
  resolve(name: string): SheetModel | null;
}

/** Evaluates formula trees against a model. Stateless apart from the position of the cell being evaluated. */
export class Evaluator {
  private row = 0;
  private col = 0;
  private readonly ctx: FnContext;

  constructor(
    private readonly model: SheetModel,
    private readonly env: SheetEnvironment | null = null,
  ) {
    this.ctx = { model };
  }

  /** The model a reference reads: this sheet's, another sheet's, or null for a sheet that does not exist. */
  private modelFor(sheet: string | undefined): SheetModel | null {
    if (sheet === undefined || this.env === null) return sheet === undefined ? this.model : null;
    return sameSheetName(sheet, this.env.ownName()) ? this.model : this.env.resolve(sheet);
  }

  evaluate(expr: Expr, row: number, col: number): Value {
    this.row = row;
    this.col = col;
    const v = this.eval(expr);
    // A bare range as a whole formula would spill in Sheets; arrays are out of scope.
    return isRange(v) ? err('#VALUE!') : v;
  }


  private position(rowAxis: Axis, colAxis: Axis): { r: number; c: number } | null {
    const r = resolveAxis(rowAxis, this.row);
    const c = resolveAxis(colAxis, this.col);
    return r < 0 || c < 0 || r >= MAX_ROWS || c >= MAX_COLS ? null : { r, c };
  }

  // Evaluates to a plain value (a reference is read through).
  private eval(e: Expr): Arg {
    switch (e.t) {
      case 'num':
      case 'str':
      case 'bool':
        return e.v;
      case 'err':
        return err(e.v);
      case 'ref': {
        const p = this.position(e.row, e.col);
        const model = this.modelFor(e.sheet);
        return p === null || model === null ? err('#REF!') : model.getCell(p.r, p.c).value;
      }
      case 'range':
        return this.rangeOf(e);
      case 'un':
        return this.unary(e.op, this.value(e.e));
      case 'bin':
        return this.binary(e.op, this.value(e.l), this.value(e.r));
      case 'call':
        return this.call(e.name, e.args);
    }
  }

  // A single value: ranges cannot be used in arithmetic.
  private value(e: Expr): Value {
    const v = this.eval(e);
    return isRange(v) ? err('#VALUE!') : v;
  }

  private rangeOf(e: Extract<Expr, { t: 'range' }>): RangeRef | Value {
    const a = this.position(e.r1, e.c1);
    const b = this.position(e.r2, e.c2);
    const model = this.modelFor(e.sheet);
    if (a === null || b === null || model === null) return err('#REF!');
    const range: RangeRef = {
      kind: 'range',
      r1: Math.min(a.r, b.r),
      c1: Math.min(a.c, b.c),
      r2: Math.max(a.r, b.r),
      c2: Math.max(a.c, b.c),
    };
    return model === this.model ? range : { ...range, model };
  }

  private unary(op: '-' | '+' | '%', v: Value): Value {
    if (isErr(v)) return v;
    if (op === '+') return typeof v === 'string' ? v : toNumber(v);
    const n = toNumber(v);
    if (isCellError(n)) return n;
    return op === '-' ? -n : n / 100;
  }

  private binary(op: BinaryOp, a: Value, b: Value): Value {
    if (isErr(a)) return a;
    if (isErr(b)) return b;
    switch (op) {
      case '&': {
        const x = toText(a);
        const y = toText(b);
        return isCellError(x) ? x : isCellError(y) ? y : x + y;
      }
      case '=':
        return compare(a, b) === 0;
      case '<>':
        return compare(a, b) !== 0;
      case '<':
        return compare(a, b) < 0;
      case '>':
        return compare(a, b) > 0;
      case '<=':
        return compare(a, b) <= 0;
      case '>=':
        return compare(a, b) >= 0;
      default:
        break;
    }
    const x = toNumber(a);
    if (isCellError(x)) return x;
    const y = toNumber(b);
    if (isCellError(y)) return y;
    switch (op) {
      case '+':
        return finite(x + y);
      case '-':
        return finite(x - y);
      case '*':
        return finite(x * y);
      case '/':
        return y === 0 ? err('#DIV/0!') : finite(x / y);
      case '^':
        return x === 0 && y < 0 ? err('#DIV/0!') : finite(x ** y);
      default:
        return err('#VALUE!');
    }
  }

  private call(name: string, args: readonly Expr[]): Value {
    const def = FUNCTIONS[name];
    if (def === undefined) return err('#NAME?');
    if (args.length < def.min || args.length > def.max) return err('#N/A');
    if (name === 'IF') return this.lazyIf(args);
    if (name === 'IFERROR') return this.lazyIfError(args);
    // References are passed as 1x1 ranges so SUM(A1) treats A1 like range membership, as Sheets does.
    const evaluated = args.map((a) => this.arg(a));
    return def.fn(evaluated, this.ctx);
  }

  private arg(e: Expr): Arg {
    if (e.t === 'ref') {
      const p = this.position(e.row, e.col);
      const model = this.modelFor(e.sheet);
      if (p === null || model === null) return err('#REF!');
      const cell: RangeRef = { kind: 'range', r1: p.r, c1: p.c, r2: p.r, c2: p.c };
      return model === this.model ? cell : { ...cell, model };
    }
    return this.eval(e);
  }

  // The fallback is only evaluated when the first argument is an error.
  private lazyIfError(args: readonly Expr[]): Value {
    const v = this.value(args[0] as Expr);
    if (!isCellError(v)) return v;
    return args[1] === undefined ? '' : this.value(args[1]);
  }

  // Only the taken branch is evaluated, so IF(A1=0, "n/a", 1/A1) never divides by zero.
  private lazyIf(args: readonly Expr[]): Value {
    const cond = toBool(this.value(args[0] as Expr));
    if (isCellError(cond)) return cond;
    const branch = cond ? args[1] : args[2];
    if (branch === undefined) return false;
    return this.value(branch);
  }
}
