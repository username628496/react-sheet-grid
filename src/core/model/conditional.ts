import { type CellValue, isCellError } from './Cell';
import { formatValue } from './format';
import { COMPARISONS, type Comparison, needsSecondBound } from './validation';

export type TextOp = 'contains' | 'notContains' | 'startsWith' | 'endsWith' | 'eq';

export const TEXT_OPS: readonly TextOp[] = ['contains', 'notContains', 'startsWith', 'endsWith', 'eq'];

export type Condition =
  /** Numbers; for `date` the bounds are date serials. */
  | { readonly kind: 'number' | 'date'; readonly op: Comparison; readonly a: number; readonly b?: number }
  /** Compares the displayed text, ignoring case. */
  | { readonly kind: 'text'; readonly op: TextOp; readonly text: string }
  | { readonly kind: 'blank' }
  | { readonly kind: 'notBlank' };

/**
 * When `when` holds for a cell, its text and/or background take these colors. Rules live in the cell style (like
 * validation) so they follow the cell through sort, paste, row edits, undo and snapshots; the first matching rule wins.
 * Only colors are conditional, which keeps fonts, and so text measuring, independent of cell values.
 */
export interface ConditionalRule {
  readonly when: Condition;
  readonly color?: string;
  readonly background?: string;
}

export const MAX_CONDITIONAL_RULES = 8;

function matchesNumber(c: Extract<Condition, { kind: 'number' | 'date' }>, n: number): boolean {
  const a = c.a;
  const b = c.b ?? c.a;
  switch (c.op) {
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

export function matchesCondition(c: Condition, value: CellValue | null): boolean {
  const blank = value === null || value === '';
  switch (c.kind) {
    case 'blank':
      return blank;
    case 'notBlank':
      return !blank;
    case 'number':
    case 'date':
      return typeof value === 'number' && matchesNumber(c, value);
    case 'text': {
      if (blank || isCellError(value)) return false;
      const shown = formatValue(value).toLowerCase();
      const needle = c.text.toLowerCase();
      switch (c.op) {
        case 'contains':
          return shown.includes(needle);
        case 'notContains':
          return !shown.includes(needle);
        case 'startsWith':
          return shown.startsWith(needle);
        case 'endsWith':
          return shown.endsWith(needle);
        case 'eq':
          return shown === needle;
      }
    }
  }
}

/** The first rule that matches, or undefined. No allocation: it runs for every visible cell on every draw. */
export function firstMatchingRule(rules: readonly ConditionalRule[], value: CellValue | null): ConditionalRule | undefined {
  for (const rule of rules) if (matchesCondition(rule.when, value)) return rule;
  return undefined;
}

function canonicalCondition(c: Condition): Condition {
  switch (c.kind) {
    case 'number':
    case 'date':
      return needsSecondBound(c.op) ? { kind: c.kind, op: c.op, a: c.a, b: c.b ?? c.a } : { kind: c.kind, op: c.op, a: c.a };
    case 'text':
      return { kind: 'text', op: c.op, text: c.text };
    default:
      return { kind: c.kind };
  }
}

export function canonicalRules(rules: readonly ConditionalRule[]): ConditionalRule[] {
  return rules.map((r) => {
    const out: { when: Condition; color?: string; background?: string } = { when: canonicalCondition(r.when) };
    if (r.color !== undefined) out.color = r.color;
    if (r.background !== undefined) out.background = r.background;
    return out;
  });
}

function readCondition(v: unknown): Condition | null {
  if (typeof v !== 'object' || v === null) return null;
  const r = v as Record<string, unknown>;
  if (r.kind === 'blank' || r.kind === 'notBlank') return { kind: r.kind };
  if (r.kind === 'text') {
    if (!TEXT_OPS.includes(r.op as TextOp) || typeof r.text !== 'string') return null;
    return { kind: 'text', op: r.op as TextOp, text: r.text };
  }
  if (r.kind !== 'number' && r.kind !== 'date') return null;
  if (!COMPARISONS.includes(r.op as Comparison) || typeof r.a !== 'number' || !Number.isFinite(r.a)) return null;
  const op = r.op as Comparison;
  if (!needsSecondBound(op)) return { kind: r.kind, op, a: r.a };
  return typeof r.b === 'number' && Number.isFinite(r.b) ? { kind: r.kind, op, a: r.a, b: r.b } : null;
}

const COLOR = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|[a-z]{3,20})$/i;

/** Reads rules from untrusted data; malformed rules are dropped one by one. */
export function readConditionalRules(v: unknown): ConditionalRule[] {
  if (!Array.isArray(v)) return [];
  const rules: ConditionalRule[] = [];
  for (const item of v.slice(0, MAX_CONDITIONAL_RULES)) {
    if (typeof item !== 'object' || item === null) continue;
    const r = item as Record<string, unknown>;
    const when = readCondition(r.when);
    if (when === null) continue;
    const rule: { when: Condition; color?: string; background?: string } = { when };
    if (typeof r.color === 'string' && COLOR.test(r.color)) rule.color = r.color;
    if (typeof r.background === 'string' && COLOR.test(r.background)) rule.background = r.background;
    rules.push(rule);
  }
  return rules;
}
