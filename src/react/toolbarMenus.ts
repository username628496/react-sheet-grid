import { columnLabel } from '../core/model/address';
import type { Spreadsheet } from '../core/Spreadsheet';
import type { GridController } from '../input/GridController';
import type { MenuEntry } from './Menu';
import type { Messages } from './messages';

export type MenuId = 'paste' | 'numberFormat' | 'insert' | 'delete' | 'freeze' | 'functions';

/** Number patterns offered by the "More formats" menu, in display order; '' is the automatic format. */
export function numberFormatEntries(sheet: Spreadsheet, m: Messages): MenuEntry[] {
  const { activeRow, activeCol } = sheet.selection;
  const current = sheet.styles.get(sheet.getCellByView(activeRow, activeCol).styleId).numberFormat ?? '';
  const item = (format: string, label: string): MenuEntry => ({
    label,
    checked: current === format,
    run: () => sheet.formatSelection({ numberFormat: format === '' ? undefined : format }, 'Number format'),
  });
  return [
    item('', m.formatAutomatic),
    'separator',
    item('0', m.formatNumber('1235')),
    item('0.00', m.formatNumber('1234.57')),
    item('#,##0', m.formatNumber('1,235')),
    item('#,##0.00', m.formatNumber('1,234.57')),
    'separator',
    item('0%', m.formatPercent('26%')),
    item('0.00%', m.formatPercent('25.67%')),
    'separator',
    item('$#,##0.00', m.formatCurrency('$1,234.57')),
    item('€#,##0.00', m.formatEuro('€1,234.57')),
    item('#,##0 ₫', m.formatDong('1,235 ₫')),
  ];
}

export function pasteEntries(grid: GridController, m: Messages): MenuEntry[] {
  return [
    { label: m.paste, run: () => void grid.clipboard.pasteFromSystem() },
    { label: m.pasteValues, run: () => grid.clipboard.armPaste('values') },
    { label: m.pasteFormat, run: () => grid.clipboard.armPaste('format') },
  ];
}

export function insertEntries(sheet: Spreadsheet, m: Messages): MenuEntry[] {
  const p = sheet.selection.primary;
  const rows = p.endRow - p.startRow + 1;
  const cols = p.endCol - p.startCol + 1;
  const wholeCols = p.startRow === 0 && p.endRow === sheet.rowCount - 1;
  const wholeRows = p.startCol === 0 && p.endCol === sheet.colCount - 1;
  return [
    { label: m.insertRowsAbove(rows), disabled: wholeCols, run: () => sheet.insertRows(p.startRow, rows) },
    { label: m.insertRowsBelow(rows), disabled: wholeCols, run: () => sheet.insertRows(p.endRow + 1, rows) },
    'separator',
    { label: m.insertColsLeft(cols), disabled: wholeRows, run: () => sheet.insertCols(p.startCol, cols) },
    { label: m.insertColsRight(cols), disabled: wholeRows, run: () => sheet.insertCols(p.endCol + 1, cols) },
  ];
}

export function deleteEntries(sheet: Spreadsheet, m: Messages): MenuEntry[] {
  const p = sheet.selection.primary;
  const rows = p.endRow - p.startRow + 1;
  const cols = p.endCol - p.startCol + 1;
  const wholeCols = p.startRow === 0 && p.endRow === sheet.rowCount - 1;
  const wholeRows = p.startCol === 0 && p.endCol === sheet.colCount - 1;
  const a = columnLabel(sheet.mapping.toDataCol(p.startCol));
  const b = columnLabel(sheet.mapping.toDataCol(p.endCol));
  return [
    { label: m.deleteRows(p.startRow + 1, p.endRow + 1), disabled: wholeCols, run: () => sheet.deleteRows(p.startRow, rows) },
    { label: m.deleteCols(a, b), disabled: wholeRows, run: () => sheet.deleteCols(p.startCol, cols) },
  ];
}

export function freezeEntries(sheet: Spreadsheet, m: Messages): MenuEntry[] {
  const { frozenRows, frozenCols, selection } = sheet;
  const rowChoices: MenuEntry[] = [
    { label: m.noFrozenRows, checked: frozenRows === 0, run: () => sheet.setFrozen(0, frozenCols) },
    { label: m.freezeRows(1), checked: frozenRows === 1, run: () => sheet.setFrozen(1, frozenCols) },
    { label: m.freezeRows(2), checked: frozenRows === 2, run: () => sheet.setFrozen(2, frozenCols) },
  ];
  // "Up to the current row" is only a separate choice when it is not already one of the fixed ones.
  const upToRow = selection.activeRow + 1;
  if (upToRow > 2) rowChoices.push({ label: m.freezeUpToRow(upToRow), checked: frozenRows === upToRow, run: () => sheet.setFrozen(upToRow, frozenCols) });
  const colChoices: MenuEntry[] = [
    { label: m.noFrozenCols, checked: frozenCols === 0, run: () => sheet.setFrozen(frozenRows, 0) },
    { label: m.freezeCols(1), checked: frozenCols === 1, run: () => sheet.setFrozen(frozenRows, 1) },
    { label: m.freezeCols(2), checked: frozenCols === 2, run: () => sheet.setFrozen(frozenRows, 2) },
  ];
  const upToCol = selection.activeCol + 1;
  if (upToCol > 2) colChoices.push({ label: m.freezeUpToCol(columnLabel(sheet.mapping.toDataCol(selection.activeCol))), checked: frozenCols === upToCol, run: () => sheet.setFrozen(frozenRows, upToCol) });
  return [...rowChoices, 'separator', ...colChoices];
}

export function functionEntries(sheet: Spreadsheet, m: Messages): MenuEntry[] {
  const usable = sheet.mapping.isIdentity; // a view range is not a data range while sorted or filtered
  const item = (name: 'SUM' | 'AVERAGE' | 'COUNT' | 'MAX' | 'MIN', label: string): MenuEntry => ({
    label,
    disabled: !usable,
    run: () => void sheet.insertFunction(name),
  });
  return [item('SUM', m.fnSum), item('AVERAGE', m.fnAverage), item('COUNT', m.fnCount), item('MAX', m.fnMax), item('MIN', m.fnMin)];
}
