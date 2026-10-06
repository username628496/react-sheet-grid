import type { Cell, CellValue } from './model/Cell';
import { isCellError } from './model/Cell';
import { formatValue } from './model/format';
import type { StyleTable } from './model/StyleTable';

export interface SortState {
  readonly col: number; // data column
  readonly asc: boolean;
}

/** What the user asked the view to show; the actual row order is derived from it. */
export interface ViewState {
  readonly sort: SortState | null;
  /** data column -> display texts that stay visible */
  readonly filters: ReadonlyMap<number, ReadonlySet<string>>;
}

export const EMPTY_VIEW_STATE: ViewState = { sort: null, filters: new Map() };

export function isDefaultView(state: ViewState): boolean {
  return state.sort === null && state.filters.size === 0;
}

/** Text a filter compares against, i.e. what the user sees in the cell. */
export function cellDisplayText(cell: Cell, styles: StyleTable): string {
  return formatValue(cell.value, styles.get(cell.styleId).numberFormat);
}

// Sort buckets, as in Sheets: numbers, text, booleans, errors; blanks always last.
const BUCKET_NUMBER = 0;
const BUCKET_TEXT = 1;
const BUCKET_BOOLEAN = 2;
const BUCKET_ERROR = 3;
const BUCKET_BLANK = 4;

export function sortBucket(value: CellValue | null): number {
  if (value === null || value === '') return BUCKET_BLANK;
  if (typeof value === 'number') return BUCKET_NUMBER;
  if (typeof value === 'string') return BUCKET_TEXT;
  if (typeof value === 'boolean') return BUCKET_BOOLEAN;
  return isCellError(value) ? BUCKET_ERROR : BUCKET_TEXT;
}

/** Compares two cell values for sorting. Blanks are not flipped by `asc` so they stay at the bottom. */
export function compareForSort(a: CellValue | null, b: CellValue | null, asc: boolean): number {
  const ba = sortBucket(a);
  const bb = sortBucket(b);
  if (ba === BUCKET_BLANK || bb === BUCKET_BLANK) return ba === bb ? 0 : ba === BUCKET_BLANK ? 1 : -1;
  if (ba !== bb) return asc ? ba - bb : bb - ba;
  const c = compareWithinBucket(a, b, ba);
  return asc ? c : -c;
}

function compareWithinBucket(a: CellValue | null, b: CellValue | null, bucket: number): number {
  if (bucket === BUCKET_NUMBER) return (a as number) - (b as number);
  if (bucket === BUCKET_BOOLEAN) return Number(a) - Number(b);
  const x = bucket === BUCKET_ERROR ? (a as { error: string }).error : String(a).toLowerCase();
  const y = bucket === BUCKET_ERROR ? (b as { error: string }).error : String(b).toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
}
