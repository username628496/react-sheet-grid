import { columnLabel } from '../core/model/address';
import type { Border, BorderPreset } from '../core/model/borders';
import type { Spreadsheet } from '../core/Spreadsheet';
import type { GridController } from '../input/GridController';
import type { MenuEntry } from './Menu';
import type { Messages } from './messages';

export type MenuId = 'paste' | 'numberFormat' | 'insert' | 'delete' | 'visibility' | 'freeze' | 'functions' | 'zoom' | 'file' | 'wrap' | 'valign' | 'borders';

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
    'separator',
    item('yyyy-mm-dd', m.formatDate('2026-10-07')),
    item('dd/mm/yyyy', m.formatDate('07/10/2026')),
    item('mm/dd/yyyy', m.formatDate('10/07/2026')),
    item('d mmm yyyy', m.formatDate('7 Oct 2026')),
    item('hh:mm', m.formatTime('14:30')),
    item('yyyy-mm-dd hh:mm', m.formatDateTime('2026-10-07 14:30')),
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

/** Hide/show for the rows and columns the selection covers (shown for whatever lines it spans, as Sheets does). */
export function visibilityEntries(sheet: Spreadsheet, m: Messages): MenuEntry[] {
  const p = sheet.selection.primary;
  const a = columnLabel(sheet.mapping.toDataCol(p.startCol));
  const b = columnLabel(sheet.mapping.toDataCol(p.endCol));
  return [
    { label: m.hideRows(p.startRow + 1, p.endRow + 1), shortcut: `${MOD}Alt+9`, run: () => void sheet.hideLines('row', p.startRow, p.endRow) },
    { label: m.hideCols(a, b), shortcut: `${MOD}Alt+0`, run: () => void sheet.hideLines('col', p.startCol, p.endCol) },
    'separator',
    { label: m.showHiddenRows, shortcut: `${MOD}⇧9`, disabled: sheet.rows.hiddenIn(p.startRow, p.endRow).length === 0, run: () => void sheet.showLines('row', p.startRow, p.endRow) },
    { label: m.showHiddenCols, shortcut: `${MOD}⇧0`, disabled: sheet.cols.hiddenIn(p.startCol, p.endCol).length === 0, run: () => void sheet.showLines('col', p.startCol, p.endCol) },
  ];
}

const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';

export const ZOOM_LEVELS = [0.5, 0.75, 0.9, 1, 1.25, 1.5, 1.75, 2] as const;

export function zoomEntries(grid: GridController): MenuEntry[] {
  return ZOOM_LEVELS.map((level) => ({
    label: `${Math.round(level * 100)}%`,
    checked: grid.surface.zoom === level,
    run: () => grid.surface.setZoom(level),
  }));
}

export function fileEntries(sheet: Spreadsheet, m: Messages, actions: { chooseFile: () => void; download: (text: string) => void }): MenuEntry[] {
  const exportAs = (content: 'displayed' | 'raw') => () => {
    const text = sheet.exportCsv({ content });
    if (text !== null) actions.download(text);
  };
  return [
    { label: m.importCsv, disabled: sheet.readOnly, run: actions.chooseFile },
    'separator',
    { label: m.exportCsvDisplayed, run: exportAs('displayed') },
    { label: m.exportCsvRaw, run: exportAs('raw') },
  ];
}

export function wrapEntries(sheet: Spreadsheet, m: Messages): MenuEntry[] {
  const { activeRow, activeCol } = sheet.selection;
  const current = sheet.styles.get(sheet.getCellByView(activeRow, activeCol).styleId).wrap ?? 'overflow';
  const item = (value: 'overflow' | 'wrap' | 'clip', label: string): MenuEntry => ({
    label,
    checked: current === value,
    run: () => sheet.formatSelection({ wrap: value === 'overflow' ? undefined : value }, 'Text wrapping'),
  });
  return [item('overflow', m.wrapOverflow), item('wrap', m.wrapWrap), item('clip', m.wrapClip)];
}

export function valignEntries(sheet: Spreadsheet, m: Messages): MenuEntry[] {
  const { activeRow, activeCol } = sheet.selection;
  const current = sheet.styles.get(sheet.getCellByView(activeRow, activeCol).styleId).valign ?? 'middle';
  const item = (value: 'top' | 'middle' | 'bottom', label: string): MenuEntry => ({
    label,
    checked: current === value,
    run: () => sheet.formatSelection({ valign: value === 'middle' ? undefined : value }, 'Vertical align'),
  });
  return [item('top', m.alignTop), item('middle', m.alignMiddle), item('bottom', m.alignBottom)];
}

const LINE_STYLES: ReadonlyArray<{ key: 'thin' | 'medium' | 'thick' | 'dashed' | 'dotted'; width: 1 | 2 | 3; style: Border['style'] }> = [
  { key: 'thin', width: 1, style: 'solid' },
  { key: 'medium', width: 2, style: 'solid' },
  { key: 'thick', width: 3, style: 'solid' },
  { key: 'dashed', width: 1, style: 'dashed' },
  { key: 'dotted', width: 1, style: 'dotted' },
];

export function borderEntries(sheet: Spreadsheet, m: Messages, choice: Border, setChoice: (border: Border) => void): MenuEntry[] {
  const apply = (preset: BorderPreset) => () => void sheet.applyBorders(preset, choice);
  const labels: Record<(typeof LINE_STYLES)[number]['key'], string> = {
    thin: m.borderThin,
    medium: m.borderMedium,
    thick: m.borderThick,
    dashed: m.borderDashed,
    dotted: m.borderDotted,
  };
  return [
    { label: m.borderAll, run: apply('all') },
    { label: m.borderOuter, run: apply('outer') },
    { label: m.borderInner, run: apply('inner') },
    { label: m.borderHorizontal, run: apply('horizontal') },
    { label: m.borderVertical, run: apply('vertical') },
    'separator',
    { label: m.borderTop, run: apply('top') },
    { label: m.borderBottom, run: apply('bottom') },
    { label: m.borderLeft, run: apply('left') },
    { label: m.borderRight, run: apply('right') },
    'separator',
    { label: m.borderNone, run: apply('none') },
    'separator',
    ...LINE_STYLES.map((l): MenuEntry => ({
      label: labels[l.key],
      checked: choice.width === l.width && choice.style === l.style,
      // Choosing a line only sets what the next border will look like; it does not touch the sheet.
      run: () => setChoice({ ...choice, width: l.width, style: l.style }),
    })),
  ];
}
