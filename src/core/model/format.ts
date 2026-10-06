import { type CellValue, isCellError } from './Cell';
import type { HorizontalAlign } from './StyleTable';

export const NUMBER_FORMATS = ['general', '0', '0.00', '#,##0', '#,##0.00', '0%', '0.00%', '$#,##0.00'] as const;

const FIXED = (min: number, max: number, grouping: boolean): Intl.NumberFormat =>
  new Intl.NumberFormat('en-US', { minimumFractionDigits: min, maximumFractionDigits: max, useGrouping: grouping });

// Built once: constructing Intl.NumberFormat per cell would dominate frame time.
const FORMATTERS: Record<string, Intl.NumberFormat> = {
  '0': FIXED(0, 0, false),
  '0.00': FIXED(2, 2, false),
  '#,##0': FIXED(0, 0, true),
  '#,##0.00': FIXED(2, 2, true),
  '0%': FIXED(0, 0, false),
  '0.00%': FIXED(2, 2, false),
  '$#,##0.00': FIXED(2, 2, true),
};

export function formatNumber(n: number, numberFormat: string | undefined): string {
  if (!Number.isFinite(n)) return String(n);
  const fmt = numberFormat === undefined ? undefined : FORMATTERS[numberFormat];
  if (fmt === undefined) {
    // 10 significant digits hides binary noise such as 0.1 + 0.2.
    return String(Number(n.toPrecision(10)));
  }
  if (numberFormat === '0%' || numberFormat === '0.00%') return `${fmt.format(n * 100)}%`;
  if (numberFormat === '$#,##0.00') return n < 0 ? `-$${fmt.format(-n)}` : `$${fmt.format(n)}`;
  return fmt.format(n);
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
