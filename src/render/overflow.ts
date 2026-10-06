import type { HorizontalAlign } from '../core/model/StyleTable';
import type { Spreadsheet } from '../core/Spreadsheet';

const MAX_SCAN = 60; // cells inspected per side; text rarely needs more and the scan runs per overflowing cell per frame

export interface Overflow {
  left: number;
  right: number;
}

/** Writes into a caller-owned object: this runs in the render loop, which must not allocate. */
export function computeOverflow(
  sheet: Spreadsheet,
  dataRow: number,
  viewCol: number,
  align: HorizontalAlign,
  textWidth: number,
  available: number,
  out: Overflow,
): Overflow {
  const need = textWidth - available; // how much wider than its own cell the text is
  out.left = 0;
  out.right = 0;
  if (need <= 0) return out;
  if (align === 'left') out.right = scan(sheet, dataRow, viewCol, 1, need);
  else if (align === 'right') out.left = scan(sheet, dataRow, viewCol, -1, need);
  else {
    out.left = scan(sheet, dataRow, viewCol, -1, need / 2);
    out.right = scan(sheet, dataRow, viewCol, 1, need / 2);
  }
  return out;
}

// Sum of the widths of consecutive empty cells next to the text, stopping once `need` is covered.
function scan(sheet: Spreadsheet, dataRow: number, viewCol: number, step: 1 | -1, need: number): number {
  const { cols, model, mapping } = sheet;
  let total = 0;
  for (let k = 1, c = viewCol + step; k <= MAX_SCAN && c >= 0 && c < cols.count && total < need; k++, c += step) {
    const value = model.getCell(dataRow, mapping.toDataCol(c)).value;
    if (value !== null && value !== '') break;
    total += cols.getSize(c);
  }
  return total;
}
