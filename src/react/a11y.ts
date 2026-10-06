import { columnLabel } from '../core/model/address';
import type { Spreadsheet } from '../core/Spreadsheet';
import type { Messages } from './messages';

function address(viewRow: number, viewCol: number): string {
  return `${columnLabel(viewCol)}${viewRow + 1}`;
}

/**
 * What a screen reader should say when the selection changes: the active cell with its displayed value, preceded by
 * the extent when several cells are selected. The grid is drawn on a canvas, so nothing in the DOM says this unless we do.
 */
export function describeSelection(sheet: Spreadsheet, m: Messages): string {
  const { selection } = sheet;
  const { activeRow, activeCol } = selection;
  const cell = sheet.getCellByView(activeRow, activeCol);
  const text = sheet.getDisplayText(activeRow, activeCol);
  const kind = cell.formula !== undefined ? 'formula' : text === '' ? 'empty' : 'text';
  const active = m.a11yCell(address(activeRow, activeCol), text, kind);
  const p = selection.primary;
  const cells = (p.endRow - p.startRow + 1) * (p.endCol - p.startCol + 1);
  if (cells === 1) return active;
  return m.a11yRange(address(p.startRow, p.startCol), address(p.endRow, p.endCol), cells, active);
}

export function describeEditing(sheet: Spreadsheet, m: Messages): string {
  return m.a11yEditing(address(sheet.selection.activeRow, sheet.selection.activeCol));
}
