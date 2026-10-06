import { isCellError } from '../../core/model/Cell';
import {
  type Arg,
  err,
  type FnContext,
  type FunctionDef,
  isErr,
  isRange,
  scalar,
  toBool,
  toNumber,
  type Value,
} from './helpers';

// Order used by lookups: numbers < text < booleans, text compared case-insensitively.
function typeRank(v: Value): number {
  if (typeof v === 'number') return 0;
  if (typeof v === 'string') return 1;
  return 2;
}

function compareValues(a: Value, b: Value): number {
  const ra = typeRank(a);
  const rb = typeRank(b);
  if (ra !== rb) return ra - rb;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'string' && typeof b === 'string') {
    const x = a.toLowerCase();
    const y = b.toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
  }
  return Number(a) - Number(b);
}

function wildcardRegExp(pattern: string): RegExp {
  const source = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${source}$`, 'is');
}

function vlookup(args: Arg[], ctx: FnContext): Value {
  const key = scalar(args[0] as Arg, ctx);
  if (isErr(key)) return key;
  const range = args[1] as Arg;
  if (!isRange(range)) return err('#VALUE!');
  const idx = toNumber(scalar(args[2] as Arg, ctx));
  if (isCellError(idx)) return idx;
  const index = Math.trunc(idx);
  if (index < 1) return err('#VALUE!');
  const width = range.c2 - range.c1 + 1;
  if (index > width) return err('#REF!');
  let sorted = true;
  if (args.length > 3) {
    const flag = toBool(scalar(args[3] as Arg, ctx));
    if (isCellError(flag)) return flag;
    sorted = flag;
  }

  // Whole-column ranges are cut at the last used row so lookups never walk a million empty rows.
  const used = ctx.model.getUsedRange();
  if (used === null) return err('#N/A');
  const lastRow = Math.min(range.r2, used.endRow);
  const firstCol = range.c1;
  const result = (row: number): Value => ctx.model.getCell(row, firstCol + index - 1).value;
  const keyAt = (row: number): Value => ctx.model.getCell(row, firstCol).value;

  if (!sorted) {
    const wild = typeof key === 'string' && /[*?]/.test(key) ? wildcardRegExp(key) : null;
    for (let r = range.r1; r <= lastRow; r++) {
      const v = keyAt(r);
      if (v === null || isCellError(v)) continue;
      const hit =
        wild !== null
          ? typeof v === 'string' && wild.test(v)
          : key !== null && typeRank(v) === typeRank(key) && compareValues(v, key) === 0;
      if (hit) return result(r);
    }
    return err('#N/A');
  }

  // Approximate match: binary search for the last row whose key is <= the search key.
  if (key === null) return err('#N/A');
  let lo = range.r1;
  let hi = lastRow;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const v = keyAt(mid);
    // Blank or error keys sort after everything we can match; treat them as "too big".
    if (v === null || isCellError(v) || typeRank(v) > typeRank(key)) {
      hi = mid - 1;
    } else if (compareValues(v, key) <= 0) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found < 0 ? err('#N/A') : result(found);
}

export const LOOKUP_FUNCTIONS: Record<string, FunctionDef> = {
  VLOOKUP: { min: 3, max: 4, fn: vlookup },
};
