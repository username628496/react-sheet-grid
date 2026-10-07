import { useState } from 'react';
import { columnLabel } from '../core/model/address';
import type { GridController } from '../input/GridController';
import { useMessages } from './GridProvider';
import { Menu, type MenuEntry, type MenuItem } from './Menu';
import type { Messages } from './messages';

type Entry = MenuEntry;

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? '⌘' : 'Ctrl+';

/** Builds the menu for the current selection: whole-column / whole-row selections show only their own axis. */
export function buildMenuEntries(controller: GridController, openFilter: (viewCol: number) => void, m: Messages): Entry[] {
  const { sheet } = controller;
  const p = sheet.selection.primary;
  const rows = p.endRow - p.startRow + 1;
  const cols = p.endCol - p.startCol + 1;
  const wholeRows = p.startCol === 0 && p.endCol === sheet.colCount - 1;
  const wholeCols = p.startRow === 0 && p.endRow === sheet.rowCount - 1;
  const col = sheet.selection.activeCol;
  const colName = columnLabel(sheet.mapping.toDataCol(col));
  const readOnly = sheet.readOnly;
  const entries: Entry[] = [
    { label: m.cut, shortcut: `${MOD}X`, disabled: readOnly, run: () => controller.clipboard.exec('cut') },
    { label: m.copy, shortcut: `${MOD}C`, run: () => controller.clipboard.exec('copy') },
    { label: m.paste, shortcut: `${MOD}V`, disabled: readOnly, run: () => void controller.clipboard.pasteFromSystem() },
    'separator',
  ];
  // Hiding rows/columns only changes the view, so it stays available when the sheet is read-only.
  const structure = (label: string, run: () => void, mutates = true): MenuItem => ({ label, run, disabled: mutates && readOnly });
  if (!wholeCols) {
    entries.push(
      structure(m.insertRowsAbove(rows), () => sheet.insertRows(p.startRow, rows)),
      structure(m.insertRowsBelow(rows), () => sheet.insertRows(p.endRow + 1, rows)),
    );
  }
  if (!wholeRows) {
    entries.push(
      structure(m.insertColsLeft(cols), () => sheet.insertCols(p.startCol, cols)),
      structure(m.insertColsRight(cols), () => sheet.insertCols(p.endCol + 1, cols)),
    );
  }
  if (!wholeCols) entries.push(structure(m.deleteRows(p.startRow + 1, p.endRow + 1), () => sheet.deleteRows(p.startRow, rows)));
  if (!wholeRows) {
    const a = columnLabel(sheet.mapping.toDataCol(p.startCol));
    const b = columnLabel(sheet.mapping.toDataCol(p.endCol));
    entries.push(structure(m.deleteCols(a, b), () => sheet.deleteCols(p.startCol, cols)));
  }
  // Whole columns selected (column header): hide/show columns. Whole rows selected (row header): rows.
  if (wholeCols) {
    const a = columnLabel(sheet.mapping.toDataCol(p.startCol));
    const b = columnLabel(sheet.mapping.toDataCol(p.endCol));
    entries.push(structure(m.hideCols(a, b), () => void sheet.hideLines('col', p.startCol, p.endCol), false));
    if (sheet.cols.hiddenIn(p.startCol, p.endCol).length > 0) entries.push(structure(m.showHiddenCols, () => void sheet.showLines('col', p.startCol, p.endCol), false));
  }
  if (wholeRows) {
    entries.push(structure(m.hideRows(p.startRow + 1, p.endRow + 1), () => void sheet.hideLines('row', p.startRow, p.endRow), false));
    if (sheet.rows.hiddenIn(p.startRow, p.endRow).length > 0) entries.push(structure(m.showHiddenRows, () => void sheet.showLines('row', p.startRow, p.endRow), false));
  }
  entries.push({ label: m.conditionalFormatting, disabled: readOnly, run: () => controller.onOpenConditional?.() });
  entries.push({ label: m.dataValidation, disabled: readOnly, run: () => controller.onOpenValidation?.() });
  entries.push({ label: m.clearContents, shortcut: 'Del', disabled: readOnly, run: () => sheet.clearSelection() }, 'separator');
  entries.push(
    { label: m.sortSheetAsc(colName), run: () => sheet.sortByColumn(col, true) },
    { label: m.sortSheetDesc(colName), run: () => sheet.sortByColumn(col, false) },
  );
  if (sheet.viewState.sort !== null) entries.push({ label: m.removeSort, run: () => sheet.clearSort() });
  entries.push({ label: m.filterByValues(colName), run: () => openFilter(col) });
  if (sheet.isColumnFiltered(col)) entries.push({ label: m.removeFilter(colName), run: () => sheet.setColumnFilter(col, null) });
  if (sheet.viewState.filters.size > 1) entries.push({ label: m.removeAllFilters, run: () => sheet.clearFilters() });
  return entries;
}

interface ContextMenuProps {
  controller: GridController;
  x: number;
  y: number;
  onClose: () => void;
  onFilter: (viewCol: number, x: number, y: number) => void;
}

export function ContextMenu({ controller, x, y, onClose, onFilter }: ContextMenuProps) {
  const m = useMessages();
  // Built once per opening: the selection cannot change while the menu is up.
  const [entries] = useState(() => buildMenuEntries(controller, (col) => onFilter(col, x, y), m));
  return (
    <Menu
      entries={entries}
      x={x}
      y={y}
      label={m.cellMenu}
      testId="context-menu"
      onClose={onClose}
      // The clipboard commands need keyboard focus back on the grid's textarea.
      beforeRun={() => controller.editor.focus()}
    />
  );
}
