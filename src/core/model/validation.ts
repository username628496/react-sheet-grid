import { type CellValue, isCellError } from './Cell';
import { formatValue } from './format';

export type Comparison = 'between' | 'notBetween' | 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte';

export const COMPARISONS: readonly Comparison[] = ['between', 'notBetween', 'eq', 'neq', 'gt', 'gte', 'lt', 'lte'];

/**
 * A data validation rule. It lives in the cell's style, so it follows the cell through sort, copy/paste, row and
 * column edits, undo and snapshots without any bookkeeping of its own. `strict` rejects input that breaks the rule;
 * otherwise the input is accepted and the cell is only flagged. Blank cells are always valid.
 */
export type Validation =
  | { readonly kind: 'list'; readonly items: readonly string[]; readonly strict: boolean }
  /** Numbers; for `date` the bounds are date serials. */
  | { readonly kind: 'number' | 'date'; readonly op: Comparison; readonly a: number; readonly b?: number; readonly strict: boolean };

export const MAX_LIST_ITEMS = 500;

export function needsSecondBound(op: Comparison): boolean {
  return op === 'between' || op === 'notBetween';
}

/** The same rule written the same way, so equal rules intern to one style. */
export function canonicalValidation(v: Validation): Validation {
  if (v.kind === 'list') return { kind: 'list', items: [...v.items], strict: v.strict };
  return needsSecondBound(v.op) ? { kind: v.kind, op: v.op, a: v.a, b: v.b ?? v.a, strict: v.strict } : { kind: v.kind, op: v.op, a: v.a, strict: v.strict };
}

function compare(op: Comparison, n: number, a: number, b: number): boolean {
  switch (op) {
    case 'between':
      return n >= Math.min(a, b) && n <= Math.max(a, b);
    case 'notBetween':
      return n < Math.min(a, b) || n > Math.max(a, b);
    case 'eq':
      return n === a;
    case 'neq':
      return n !== a;
    case 'gt':
      return n > a;
    case 'gte':
      return n >= a;
    case 'lt':
      return n < a;
    case 'lte':
      return n <= a;
  }
}

export function isValid(rule: Validation, value: CellValue | null): boolean {
  if (value === null || value === '') return true;
  if (isCellError(value)) return false;
  if (rule.kind === 'list') return rule.items.includes(formatValue(value));
  if (typeof value !== 'number') return false;
  return compare(rule.op, value, rule.a, rule.b ?? rule.a);
}

export function parseListItems(text: string): string[] {
  const items: string[] = [];
  for (const raw of text.split(/[,\n]/)) {
    const item = raw.trim();
    if (item !== '' && !items.includes(item)) items.push(item);
  }
  return items.slice(0, MAX_LIST_ITEMS);
}

/** Reads a rule from untrusted data (a snapshot); anything malformed is dropped rather than half-applied. */
export function readValidation(v: unknown): Validation | null {
  if (typeof v !== 'object' || v === null) return null;
  const r = v as Record<string, unknown>;
  const strict = r.strict === true;
  if (r.kind === 'list') {
    if (!Array.isArray(r.items) || !r.items.every((i) => typeof i === 'string')) return null;
    return { kind: 'list', items: (r.items as string[]).slice(0, MAX_LIST_ITEMS), strict };
  }
  if (r.kind !== 'number' && r.kind !== 'date') return null;
  if (!COMPARISONS.includes(r.op as Comparison) || typeof r.a !== 'number' || !Number.isFinite(r.a)) return null;
  const op = r.op as Comparison;
  if (needsSecondBound(op)) {
    if (typeof r.b !== 'number' || !Number.isFinite(r.b)) return null;
    return { kind: r.kind, op, a: r.a, b: r.b, strict };
  }
  return { kind: r.kind, op, a: r.a, strict };
}
