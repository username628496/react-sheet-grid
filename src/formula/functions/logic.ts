import { type Arg, type FnContext, type FunctionDef, isErr, scalar, toBool, type Value } from './helpers';

/** IF is lazy in the evaluator (only the chosen branch is evaluated); this entry exists for arity checking. */
export const LOGIC_FUNCTIONS: Record<string, FunctionDef> = {
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
