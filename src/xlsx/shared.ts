import type { Comparison } from '../core/model/validation';

/** Functions Excel stores with an `_xlfn.` prefix because they arrived after Excel 2007. */
export const XLFN_FUNCTIONS: ReadonlySet<string> = new Set(['CONCAT', 'DAYS']);

/** Comparison operators of data validation and conditional formatting, in this grid's names and Excel's. */
export const OPERATOR_TO_EXCEL: Readonly<Record<Comparison, string>> = {
  between: 'between',
  notBetween: 'notBetween',
  eq: 'equal',
  neq: 'notEqual',
  gt: 'greaterThan',
  gte: 'greaterThanOrEqual',
  lt: 'lessThan',
  lte: 'lessThanOrEqual',
};

export const OPERATOR_FROM_EXCEL: Readonly<Record<string, Comparison>> = Object.fromEntries(
  Object.entries(OPERATOR_TO_EXCEL).map(([ours, theirs]) => [theirs, ours as Comparison]),
);

/** Points per pixel: Excel sizes fonts and rows in points, this grid in pixels. */
export const PT_PER_PX = 0.75;
/** Pixels per character width unit of a column (the width of a digit in Excel's default font). */
export const PX_PER_CHAR = 7;

/** `#rgb` / `#rrggbb` as Excel's ARGB, or null for anything else (named colors, rgba(): not carried over). */
export function toArgb(color: string): string | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color);
  if (m === null) return null;
  const hex = (m[1] as string).length === 3 ? [...(m[1] as string)].map((c) => c + c).join('') : (m[1] as string);
  return `FF${hex.toUpperCase()}`;
}

/**
 * Excel's ARGB (or RGB) as `#rrggbb`; null when malformed. The alpha byte is ignored: Excel ignores it too, and some
 * writers (openpyxl) put 00 there for fully opaque colors.
 */
export function fromArgb(argb: string | undefined): string | null {
  if (argb === undefined) return null;
  const m = /^(?:[0-9a-f]{2})?([0-9a-f]{6})$/i.exec(argb);
  return m === null ? null : `#${(m[1] as string).toLowerCase()}`;
}
