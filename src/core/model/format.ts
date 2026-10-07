import { type CellValue, isCellError } from './Cell';
import { formatDate, isDateFormat } from './dates';
import type { HorizontalAlign } from './StyleTable';

/**
 * Number formats are patterns: an optional prefix (a currency sign), `0` or `#,##0` (thousands separators), an
 * optional `.` plus zeros (the fixed number of decimals), then an optional suffix (`%` multiplies by 100, any other
 * text such as ` ₫` is shown as is). Examples: `0`, `0.00`, `#,##0.00`, `0.0%`, `$#,##0.00`, `#,##0 ₫`.
 */
export interface NumberPattern {
  prefix: string;
  grouping: boolean;
  decimals: number;
  suffix: string;
}

export const MAX_DECIMALS = 10;
const PATTERN = /^([^0#,.%]*)(#,##0|0)(?:\.(0+))?(%|[^0#,.%]*)$/;
const patternCache = new Map<string, NumberPattern | null>();

export function parseNumberFormat(format: string): NumberPattern | null {
  const cached = patternCache.get(format);
  if (cached !== undefined) return cached;
  const m = PATTERN.exec(format);
  const parsed =
    m === null || (m[3]?.length ?? 0) > MAX_DECIMALS
      ? null
      : { prefix: m[1] as string, grouping: m[2] === '#,##0', decimals: m[3]?.length ?? 0, suffix: m[4] as string };
  patternCache.set(format, parsed);
  return parsed;
}

export function buildNumberFormat(p: NumberPattern): string {
  return `${p.prefix}${p.grouping ? '#,##0' : '0'}${p.decimals > 0 ? `.${'0'.repeat(p.decimals)}` : ''}${p.suffix}`;
}

// Built once per (grouping, decimals): constructing Intl.NumberFormat per cell would dominate frame time.
const formatters = new Map<string, Intl.NumberFormat>();

function intl(grouping: boolean, decimals: number): Intl.NumberFormat {
  const key = `${grouping ? 'g' : 'n'}${decimals}`;
  let f = formatters.get(key);
  if (f === undefined) {
    f = new Intl.NumberFormat('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: grouping });
    formatters.set(key, f);
  }
  return f;
}

export function formatNumber(n: number, numberFormat: string | undefined): string {
  if (!Number.isFinite(n)) return String(n);
  if (numberFormat !== undefined && isDateFormat(numberFormat)) return formatDate(n, numberFormat);
  const pattern = numberFormat === undefined ? null : parseNumberFormat(numberFormat);
  if (pattern === null) {
    // 10 significant digits hides binary noise such as 0.1 + 0.2.
    return String(Number(n.toPrecision(10)));
  }
  const scaled = pattern.suffix === '%' ? n * 100 : n;
  const body = intl(pattern.grouping, pattern.decimals).format(Math.abs(scaled));
  // Rounding can turn a tiny negative into "0.00"; only show the sign when something non-zero is displayed.
  const negative = scaled < 0 && /[1-9]/.test(body);
  return `${negative ? '-' : ''}${pattern.prefix}${body}${pattern.suffix}`;
}

/** Decimals shown for a number in the automatic format (what "increase decimals" starts from). */
export function displayedDecimals(n: number): number {
  const text = formatNumber(n, undefined);
  const dot = text.indexOf('.');
  return dot < 0 || text.includes('e') ? 0 : text.length - dot - 1;
}

/**
 * The format after pressing "increase/decrease decimals". The automatic format counts the decimals the number
 * currently shows (so 1.5 becomes 1.50); an existing pattern keeps its prefix, grouping and suffix.
 */
export function shiftDecimals(format: string | undefined, delta: 1 | -1, sample: number | null): string {
  const pattern = (format === undefined ? null : parseNumberFormat(format)) ?? { prefix: '', grouping: false, decimals: sample === null ? 0 : displayedDecimals(sample), suffix: '' };
  const decimals = Math.max(0, Math.min(MAX_DECIMALS, pattern.decimals + delta));
  return buildNumberFormat({ ...pattern, decimals });
}

export function formatValue(value: CellValue | null, numberFormat?: string): string {
  if (value === null) return '';
  if (typeof value === 'number') return formatNumber(value, numberFormat);
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (isCellError(value)) return value.error;
  return value;
}

/** Same defaults as Google Sheets: numbers right, text left, booleans/errors centered. */
export function defaultAlign(value: CellValue | null): HorizontalAlign {
  if (typeof value === 'number') return 'right';
  if (typeof value === 'boolean' || isCellError(value)) return 'center';
  return 'left';
}
