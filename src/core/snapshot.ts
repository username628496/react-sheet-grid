import { parseFormulaSafe } from '../formula/parser';
import { printFormula } from '../formula/print';
import { Spreadsheet, type SpreadsheetOptions } from './Spreadsheet';
import type { Cell, CellValue, ErrorCode } from './model/Cell';
import { isCellError } from './model/Cell';
import { MAX_COLS, MAX_ROWS } from './model/SheetModel';
import { type Border, type Borders, BORDER_SIDES, isBorder } from './model/borders';
import { clampFontSize } from './model/font';
import type { HorizontalAlign, Style, TextWrap, VerticalAlign } from './model/StyleTable';

export const SNAPSHOT_VERSION = 1;

/**
 * Everything needed to bring a sheet back after a reload, as plain JSON: `JSON.stringify` it, store it anywhere.
 * Undo history and the selection are deliberately not part of it (like reopening a file in Sheets).
 * Formulas are stored as text and recalculated on load, so cached results never go stale.
 */
export interface SheetSnapshot {
  version: typeof SNAPSHOT_VERSION;
  /** Rows of underlying data (not the visible count, which a filter can reduce). */
  rowCount: number;
  colCount: number;
  defaultRowHeight: number;
  defaultColWidth: number;
  /** Size overrides as [viewIndex, size] pairs. */
  rowSizes: Array<[number, number]>;
  colSizes: Array<[number, number]>;
  /** Index = styleId; entry 0 is the default style. */
  styles: Style[];
  /** [dataRow, dataCol, styleId, value] or, for a formula, [dataRow, dataCol, styleId, null, formulaText]. */
  cells: Array<[number, number, number, CellValue | null] | [number, number, number, null, string]>;
  frozenRows?: number;
  frozenCols?: number;
  /** viewRow -> dataRow when sorted/filtered/restructured there, otherwise null (natural order). */
  order: number[] | null;
  sort: { col: number; asc: boolean } | null;
  /** data column -> display texts that stay visible */
  filters: Array<[number, string[]]>;
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(`Invalid sheet snapshot: ${message}`);
    this.name = 'SnapshotError';
  }
}

export function serializeSheet(sheet: Spreadsheet): SheetSnapshot {
  const cells: SheetSnapshot['cells'] = [];
  sheet.model.forEachCell((row, col, cell) => {
    if (cell.formula !== undefined) cells.push([row, col, cell.styleId, null, printFormula(cell.formula, row, col)]);
    else cells.push([row, col, cell.styleId, cell.value]);
  });
  // Row-major order keeps the output stable between saves, which makes diffs and change detection meaningful.
  cells.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  const styles: Style[] = [];
  for (let id = 0; id < sheet.styles.size; id++) styles.push({ ...sheet.styles.get(id) });

  const pairs = (axis: { index: readonly number[]; size: readonly number[] }): Array<[number, number]> =>
    axis.index.map((at, k): [number, number] => [at, axis.size[k] as number]);
  const order = sheet.mapping.getOrder();
  const { sort, filters } = sheet.viewState;

  return {
    version: SNAPSHOT_VERSION,
    rowCount: sheet.mapping.dataRowCount,
    colCount: sheet.colCount,
    defaultRowHeight: sheet.rows.defaultSize,
    defaultColWidth: sheet.cols.defaultSize,
    rowSizes: pairs(sheet.rows.snapshot()),
    colSizes: pairs(sheet.cols.snapshot()),
    styles,
    cells,
    frozenRows: sheet.frozenRows,
    frozenCols: sheet.frozenCols,
    order: order === null ? null : Array.from(order),
    sort: sort === null ? null : { col: sort.col, asc: sort.asc },
    filters: [...filters].map(([col, allowed]): [number, string[]] => [col, [...allowed]]),
  };
}

/**
 * Builds a sheet from a snapshot (usually `JSON.parse` of stored text, hence `unknown`). Throws SnapshotError when
 * the data is not a snapshot this version understands, so a corrupt save can be reported instead of half-loaded.
 */
export function deserializeSheet(data: unknown, options: Omit<SpreadsheetOptions, 'rowCount' | 'colCount'> = {}): Spreadsheet {
  const d = record(data, 'snapshot');
  if (d.version !== SNAPSHOT_VERSION) throw new SnapshotError(`unsupported version ${String(d.version)}`);
  const rowCount = int(d.rowCount, 'rowCount', 1, MAX_ROWS);
  const colCount = int(d.colCount, 'colCount', 1, MAX_COLS);
  const sheet = new Spreadsheet({
    rowCount,
    colCount,
    defaultRowHeight: options.defaultRowHeight ?? positive(d.defaultRowHeight, 'defaultRowHeight'),
    defaultColWidth: options.defaultColWidth ?? positive(d.defaultColWidth, 'defaultColWidth'),
  });

  // Interning in the saved order gives every style back the id the cells refer to.
  const styles = array(d.styles, 'styles');
  styles.forEach((s, id) => {
    if (id === 0) return;
    const interned = sheet.styles.intern(readStyle(s));
    if (interned !== id) throw new SnapshotError(`style ${id} duplicates an earlier style`);
  });

  for (const raw of array(d.cells, 'cells')) {
    const c = array(raw, 'cell');
    const row = int(c[0], 'cell row', 0, rowCount - 1);
    const col = int(c[1], 'cell col', 0, colCount - 1);
    const styleId = int(c[2], 'cell style', 0, Math.max(0, styles.length - 1));
    if (c.length > 4 && typeof c[4] === 'string') {
      sheet.model.setCell(row, col, { value: null, styleId, formula: parseFormulaSafe(c[4], row, col) });
    } else {
      sheet.model.setCell(row, col, { value: readValue(c[3]), styleId } satisfies Cell);
    }
  }

  const order = d.order === null || d.order === undefined ? null : readOrder(d.order, rowCount);
  const sort = d.sort === null || d.sort === undefined ? null : readSort(d.sort, colCount);
  const filters = new Map<number, ReadonlySet<string>>();
  for (const f of array(d.filters ?? [], 'filters')) {
    const pair = array(f, 'filter');
    const allowed = array(pair[1], 'filter values');
    if (!allowed.every((v) => typeof v === 'string')) throw new SnapshotError('filter values must be strings');
    filters.set(int(pair[0], 'filter column', 0, colCount - 1), new Set(allowed as string[]));
  }
  sheet.restoreViewState({ sort, filters });
  sheet.mapping.setOrder(order);

  const viewRows = order === null ? rowCount : order.length;
  sheet.rows.restore({ count: viewRows, ...readSizes(d.rowSizes, 'rowSizes', viewRows) });
  sheet.cols.restore({ count: colCount, ...readSizes(d.colSizes, 'colSizes', colCount) });
  sheet.setFrozen(int(d.frozenRows ?? 0, 'frozenRows', 0, rowCount), int(d.frozenCols ?? 0, 'frozenCols', 0, colCount));
  sheet.recalculateAll();
  return sheet;
}

const ERROR_CODES: ReadonlySet<string> = new Set<ErrorCode>(['#DIV/0!', '#VALUE!', '#REF!', '#N/A', '#NAME?', '#NUM!', '#ERROR!']);
const ALIGNS: ReadonlySet<string> = new Set<HorizontalAlign>(['left', 'center', 'right']);
const WRAPS: ReadonlySet<string> = new Set<TextWrap>(['overflow', 'wrap', 'clip']);
const VALIGNS: ReadonlySet<string> = new Set<VerticalAlign>(['top', 'middle', 'bottom']);

function record(v: unknown, what: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`${what} must be an object`);
  return v as Record<string, unknown>;
}

function array(v: unknown, what: string): unknown[] {
  if (!Array.isArray(v)) throw new SnapshotError(`${what} must be an array`);
  return v;
}

function int(v: unknown, what: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw new SnapshotError(`${what} must be an integer in ${min}..${max}`);
  return v;
}

function positive(v: unknown, what: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) throw new SnapshotError(`${what} must be a positive number`);
  return v;
}

function readValue(v: unknown): CellValue | null {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (isCellError(v) && ERROR_CODES.has((v as { error: string }).error)) return { error: (v as { error: ErrorCode }).error };
  throw new SnapshotError('a cell holds a value that is not text, a number, a boolean or an error');
}

function readStyle(v: unknown): Style {
  const s = record(v, 'style');
  const out: { -readonly [K in keyof Style]: Style[K] } = {};
  for (const key of ['bold', 'italic', 'underline', 'strike'] as const) {
    if (s[key] === true) out[key] = true;
  }
  if (typeof s.color === 'string') out.color = s.color;
  if (typeof s.background === 'string') out.background = s.background;
  if (typeof s.numberFormat === 'string') out.numberFormat = s.numberFormat;
  if (typeof s.align === 'string' && ALIGNS.has(s.align)) out.align = s.align as HorizontalAlign;
  if (typeof s.fontSize === 'number' && Number.isFinite(s.fontSize)) out.fontSize = clampFontSize(s.fontSize);
  if (typeof s.wrap === 'string' && WRAPS.has(s.wrap)) out.wrap = s.wrap as TextWrap;
  if (typeof s.valign === 'string' && VALIGNS.has(s.valign)) out.valign = s.valign as VerticalAlign;
  if (typeof s.borders === 'object' && s.borders !== null) {
    const source = s.borders as Record<string, unknown>;
    const borders: { -readonly [K in keyof Borders]: Border } = {};
    for (const side of BORDER_SIDES) if (isBorder(source[side])) borders[side] = source[side] as Border;
    if (Object.keys(borders).length > 0) out.borders = borders;
  }
  return out;
}

function readOrder(v: unknown, rowCount: number): Int32Array {
  const list = array(v, 'order');
  const order = new Int32Array(list.length);
  const seen = new Set<number>();
  list.forEach((n, i) => {
    const row = int(n, 'order entry', 0, rowCount - 1);
    if (seen.has(row)) throw new SnapshotError('order lists a row twice');
    seen.add(row);
    order[i] = row;
  });
  return order;
}

function readSort(v: unknown, colCount: number): { col: number; asc: boolean } {
  const s = record(v, 'sort');
  if (typeof s.asc !== 'boolean') throw new SnapshotError('sort.asc must be a boolean');
  return { col: int(s.col, 'sort column', 0, colCount - 1), asc: s.asc };
}

function readSizes(v: unknown, what: string, count: number): { index: number[]; size: number[] } {
  const index: number[] = [];
  const size: number[] = [];
  let previous = -1;
  for (const entry of array(v ?? [], what)) {
    const pair = array(entry, what);
    const at = int(pair[0], `${what} index`, 0, Math.max(0, count - 1));
    if (at <= previous) throw new SnapshotError(`${what} must be sorted by index without repeats`);
    previous = at;
    const s = pair[1];
    if (typeof s !== 'number' || !Number.isFinite(s) || s < 0) throw new SnapshotError(`${what} holds an invalid size`);
    index.push(at);
    size.push(s);
  }
  return { index, size };
}
