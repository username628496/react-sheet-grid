import { isCellError } from '../../core/model/Cell';
import { parseTypedInput } from '../../core/model/parseInput';
import {
  type Arg,
  collectNumbers,
  err,
  type FnContext,
  forEachStored,
  type FunctionDef,
  isErr,
  isRange,
  scalar,
  toNumber,
  type Value,
} from './helpers';

function sum(args: Arg[], ctx: FnContext): Value {
  const nums = collectNumbers(args, ctx, 'coerce');
  if (isErr(nums)) return nums;
  let total = 0;
  for (const n of nums) total += n;
  return total;
}

function average(args: Arg[], ctx: FnContext): Value {
  const nums = collectNumbers(args, ctx, 'coerce');
  if (isErr(nums)) return nums;
  if (nums.length === 0) return err('#DIV/0!');
  let total = 0;
  for (const n of nums) total += n;
  return total / nums.length;
}

// COUNT never fails: errors and text are simply not numbers.
function count(args: Arg[], ctx: FnContext): Value {
  let n = 0;
  for (const arg of args) {
    if (isRange(arg)) {
      forEachStored(arg, ctx, (v) => {
        if (typeof v === 'number') n++;
      });
    } else if (typeof arg === 'number' || typeof arg === 'boolean') {
      n++;
    } else if (typeof arg === 'string' && !isErr(toNumber(arg))) {
      n++;
    }
  }
  return n;
}

function extreme(pick: (a: number, b: number) => number): (args: Arg[], ctx: FnContext) => Value {
  return (args, ctx) => {
    const nums = collectNumbers(args, ctx, 'coerce');
    if (isErr(nums)) return nums;
    if (nums.length === 0) return 0;
    // Not reduce(pick): reduce also passes index and array, which Math.min/max would treat as operands.
    return nums.reduce((a, b) => pick(a, b));
  };
}

/** Rounds half away from zero, using decimal shifting so 1.005 -> 1.01 like Sheets rather than binary 1.00. */
export function roundHalfAway(x: number, places: number): number {
  const sign = x < 0 ? -1 : 1;
  const abs = Math.abs(x);
  const shifted = Number(`${abs}e${places}`);
  if (Number.isNaN(shifted)) {
    const f = 10 ** places;
    return (sign * Math.round(abs * f)) / f;
  }
  const result = Number(`${Math.round(shifted)}e${-places}`);
  return sign * result;
}

function round(args: Arg[], ctx: FnContext): Value {
  const v = scalar(args[0] as Arg, ctx);
  const n = toNumber(v);
  if (isCellError(n)) return n;
  let places = 0;
  if (args.length > 1) {
    const p = toNumber(scalar(args[1] as Arg, ctx));
    if (isCellError(p)) return p;
    places = Math.trunc(p);
  }
  return roundHalfAway(n, places);
}

// ---- criteria shared by SUMIF / COUNTIF -------------------------------------------------------

type Relation = '=' | '<>' | '<' | '>' | '<=' | '>=';

export interface Criterion {
  matches(value: Value): boolean;
  /** True when an empty cell satisfies the criterion (then COUNTIF must count the unstored area). */
  matchesBlank: boolean;
}

function wildcardToRegExp(pattern: string): RegExp {
  let source = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i] as string;
    if (ch === '~' && i + 1 < pattern.length) {
      source += (pattern[++i] as string).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    } else if (ch === '*') source += '.*';
    else if (ch === '?') source += '.';
    else source += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${source}$`, 'is');
}

export function makeCriterion(criterion: Value): Criterion {
  let relation: Relation = '=';
  let operand: Value = criterion;
  if (typeof criterion === 'string') {
    const m = /^(>=|<=|<>|>|<|=)?([\s\S]*)$/.exec(criterion) as RegExpExecArray;
    relation = (m[1] ?? '=') as Relation;
    const text = m[2] as string;
    operand = text === '' ? '' : parseTypedInput(text).value;
  }
  const blankOperand = operand === '' || operand === null;
  const compare = (c: number): boolean => {
    switch (relation) {
      case '=':
        return c === 0;
      case '<>':
        return c !== 0;
      case '<':
        return c < 0;
      case '>':
        return c > 0;
      case '<=':
        return c <= 0;
      case '>=':
        return c >= 0;
    }
  };
  const matches = (value: Value): boolean => {
    const isBlank = value === null || value === '';
    if (blankOperand) return relation === '=' ? isBlank : relation === '<>' ? !isBlank : false;
    if (isBlank) return relation === '<>';
    if (isErr(value)) return false;
    if (typeof operand === 'number') {
      if (typeof value === 'number') return compare(value - operand);
      return relation === '<>';
    }
    if (typeof operand === 'boolean') {
      if (typeof value === 'boolean') return compare(Number(value) - Number(operand));
      return relation === '<>';
    }
    if (typeof operand === 'string') {
      if (typeof value !== 'string') return relation === '<>';
      if (relation === '=' || relation === '<>') {
        const hit = /[*?~]/.test(operand) ? wildcardToRegExp(operand).test(value) : value.toLowerCase() === operand.toLowerCase();
        return relation === '=' ? hit : !hit;
      }
      const a = value.toLowerCase();
      const b = operand.toLowerCase();
      return compare(a < b ? -1 : a > b ? 1 : 0);
    }
    return false;
  };
  return { matches, matchesBlank: matches(null) };
}

function countIf(args: Arg[], ctx: FnContext): Value {
  const range = args[0] as Arg;
  if (!isRange(range)) return err('#VALUE!');
  const crit = scalar(args[1] as Arg, ctx);
  if (isErr(crit)) return crit;
  const criterion = makeCriterion(crit);
  let matched = 0;
  let stored = 0;
  forEachStored(range, ctx, (v) => {
    stored++;
    if (criterion.matches(v)) matched++;
  });
  if (criterion.matchesBlank) {
    // Empty cells are not stored, so they are counted from the range area.
    matched += (range.r2 - range.r1 + 1) * (range.c2 - range.c1 + 1) - stored;
  }
  return matched;
}

function sumIf(args: Arg[], ctx: FnContext): Value {
  const range = args[0] as Arg;
  if (!isRange(range)) return err('#VALUE!');
  const crit = scalar(args[1] as Arg, ctx);
  if (isErr(crit)) return crit;
  const sumArg = args[2];
  if (sumArg !== undefined && !isRange(sumArg)) return err('#VALUE!');
  const criterion = makeCriterion(crit);
  let total = 0;
  let failure: Value = null;
  forEachStored(range, ctx, (v, row, col) => {
    if (failure !== null || !criterion.matches(v)) return;
    // The sum range is aligned to the criteria range by offset from its top-left corner.
    const target = sumArg === undefined ? v : ctx.model.getCell(sumArg.r1 + (row - range.r1), sumArg.c1 + (col - range.c1)).value;
    if (isErr(target)) failure = target;
    else if (typeof target === 'number') total += target;
  });
  if (sumArg !== undefined && criterion.matchesBlank) {
    // Blank criteria cells match their sum cells too; those can hold numbers. Rare, handled by a bounded scan.
    const area = (range.r2 - range.r1 + 1) * (range.c2 - range.c1 + 1);
    if (area <= 100_000) {
      for (let r = range.r1; r <= range.r2; r++) {
        for (let c = range.c1; c <= range.c2; c++) {
          if (ctx.model.hasCell(r, c)) continue; // stored cells were handled above
          const t = ctx.model.getCell(sumArg.r1 + (r - range.r1), sumArg.c1 + (c - range.c1)).value;
          if (typeof t === 'number') total += t;
        }
      }
    }
  }
  return failure !== null ? failure : total;
}

function unary(op: (n: number) => Value): (args: Arg[], ctx: FnContext) => Value {
  return (args, ctx) => {
    const n = toNumber(scalar(args[0] as Arg, ctx));
    return isCellError(n) ? n : op(n);
  };
}

function binary(op: (a: number, b: number) => Value): (args: Arg[], ctx: FnContext) => Value {
  return (args, ctx) => {
    const a = toNumber(scalar(args[0] as Arg, ctx));
    if (isCellError(a)) return a;
    const b = toNumber(scalar(args[1] as Arg, ctx));
    return isCellError(b) ? b : op(a, b);
  };
}

function countA(args: Arg[], ctx: FnContext): Value {
  let n = 0;
  for (const arg of args) {
    if (isRange(arg)) forEachStored(arg, ctx, (v) => { if (v !== '') n++; });
    else if (arg !== null) n++;
  }
  return n;
}

export const MATH_FUNCTIONS: Record<string, FunctionDef> = {
  ABS: { min: 1, max: 1, fn: unary(Math.abs) },
  INT: { min: 1, max: 1, fn: unary(Math.floor) },
  SQRT: { min: 1, max: 1, fn: unary((n) => (n < 0 ? err('#NUM!') : Math.sqrt(n))) },
  // The result takes the divisor's sign, like Sheets (MOD(-3, 2) = 1).
  MOD: { min: 2, max: 2, fn: binary((a, b) => (b === 0 ? err('#DIV/0!') : a - b * Math.floor(a / b))) },
  POWER: {
    min: 2,
    max: 2,
    fn: binary((a, b) => {
      if (a === 0 && b < 0) return err('#DIV/0!');
      const r = a ** b;
      return Number.isFinite(r) ? r : err('#NUM!');
    }),
  },
  COUNTA: { min: 1, max: Infinity, fn: countA },
  SUM: { min: 1, max: Infinity, fn: sum },
  AVERAGE: { min: 1, max: Infinity, fn: average },
  COUNT: { min: 1, max: Infinity, fn: count },
  MIN: { min: 1, max: Infinity, fn: extreme(Math.min) },
  MAX: { min: 1, max: Infinity, fn: extreme(Math.max) },
  ROUND: { min: 1, max: 2, fn: round },
  SUMIF: { min: 2, max: 3, fn: sumIf },
  COUNTIF: { min: 2, max: 2, fn: countIf },
};
