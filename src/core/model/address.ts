/** 0 -> "A", 25 -> "Z", 26 -> "AA". */
export function columnLabel(index: number): string {
  let label = '';
  let n = index + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    label = String.fromCharCode(65 + rem) + label;
    n = Math.floor((n - 1) / 26);
  }
  return label;
}

/** "A" -> 0, "AA" -> 26. Returns -1 for anything that is not letters. */
export function parseColumnLabel(label: string): number {
  if (!/^[A-Za-z]+$/.test(label)) return -1;
  let n = 0;
  for (const ch of label.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function cellAddress(dataRow: number, dataCol: number): string {
  return `${columnLabel(dataCol)}${dataRow + 1}`;
}

export interface AddressRange {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

const CELL = /^\$?([A-Za-z]+)\$?(\d+)$/;
const COL_ONLY = /^\$?([A-Za-z]+)$/;
const ROW_ONLY = /^\$?(\d+)$/;

/**
 * Reads what a user types into the name box: `B3`, `A1:C5`, `B:B`, `A:C`, `2:2`, `3:5` (case-insensitive,
 * `$` ignored). Returns null for anything else or anything outside the sheet.
 */
export function parseRangeAddress(text: string, rowCount: number, colCount: number): AddressRange | null {
  const [a, b, extra] = text.trim().split(':');
  if (a === undefined || a === '' || extra !== undefined) return null;
  const from = parseEnd(a, rowCount, colCount);
  const to = b === undefined ? from : parseEnd(b, rowCount, colCount);
  if (from === null || to === null) return null;
  // A column-only end next to a row-only end (A:1) has no meaning.
  if ((from.row === null) !== (to.row === null) || (from.col === null) !== (to.col === null)) return null;
  const rows = from.row === null ? [0, rowCount - 1] : [from.row, (to.row as number)];
  const cols = from.col === null ? [0, colCount - 1] : [from.col, (to.col as number)];
  return {
    startRow: Math.min(rows[0] as number, rows[1] as number),
    endRow: Math.max(rows[0] as number, rows[1] as number),
    startCol: Math.min(cols[0] as number, cols[1] as number),
    endCol: Math.max(cols[0] as number, cols[1] as number),
  };
}

function parseEnd(part: string, rowCount: number, colCount: number): { row: number | null; col: number | null } | null {
  const cell = CELL.exec(part);
  if (cell !== null) {
    const col = parseColumnLabel(cell[1] as string);
    const row = Number(cell[2]) - 1;
    return col < 0 || col >= colCount || row < 0 || row >= rowCount ? null : { row, col };
  }
  const colOnly = COL_ONLY.exec(part);
  if (colOnly !== null) {
    const col = parseColumnLabel(colOnly[1] as string);
    return col < 0 || col >= colCount ? null : { row: null, col };
  }
  const rowOnly = ROW_ONLY.exec(part);
  if (rowOnly !== null) {
    const row = Number(rowOnly[1]) - 1;
    return row < 0 || row >= rowCount ? null : { row, col: null };
  }
  return null;
}

/** What the name box shows for a selection: `B3`, `A1:C5`, `B:B` (whole column) or `2:2` (whole row). */
export function formatRangeAddress(range: AddressRange, rowCount: number, colCount: number): string {
  const wholeCols = range.startRow === 0 && range.endRow === rowCount - 1;
  const wholeRows = range.startCol === 0 && range.endCol === colCount - 1;
  const col = (c: number): string => columnLabel(c);
  if (wholeCols && wholeRows) return `A1:${col(colCount - 1)}${rowCount}`;
  if (wholeCols) return range.startCol === range.endCol ? `${col(range.startCol)}:${col(range.startCol)}` : `${col(range.startCol)}:${col(range.endCol)}`;
  if (wholeRows) return `${range.startRow + 1}:${range.endRow + 1}`;
  const start = `${col(range.startCol)}${range.startRow + 1}`;
  if (range.startRow === range.endRow && range.startCol === range.endCol) return start;
  return `${start}:${col(range.endCol)}${range.endRow + 1}`;
}
