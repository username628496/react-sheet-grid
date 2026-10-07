import { type KeyboardEvent, type ReactNode, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Spreadsheet } from '../core/Spreadsheet';
import type { Workbook } from '../core/Workbook';
import { type Border, DEFAULT_BORDER } from '../core/model/borders';
import { DEFAULT_FONT_SIZE, MAX_FONT_SIZE, MIN_FONT_SIZE } from '../core/model/font';
import { parseNumberFormat } from '../core/model/format';
import type { HorizontalAlign, Style } from '../core/model/StyleTable';
import type { GridController } from '../input/GridController';
import { columnLabel } from '../core/model/address';
import { ChromeStyles } from './chrome';
import { useMessages, useTheme } from './GridProvider';
import { CommandPalette } from './CommandPalette';
import { ConfirmDialog } from './ConfirmDialog';
import { downloadBytes, downloadText, MAX_IMPORT_BYTES, readTextFile } from './csvFile';
import { Icon, type IconName } from './icons';
import { buildCommands, type Command } from './toolbarCommands';
import { Menu, type MenuEntry } from './Menu';
import {
  deleteEntries,
  freezeEntries,
  functionEntries,
  insertEntries,
  fileEntries,
  borderEntries,
  type MenuId,
  valignEntries,
  wrapEntries,
  zoomEntries,
  visibilityEntries,
  numberFormatEntries,
  pasteEntries,
} from './toolbarMenus';

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** "Bold (⌘B)": the tooltip names the shortcut in the user's own platform vocabulary. */
function tip(label: string, shortcut?: string): string {
  if (shortcut === undefined) return label;
  const keys = shortcut
    .replace('Mod', IS_MAC ? '⌘' : 'Ctrl+')
    .replace('Shift', IS_MAC ? '⇧' : 'Shift+')
    .replace(/\+$/, '');
  return `${label} (${keys})`;
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MAX_XLSX_BYTES = 100 * 1024 * 1024;

interface ToolbarState {
  canUndo: boolean;
  canRedo: boolean;
  style: Style;
  rows: number;
  cols: number;
  painting: boolean;
  viewActive: boolean;
  columnFiltered: boolean;
  zoom: number;
  readOnly: boolean;
  canMerge: boolean;
  inMerge: boolean;
  formatted: boolean;
  activeColumn: number;
}

// Reading from the sheet through one string keeps useSyncExternalStore's snapshot comparison trivial and stable.
function snapshot(sheet: Spreadsheet, grid: GridController | null | undefined): string {
  const { selection, history } = sheet;
  const style = sheet.styles.get(sheet.getCellByView(selection.activeRow, selection.activeCol).styleId);
  const state: ToolbarState = {
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    style,
    rows: sheet.rowCount,
    cols: sheet.colCount,
    painting: grid?.painter.armed === true,
    viewActive: sheet.viewState.sort !== null || sheet.viewState.filters.size > 0,
    columnFiltered: sheet.isColumnFiltered(selection.activeCol),
    zoom: grid?.surface.zoom ?? 1,
    readOnly: sheet.readOnly,
    canMerge: sheet.canMerge(),
    inMerge: sheet.hasMergeInSelection(),
    formatted: sheet.selectionHasFormatting(),
    activeColumn: selection.activeCol,
  };
  return JSON.stringify(state);
}

interface ToolbarProps {
  sheet: Spreadsheet;
  /** The controller from DataGrid's onReady. Clipboard, paint format and filter buttons need it and stay disabled without. */
  grid?: GridController | null;
  /** Called after an action so the host can hand keyboard focus back to the grid. */
  onAction?: () => void;
  /**
   * Receives the workbook read from an .xlsx file the user opened. When it is not given the toolbar offers no
   * "open .xlsx" (it cannot replace what is showing), only the download.
   */
  onImportWorkbook?: (workbook: Workbook) => void;
}

interface OpenMenu {
  id: MenuId;
  x: number;
  y: number;
}

/**
 * Formatting toolbar. Buttons cancel the default mousedown so the grid's hidden
 * textarea keeps focus (and an in-progress edit is not committed by a blur).
 * Arrow keys, Home and End move between the controls (the WAI-ARIA toolbar pattern); Escape returns to the grid.
 */
export function Toolbar({ sheet, grid = null, onAction, onImportWorkbook }: ToolbarProps) {
  const raw = useSyncExternalStore(
    (listener) => sheet.subscribe(listener),
    () => snapshot(sheet, grid),
    () => snapshot(sheet, null), // server render: no controller exists yet
  );
  const m = useMessages();
  const theme = useTheme();
  const { canUndo, canRedo, style, rows, cols, painting, viewActive, columnFiltered, zoom, readOnly, canMerge, inMerge, formatted, activeColumn } = JSON.parse(raw) as ToolbarState;
  const [notice, setNotice] = useState<string | null>(null);
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  // What the Borders menu draws next: remembered between uses, like the pen in a paint program.
  const [borderChoice, setBorderChoice] = useState<Border>(DEFAULT_BORDER);
  const lastClosed = useRef<{ id: MenuId; at: number } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const xlsxInput = useRef<HTMLInputElement>(null);
  const [xlsxPending, setXlsxPending] = useState<File | null>(null);
  const [palette, setPalette] = useState<readonly Command[] | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  // When the groups do not fit in one row the toolbar offers "more tools", which wraps them onto several rows.
  const [expanded, setExpanded] = useState(false);
  const [crowded, setCrowded] = useState(false);
  // Things the sheet refused to do (an oversized paste) are announced in the same place as the size notice.
  useEffect(
    () => sheet.subscribeNotices((n) =>
        setNotice(
          n.code === 'validationRejected'
            ? m.validationRejected(m.describeValidation(n.rule))
            : n.code === 'mergeConflict'
              ? m.mergeConflict
              : n.code === 'exportTooLarge'
              ? m.exportTooLarge(n.limit)
              : n.code === 'formatTooLarge'
                ? m.formatTooLarge(n.limit)
                : m.pasteTooLarge(n.limit),
        ),
      ),
    [sheet, m],
  );
  useEffect(() => {
    if (notice === null) return;
    const timer = setTimeout(() => setNotice(null), 8000);
    return () => clearTimeout(timer);
  }, [notice]);

  useLayoutEffect(() => {
    const el = toolbarRef.current;
    if (el === null) return;
    // Only a single row can be measured: wrapped, everything "fits", so the button stays while expanded.
    const measure = (): void => setCrowded(el.scrollWidth > el.clientWidth + 1);
    if (expanded) {
      setCrowded(true);
      return;
    }
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [expanded, m, readOnly, rows, cols, zoom, inMerge, canMerge]);

  const run = (fn: () => void): void => {
    fn();
    onAction?.();
  };
  const align = (a: HorizontalAlign): void => run(() => sheet.formatSelection({ align: a }, 'Align'));
  const pattern = style.numberFormat === undefined ? null : parseNumberFormat(style.numberFormat);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Escape') {
      onAction?.();
      return;
    }
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!keys.includes(e.key)) return;
    if (e.target instanceof HTMLInputElement) return; // they use these keys themselves
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input.rdg-count-input'));
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (items.length === 0 || at < 0) return;
    e.preventDefault();
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (at + (e.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  };

  // In a read-only sheet everything that would change the document is disabled; viewing controls stay usable.
  const mutating = new Set([
    m.undo, m.redo, m.paintFormat, m.clearFormatting, m.cut, m.formatCurrencyButton, m.formatPercentButton, m.decreaseDecimals,
    m.increaseDecimals, m.dataValidation, m.conditionalFormatting, m.mergeCells, m.unmergeCells, m.decreaseFontSize, m.increaseFontSize, m.bold, m.italic, m.underline, m.strike, m.alignLeft, m.alignCenter, m.alignRight,
  ]);
  const mutatingMenus: ReadonlySet<MenuId> = new Set<MenuId>(['paste', 'numberFormat', 'insert', 'delete', 'functions', 'wrap', 'valign', 'borders']);

  const button = (
    icon: IconName | ReactNode,
    label: string,
    shortcut: string | undefined,
    active: boolean | undefined,
    onClick: () => void,
    disabled = false,
    extra?: ReactNode,
    /** Context for the tooltip only (the accessible name stays the plain label), e.g. which column a sort acts on. */
    hint?: string,
  ): ReactNode => (
    <button
      type="button"
      className="rdg-btn"
      title={hint === undefined ? tip(label, shortcut) : `${tip(label, shortcut)} · ${hint}`}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled || (readOnly && mutating.has(label))}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => run(onClick)}
    >
      {typeof icon === 'string' ? <Icon name={icon as IconName} /> : icon}
      {extra}
    </button>
  );

  /** A button that opens a menu below it. Clicking it again while open closes it (the outside-click already did). */
  const menuButton = (id: MenuId, icon: IconName | ReactNode, label: string, shortcut: string | undefined, disabled = false): ReactNode => (
    <button
      type="button"
      className="rdg-btn rdg-btn-menu"
      title={tip(label, shortcut)}
      aria-label={label}
      aria-haspopup="menu"
      aria-expanded={menu?.id === id}
      disabled={disabled || (readOnly && mutatingMenus.has(id))}
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => {
        const closed = lastClosed.current;
        if (closed !== null && closed.id === id && Date.now() - closed.at < 300) return;
        const rect = e.currentTarget.getBoundingClientRect();
        setMenu({ id, x: rect.left, y: rect.bottom + 4 });
      }}
    >
      {typeof icon === 'string' ? <Icon name={icon as IconName} /> : icon}
      <Icon name="chevron" />
    </button>
  );

  const entriesFor = (id: MenuId): MenuEntry[] => {
    switch (id) {
      case 'paste':
        return grid === null ? [] : pasteEntries(grid, m);
      case 'numberFormat':
        return numberFormatEntries(sheet, m);
      case 'insert':
        return insertEntries(sheet, m);
      case 'delete':
        return deleteEntries(sheet, m);
      case 'zoom':
        return grid === null ? [] : zoomEntries(grid);
      case 'borders':
        return borderEntries(sheet, m, borderChoice, setBorderChoice);
      case 'wrap':
        return wrapEntries(sheet, m);
      case 'valign':
        return valignEntries(sheet, m);
      case 'file':
        return fileEntries(sheet, m, { chooseFile: () => fileInput.current?.click(), download: (text) => downloadText('sheet.csv', text), chooseXlsx: onImportWorkbook === undefined ? undefined : () => xlsxInput.current?.click(), downloadXlsx: () => void downloadXlsx() });
      case 'visibility':
        return visibilityEntries(sheet, m);
      case 'freeze':
        return freezeEntries(sheet, m);
      case 'functions':
        return functionEntries(sheet, m);
    }
  };
  const menuLabels: Record<MenuId, string> = {
    paste: m.paste,
    numberFormat: m.moreFormats,
    insert: m.insert,
    delete: m.delete,
    visibility: m.visibility,
    freeze: m.freeze,
    functions: m.functions,
    zoom: m.zoom,
    file: m.file,
    borders: m.borders,
    wrap: m.textWrapping,
    valign: m.verticalAlign,
  };

  // The xlsx code is loaded on first use, so the grid's own bundle does not carry it.
  const downloadXlsx = async (): Promise<void> => {
    try {
      const { exportXlsx } = await import('../xlsx');
      const { data, warnings } = await exportXlsx(sheet.workbook ?? { sheets: [sheet], activeIndex: 0 });
      downloadBytes('spreadsheet.xlsx', data, XLSX_MIME);
      if (warnings.length > 0) setNotice(m.xlsxWarnings(warnings.length, warnings[0] as string));
    } catch (e) {
      setNotice(m.xlsxFailed(e instanceof Error ? e.message : String(e)));
    }
  };

  const importXlsxFile = async (file: File): Promise<void> => {
    try {
      const { importXlsx } = await import('../xlsx');
      const { workbook, warnings } = await importXlsx(await file.arrayBuffer());
      onImportWorkbook?.(workbook);
      if (warnings.length > 0) setNotice(m.xlsxWarnings(warnings.length, warnings[0] as string));
    } catch (e) {
      setNotice(m.xlsxFailed(e instanceof Error ? e.message : String(e)));
    }
  };

  const importFile = async (file: File): Promise<void> => {
    if (file.size > MAX_IMPORT_BYTES) {
      setNotice(m.importTooBig);
      return;
    }
    let sawNotice = false;
    const off = sheet.subscribeNotices(() => {
      sawNotice = true; // an oversized import already said why
    });
    try {
      const result = sheet.importCsv(await readTextFile(file));
      if (result === null && !sawNotice) setNotice(m.importEmpty);
    } finally {
      off();
    }
  };

  const text = (glyph: string): ReactNode => <span className="rdg-glyph">{glyph}</span>;
  const noGrid = grid === null;
  const openPalette = (): void => {
    setPalette(buildCommands({ sheet, grid, m, fileEntries: entriesFor('file') }));
  };
  // Alt+/ in the grid opens the command search.
  useEffect(() => {
    if (grid === null) return;
    grid.onOpenCommands = openPalette;
    return () => {
      grid.onOpenCommands = null;
    };
    // openPalette closes over the current messages and file inputs; re-binding on every render is what keeps it current.
  });
  const openFilter = (e: { currentTarget: HTMLElement }): void => {
    const rect = e.currentTarget.getBoundingClientRect();
    grid?.onOpenFilter?.(sheet.selection.activeCol, rect.left, rect.bottom + 4);
  };

  return (
    <div className="rdg-chrome rdg-toolbar-wrap" data-rdg-theme={theme}>
      <ChromeStyles />
      <div className="rdg-toolbar-row">
      <div ref={toolbarRef} role="toolbar" aria-label={m.toolbar} aria-orientation="horizontal" className="rdg-toolbar" data-expanded={expanded} data-testid="toolbar" onKeyDown={onKeyDown}>
        <div className="rdg-group" role="group" aria-label={m.file}>
          {menuButton('file', 'file', m.file, undefined)}
          {button('command', m.commandSearch, 'Alt+/', undefined, openPalette, noGrid)}
          {button('search', m.findAndReplace, 'Mod+F', undefined, () => grid?.onOpenFind?.(false), noGrid)}
          <input
            ref={xlsxInput}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            aria-hidden="true"
            aria-label={m.importXlsx}
            tabIndex={-1}
            data-testid="import-xlsx"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file === undefined) return;
              if (file.size > MAX_XLSX_BYTES) setNotice(m.importTooBig);
              else setXlsxPending(file);
            }}
          />
          <input
            ref={fileInput}
            type="file"
            accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
            aria-hidden="true"
            aria-label={m.importCsv}
            tabIndex={-1}
            data-testid="import-file"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = ''; // so choosing the same file again still fires
              if (file !== undefined) void importFile(file).then(() => onAction?.());
            }}
          />
        </div>
        <span className="rdg-sep" aria-hidden />
        <div className="rdg-group" role="group" aria-label={m.groupHistory}>
          {button('undo', m.undo, 'Mod+Z', undefined, () => sheet.undo(), !canUndo)}
          {button('redo', m.redo, 'Mod+Y', undefined, () => sheet.redo(), !canRedo)}
          {button('paintFormat', m.paintFormat, undefined, painting, () => grid?.painter.toggle(), noGrid)}
          {button('clearFormat', m.clearFormatting, 'Mod+\\', undefined, () => sheet.clearFormatting(), !formatted)}
        </div>
        <span className="rdg-sep" aria-hidden />
        <div className="rdg-group" role="group" aria-label={m.groupClipboard}>
          {button('cut', m.cut, 'Mod+X', undefined, () => grid?.clipboard.exec('cut'), noGrid)}
          {button('copy', m.copy, 'Mod+C', undefined, () => grid?.clipboard.exec('copy'), noGrid)}
          {menuButton('paste', 'paste', m.paste, 'Mod+V', noGrid)}
        </div>
        <span className="rdg-sep" aria-hidden />
        <div className="rdg-group" role="group" aria-label={m.groupSort}>
          {button('sortAsc', m.sortAsc, undefined, undefined, () => sheet.sortByColumn(sheet.selection.activeCol, true), false, undefined, columnLabel(sheet.mapping.toDataCol(activeColumn)))}
          {button('sortDesc', m.sortDesc, undefined, undefined, () => sheet.sortByColumn(sheet.selection.activeCol, false), false, undefined, columnLabel(sheet.mapping.toDataCol(activeColumn)))}
          <button
            type="button"
            className="rdg-btn"
            title={m.filter}
            aria-label={m.filter}
            aria-pressed={columnFiltered}
            disabled={noGrid}
            onMouseDown={(e) => e.preventDefault()}
            onClick={openFilter}
          >
            <Icon name="filter" />
          </button>
          {button('conditional', m.conditionalFormatting, undefined, undefined, () => grid?.onOpenConditional?.(), noGrid)}
          {button('validation', m.dataValidation, undefined, undefined, () => grid?.onOpenValidation?.(), noGrid)}
          {button('clearFilter', m.removeSortAndFilters, undefined, undefined, () => {
            sheet.clearSort();
            sheet.clearFilters();
          }, !viewActive)}
        </div>
        <span className="rdg-sep" aria-hidden />
        <div className="rdg-group" role="group" aria-label={m.groupNumber}>
          {button(text('$'), m.formatCurrencyButton, 'Mod+Shift+4', pattern?.prefix === '$', () => sheet.formatSelection({ numberFormat: '$#,##0.00' }, 'Number format'))}
          {button(text('%'), m.formatPercentButton, 'Mod+Shift+5', pattern?.suffix === '%', () => sheet.formatSelection({ numberFormat: '0.00%' }, 'Number format'))}
          {button(text('.0←'), m.decreaseDecimals, undefined, undefined, () => sheet.shiftSelectionDecimals(-1))}
          {button(text('.00→'), m.increaseDecimals, undefined, undefined, () => sheet.shiftSelectionDecimals(1))}
          {menuButton('numberFormat', text('123'), m.moreFormats, undefined)}
        </div>
        <span className="rdg-sep" aria-hidden />
        <div className="rdg-group" role="group" aria-label={m.groupFont}>
          {button(text('−'), m.decreaseFontSize, 'Mod+Shift+,', undefined, () => sheet.stepSelectionFontSize(-1))}
          <FontSizeField label={m.fontSize} value={style.fontSize ?? DEFAULT_FONT_SIZE} disabled={readOnly} onApply={(size) => run(() => sheet.formatSelection({ fontSize: size }, 'Font size'))} onDone={() => onAction?.()} />
          {button(text('+'), m.increaseFontSize, 'Mod+Shift+.', undefined, () => sheet.stepSelectionFontSize(1))}
        </div>
        <span className="rdg-sep" aria-hidden />
        <div className="rdg-group" role="group" aria-label={m.groupTextStyle}>
          {button('bold', m.bold, 'Mod+B', style.bold === true, () => sheet.toggleStyle('bold'))}
          {button('italic', m.italic, 'Mod+I', style.italic === true, () => sheet.toggleStyle('italic'))}
          {button('underline', m.underline, 'Mod+U', style.underline === true, () => sheet.toggleStyle('underline'))}
          {button('strike', m.strike, 'Mod+Shift+X', style.strike === true, () => sheet.toggleStyle('strike'))}
          <ColorButton
            icon="textColor"
            title={m.textColor}
            disabled={readOnly}
            value={style.color ?? '#1f2328'}
            active={style.color !== undefined}
            onPick={(color) => run(() => sheet.formatSelection({ color }, 'Text color'))}
            onClear={() => run(() => sheet.formatSelection({ color: undefined }, 'Text color'))}
          />
          <ColorButton
            icon="fillColor"
            title={m.fillColor}
            disabled={readOnly}
            value={style.background ?? '#ffffff'}
            active={style.background !== undefined}
            onPick={(background) => run(() => sheet.formatSelection({ background }, 'Fill color'))}
            onClear={() => run(() => sheet.formatSelection({ background: undefined }, 'Fill color'))}
          />
          {menuButton('borders', 'borders', m.borders, undefined)}
          {button('merge', inMerge ? m.unmergeCells : m.mergeCells, undefined, inMerge, () => (inMerge ? sheet.unmergeSelection() : sheet.mergeSelection()), noGrid || (!inMerge && !canMerge))}
          <ColorButton
            icon="borderColor"
            title={m.borderColor}
            disabled={readOnly}
            value={borderChoice.color}
            active={false}
            onPick={(color) => setBorderChoice({ ...borderChoice, color })}
            onClear={() => setBorderChoice({ ...borderChoice, color: DEFAULT_BORDER.color })}
          />
        </div>
        <span className="rdg-sep" aria-hidden />
        <div className="rdg-group" role="group" aria-label={m.groupAlignment}>
          {button('alignLeft', m.alignLeft, 'Mod+Shift+L', style.align === 'left', () => align('left'))}
          {button('alignCenter', m.alignCenter, 'Mod+Shift+E', style.align === 'center', () => align('center'))}
          {button('alignRight', m.alignRight, 'Mod+Shift+R', style.align === 'right', () => align('right'))}
          {menuButton('valign', 'valign', m.verticalAlign, undefined)}
          {menuButton('wrap', 'wrap', m.textWrapping, undefined)}
        </div>
        <span className="rdg-sep" aria-hidden />
        <div className="rdg-group" role="group" aria-label={m.groupStructure}>
          {menuButton('insert', 'insert', m.insert, undefined)}
          {menuButton('delete', 'remove', m.delete, undefined)}
          {menuButton('visibility', 'eyeOff', m.visibility, undefined)}
          {menuButton('freeze', 'freeze', m.freeze, undefined)}
          {menuButton('functions', 'sigma', m.functions, undefined)}
        </div>
        <span className="rdg-spacer" />
        <div className="rdg-group" role="group" aria-label={m.zoom}>
          {menuButton('zoom', text(`${Math.round(zoom * 100)}%`), m.zoom, undefined, noGrid)}
        </div>
        <div className="rdg-group" role="group" aria-label={m.groupSheetSize}>
          <CountField
            label={m.rowsLabel}
            ariaLabel={m.rowCount}
            disabled={readOnly}
            value={rows}
            onApply={(n) => {
              const { removedCells } = sheet.setRowCount(n);
              setNotice(removedCells > 0 ? m.removedCells(removedCells) : null);
            }}
            onDone={() => onAction?.()}
          />
          <CountField
            label={m.colsLabel}
            ariaLabel={m.colCount}
            disabled={readOnly}
            value={cols}
            onApply={(n) => {
              const { removedCells } = sheet.setColCount(n);
              setNotice(removedCells > 0 ? m.removedCells(removedCells) : null);
            }}
            onDone={() => onAction?.()}
          />
        </div>
      </div>
      {(crowded || expanded) && (
        <button
          type="button"
          className="rdg-btn rdg-toolbar-more"
          title={expanded ? m.fewerTools : m.moreTools}
          aria-label={expanded ? m.fewerTools : m.moreTools}
          aria-expanded={expanded}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setExpanded(!expanded)}
        >
          <Icon name="chevron" />
        </button>
      )}
      </div>
      {palette !== null && (
        <CommandPalette
          commands={palette}
          onClose={() => {
            setPalette(null);
            onAction?.();
          }}
        />
      )}
      {notice !== null && (
        <div className="rdg-notice" role="status">
          {notice}
        </div>
      )}
      {xlsxPending !== null && (
        <ConfirmDialog
          testId="import-xlsx-dialog"
          title={m.importXlsxTitle}
          body={m.importXlsxBody(xlsxPending.name)}
          confirmLabel={m.importXlsxConfirm}
          onCancel={() => setXlsxPending(null)}
          onConfirm={() => {
            const file = xlsxPending;
            setXlsxPending(null);
            void importXlsxFile(file).then(() => onAction?.());
          }}
        />
      )}
      {menu !== null && (
        <Menu
          entries={entriesFor(menu.id)}
          x={menu.x}
          y={menu.y}
          label={menuLabels[menu.id]}
          testId={`menu-${menu.id}`}
          onClose={(reason) => {
            // Only a press outside can be the first half of "click the button again to close"; a choice must not
            // swallow the next opening.
            if (reason === 'outside') lastClosed.current = { id: menu.id, at: Date.now() };
            setMenu(null);
          }}
          beforeRun={() => onAction?.()}
        />
      )}
    </div>
  );
}

interface CountFieldProps {
  label: string;
  ariaLabel: string;
  disabled?: boolean;
  value: number;
  onApply(n: number): void;
  /** After Enter or Esc, so the host can give focus back to the grid. */
  onDone(): void;
}

/** A small "Rows [ 50 ]" field: Enter or leaving the field applies the number, Esc or garbage restores the old one. */
function CountField({ label, ariaLabel, disabled = false, value, onApply, onDone }: CountFieldProps) {
  const [draft, setDraftState] = useState<string | null>(null);
  // Enter applies and then moves focus, which fires blur in the same tick, before React re-renders: the ref makes
  // that second apply see the draft is already consumed.
  const pending = useRef<string | null>(null);
  const setDraft = (text: string | null): void => {
    pending.current = text;
    setDraftState(text);
  };
  const apply = (): void => {
    const text = (pending.current ?? '').trim();
    setDraft(null);
    if (!/^\d+$/.test(text)) return;
    const n = Number(text);
    if (n !== value) onApply(n);
  };
  return (
    <label className="rdg-count">
      <span>{label}</span>
      <input
        className="rdg-count-input"
        aria-label={ariaLabel}
        disabled={disabled}
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        value={draft ?? String(value)}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={apply}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
          if (e.key === 'Enter') {
            e.preventDefault();
            apply();
            onDone();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            setDraft(null);
            onDone();
          }
        }}
      />
    </label>
  );
}

interface ColorButtonProps {
  icon: IconName;
  title: string;
  disabled?: boolean;
  value: string;
  active: boolean;
  onPick(color: string): void;
  onClear(): void;
}

function ColorButton({ icon, title, disabled = false, value, active, onPick, onClear }: ColorButtonProps) {
  const m = useMessages();
  const input = useRef<HTMLInputElement>(null);
  const pick = useRef(onPick);
  pick.current = onPick;

  // The native color input fires `input` continuously while dragging; `change` fires once on commit,
  // which keeps one color choice = one undo step.
  useEffect(() => {
    const el = input.current;
    if (el === null) return;
    const handler = (): void => pick.current(el.value);
    el.addEventListener('change', handler);
    return () => el.removeEventListener('change', handler);
  }, []);

  return (
    <span className="rdg-color">
      <button
        type="button"
        className="rdg-btn"
        title={title}
        aria-label={title}
        disabled={disabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => input.current?.click()}
      >
        <Icon name={icon} />
        <span className="rdg-swatch" style={{ ['--rdg-swatch' as string]: value }} />
      </button>
      <input ref={input} type="color" aria-hidden="true" aria-label={m.colorPicker(title)} defaultValue={value} key={value} tabIndex={-1} />
      {active && !disabled && (
        <button
          type="button"
          className="rdg-reset"
          title={m.resetColor(title)}
          aria-label={m.resetColor(title)}
          onMouseDown={(e) => e.preventDefault()}
          onClick={onClear}
        >
          <Icon name="close" />
        </button>
      )}
    </span>
  );
}

interface FontSizeFieldProps {
  label: string;
  value: number;
  disabled: boolean;
  onApply(size: number): void;
  onDone(): void;
}

/** The size box between the − and + buttons: Enter or leaving the box applies it, Esc or a non-number restores it. */
function FontSizeField({ label, value, disabled, onApply, onDone }: FontSizeFieldProps) {
  const [draft, setDraftState] = useState<string | null>(null);
  // Enter applies and then moves focus, which fires blur before React re-renders; the ref keeps that blur from applying twice.
  const pending = useRef<string | null>(null);
  const setDraft = (text: string | null): void => {
    pending.current = text;
    setDraftState(text);
  };
  const apply = (): void => {
    const text = (pending.current ?? '').trim();
    setDraft(null);
    if (!/^\d+$/.test(text)) return;
    const size = Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, Number(text)));
    if (size !== value) onApply(size);
  };
  return (
    <input
      className="rdg-count-input rdg-fontsize"
      aria-label={label}
      title={label}
      inputMode="numeric"
      autoComplete="off"
      spellCheck={false}
      disabled={disabled}
      value={draft ?? String(value)}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={apply}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing || e.keyCode === 229) return;
        if (e.key === 'Enter') {
          e.preventDefault();
          apply();
          onDone();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          setDraft(null);
          onDone();
        }
      }}
    />
  );
}
