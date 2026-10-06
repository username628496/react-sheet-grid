import { type Arg, err, type FnContext, type FunctionDef, forEachStored, isErr, isRange, scalar, toBool, type Value } from './helpers';

/** AND/OR: inside ranges only booleans and numbers take part; text is ignored. No usable value at all is #VALUE!. */
function fold(args: Arg[], ctx: FnContext, combine: (a: boolean, b: boolean) => boolean, start: boolean): Value {
  let acc = start;
  let seen = false;
  let failure: Value = null;
  for (const arg of args) {
    if (isRange(arg)) {
      forEachStored(arg, ctx, (v) => {
        if (failure !== null) return;
        if (isErr(v)) failure = v;
        else if (typeof v === 'boolean' || typeof v === 'number') {
          acc = combine(acc, Boolean(v));
          seen = true;
        }
      });
      if (failure !== null) return failure;
      continue;
    }
    const b = toBool(arg);
    if (isErr(b)) return b;
    acc = combine(acc, b);
    seen = true;
  }
  return seen ? acc : err('#VALUE!');
}

/** IF and IFERROR are lazy in the evaluator (only the chosen branch is evaluated); this entry exists for arity checking. */
export const LOGIC_FUNCTIONS: Record<string, FunctionDef> = {
  AND: { min: 1, max: Infinity, fn: (args, ctx) => fold(args, ctx, (a, b) => a && b, true) },
  OR: { min: 1, max: Infinity, fn: (args, ctx) => fold(args, ctx, (a, b) => a || b, false) },
  NOT: {
    min: 1,
    max: 1,
    fn: (args, ctx) => {
      const b = toBool(scalar(args[0] as Arg, ctx));
      return isErr(b) ? b : !b;
    },
  },
  IFERROR: {
    min: 1,
    max: 2,
    fn: (args: Arg[], ctx: FnContext): Value => {
      const v = scalar(args[0] as Arg, ctx);
      if (!isErr(v)) return v;
      return args[1] === undefined ? '' : scalar(args[1], ctx);
    },
  },
  IF: {
    min: 2,
    max: 3,
    fn: (args: Arg[], ctx: FnContext): Value => {
      const cond = toBool(scalar(args[0] as Arg, ctx));
      if (isErr(cond)) return cond;
      const chosen = cond ? args[1] : args[2];
      if (chosen === undefined) return false;
      return scalar(chosen, ctx);
    },
  },
};
