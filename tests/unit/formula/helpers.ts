import { parseColumnLabel } from '../../../src/core/model/address';
import { Spreadsheet } from '../../../src/core/Spreadsheet';

/** "B3" -> [row 2, col 1] */
export function addr(a1: string): [number, number] {
  const m = /^([A-Z]+)(\d+)$/.exec(a1) as RegExpExecArray;
  return [Number(m[2]) - 1, parseColumnLabel(m[1] as string)];
}

export function makeSheet(cells: Record<string, string | number> = {}): Spreadsheet {
  const sheet = new Spreadsheet({ rowCount: 1000, colCount: 26 });
  for (const [a1, v] of Object.entries(cells)) {
    const [r, c] = addr(a1);
    sheet.setCellInput(r, c, String(v));
  }
  return sheet;
}

export function set(sheet: Spreadsheet, a1: string, text: string | number): void {
  const [r, c] = addr(a1);
  sheet.setCellInput(r, c, String(text));
}

export function value(sheet: Spreadsheet, a1: string): unknown {
  const [r, c] = addr(a1);
  return sheet.getCellByView(r, c).value;
}

/** Evaluates a formula in cell Z1 of a sheet seeded with `cells` and returns its value. */
export function calc(formula: string, cells: Record<string, string | number> = {}): unknown {
  const sheet = makeSheet(cells);
  set(sheet, 'Z1', formula);
  return value(sheet, 'Z1');
}

export const e = (code: string): { error: string } => ({ error: code });
