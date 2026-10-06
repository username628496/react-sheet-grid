import { type Arg, type FnContext, type FunctionDef, isErr, scalar, toText, type Value } from './helpers';

export const TEXT_FUNCTIONS: Record<string, FunctionDef> = {
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
