import { type Arg, err, type FnContext, type FunctionDef, isErr, scalar, toNumber, toText, type Value } from './helpers';

function textFn(op: (s: string) => Value): (args: Arg[], ctx: FnContext) => Value {
  return (args, ctx) => {
    const t = toText(scalar(args[0] as Arg, ctx));
    return isErr(t) ? t : op(t);
  };
}

/** Optional count argument (default 1); negative counts are #VALUE!. */
function count(args: Arg[], index: number, ctx: FnContext, fallback: number): number | Value {
  const a = args[index];
  if (a === undefined) return fallback;
  const n = toNumber(scalar(a, ctx));
  if (isErr(n)) return n;
  return n < 0 ? err('#VALUE!') : Math.trunc(n);
}

function left(args: Arg[], ctx: FnContext): Value {
  const t = toText(scalar(args[0] as Arg, ctx));
  if (isErr(t)) return t;
  const n = count(args, 1, ctx, 1);
  return typeof n === 'number' ? t.slice(0, n) : n;
}

function right(args: Arg[], ctx: FnContext): Value {
  const t = toText(scalar(args[0] as Arg, ctx));
  if (isErr(t)) return t;
  const n = count(args, 1, ctx, 1);
  return typeof n === 'number' ? (n === 0 ? '' : t.slice(-n)) : n;
}

function mid(args: Arg[], ctx: FnContext): Value {
  const t = toText(scalar(args[0] as Arg, ctx));
  if (isErr(t)) return t;
  const start = toNumber(scalar(args[1] as Arg, ctx));
  if (isErr(start)) return start;
  if (start < 1) return err('#VALUE!');
  const n = count(args, 2, ctx, 0);
  if (typeof n !== 'number') return n;
  const from = Math.trunc(start) - 1;
  return t.slice(from, from + n);
}

export const TEXT_FUNCTIONS: Record<string, FunctionDef> = {
  LEN: { min: 1, max: 1, fn: textFn((t) => [...t].length) },
  UPPER: { min: 1, max: 1, fn: textFn((t) => t.toUpperCase()) },
  LOWER: { min: 1, max: 1, fn: textFn((t) => t.toLowerCase()) },
  // Sheets collapses inner runs of spaces too.
  TRIM: { min: 1, max: 1, fn: textFn((t) => t.replace(/ +/g, ' ').replace(/^ | $/g, '')) },
  LEFT: { min: 1, max: 2, fn: left },
  RIGHT: { min: 1, max: 2, fn: right },
  MID: { min: 3, max: 3, fn: mid },
  // Sheets' CONCAT takes exactly two values.
  CONCAT: {
    min: 2,
    max: 2,
    fn: (args: Arg[], ctx: FnContext): Value => {
      const a = toText(scalar(args[0] as Arg, ctx));
      if (isErr(a)) return a;
      const b = toText(scalar(args[1] as Arg, ctx));
      if (isErr(b)) return b;
      return a + b;
    },
  },
};
