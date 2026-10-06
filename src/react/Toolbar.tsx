import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Spreadsheet } from '../core/Spreadsheet';
import { parseNumberFormat } from '../core/model/format';
import type { HorizontalAlign, Style } from '../core/model/StyleTable';
import type { GridController } from '../input/GridController';
import { ChromeStyles } from './chrome';
import { useMessages, useTheme } from './GridProvider';
import { Icon, type IconName } from './icons';
import { Menu, type MenuEntry } from './Menu';
import {
  deleteEntries,
  freezeEntries,
  functionEntries,
  insertEntries,
  type MenuId,
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

interface ToolbarState {
  canUndo: boolean;
  canRedo: boolean;
  style: Style;
  rows: number;
  cols: number;
  painting: boolean;
  viewActive: boolean;
  columnFiltered: boolean;
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
  };
  return JSON.stringify(state);
}

interface ToolbarProps {
  sheet: Spreadsheet;
  /** The controller from DataGrid's onReady. Clipboard, paint format and filter buttons need it and stay disabled without. */
  grid?: GridController | null;
  /** Called after an action so the host can hand keyboard focus back to the grid. */
  onAction?: () => void;
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
export function Toolbar({ sheet, grid = null, onAction }: ToolbarProps) {
  const raw = useSyncExternalStore(
    (listener) => sheet.subscribe(listener),
    () => snapshot(sheet, grid),
  );
  const m = useMessages();
  const theme = useTheme();
  const { canUndo, canRedo, style, rows, cols, painting, viewActive, columnFiltered } = JSON.parse(raw) as ToolbarState;
  const [notice, setNotice] = useState<string | null>(null);
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const lastClosed = useRef<{ id: MenuId; at: number } | null>(null);
  useEffect(() => {
    if (notice === null) return;
    const timer = setTimeout(() => setNotice(null), 8000);
    return () => clearTimeout(timer);
  }, [notice]);

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

  const button = (
    icon: IconName | ReactNode,
    label: string,
    shortcut: string | undefined,
    active: boolean | undefined,
    onClick: () => void,
    disabled = false,
    extra?: ReactNode,
  ): ReactNode => (
    <button
      type="button"
      className="rdg-btn"
      title={tip(label, shortcut)}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
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
      disabled={disabled}
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
  };

  const text = (glyph: string): ReactNode => <span className="rdg-glyph">{glyph}</span>;
  const noGrid = grid === null;
  const openFilter = (e: { currentTarget: HTMLElement }): void => {
    const rect = e.currentTarget.getBoundingClientRect();
    grid?.onOpenFilter?.(sheet.selection.activeCol, rect.left, rect.bottom + 4);
  };

  return (
    <div className="rdg-chrome rdg-toolbar-wrap" data-rdg-theme={theme}>
      <ChromeStyles />
      <div role="toolbar" aria-label={m.toolbar} aria-orientation="horizontal" className="rdg-toolbar" data-testid="toolbar" onKeyDown={onKeyDown}>
        <div className="rdg-group" role="group" aria-label={m.groupHistory}>
          {button('undo', m.undo, 'Mod+Z', undefined, () => sheet.undo(), !canUndo)}
          {button('redo', m.redo, 'Mod+Y', undefined, () => sheet.redo(), !canRedo)}
          {button('paintFormat', m.paintFormat, undefined, painting, () => grid?.painter.toggle(), noGrid)}
          {button('clearFormat', m.clearFormatting, 'Mod+\\', undefined, () => sheet.clearFormatting())}
        </div>
        <span className="rdg-sep" aria-hidden />
        <div className="rdg-group" role="group" aria-label={m.groupClipboard}>
          {button('cut', m.cut, 'Mod+X', undefined, () => grid?.clipboard.exec('cut'), noGrid)}
          {button('copy', m.copy, 'Mod+C', undefined, () => grid?.clipboard.exec('copy'), noGrid)}
          {menuButton('paste', 'paste', m.paste, 'Mod+V', noGrid)}
        </div>
        <span className="rdg-sep" aria-hidden />
        <div className="rdg-group" role="group" aria-label={m.groupSort}>
          {button('sortAsc', m.sortAsc, undefined, undefined, () => sheet.sortByColumn(sheet.selection.activeCol, true))}
          {button('sortDesc', m.sortDesc, undefined, undefined, () => sheet.sortByColumn(sheet.selection.activeCol, false))}
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
        <div className="rdg-group" role="group" aria-label={m.groupTextStyle}>
          {button('bold', m.bold, 'Mod+B', style.bold === true, () => sheet.toggleStyle('bold'))}
          {button('italic', m.italic, 'Mod+I', style.italic === true, () => sheet.toggleStyle('italic'))}
          {button('underline', m.underline, 'Mod+U', style.underline === true, () => sheet.toggleStyle('underline'))}
          {button('strike', m.strike, 'Mod+Shift+X', style.strike === true, () => sheet.toggleStyle('strike'))}
          <ColorButton
            icon="textColor"
            title={m.textColor}
            value={style.color ?? '#1f2328'}
            active={style.color !== undefined}
            onPick={(color) => run(() => sheet.formatSelection({ color }, 'Text color'))}
            onClear={() => run(() => sheet.formatSelection({ color: undefined }, 'Text color'))}
          />
          <ColorButton
            icon="fillColor"
            title={m.fillColor}
            value={style.background ?? '#ffffff'}
            active={style.background !== undefined}
            onPick={(background) => run(() => sheet.formatSelection({ background }, 'Fill color'))}
            onClear={() => run(() => sheet.formatSelection({ background: undefined }, 'Fill color'))}
          />
        </div>
        <span className="rdg-sep" aria-hidden />
        <div className="rdg-group" role="group" aria-label={m.groupAlignment}>
          {button('alignLeft', m.alignLeft, 'Mod+Shift+L', style.align === 'left', () => align('left'))}
          {button('alignCenter', m.alignCenter, 'Mod+Shift+E', style.align === 'center', () => align('center'))}
          {button('alignRight', m.alignRight, 'Mod+Shift+R', style.align === 'right', () => align('right'))}
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
        <div className="rdg-group" role="group" aria-label={m.groupSheetSize}>
          <CountField
            label={m.rowsLabel}
            ariaLabel={m.rowCount}
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
            value={cols}
            onApply={(n) => {
              const { removedCells } = sheet.setColCount(n);
              setNotice(removedCells > 0 ? m.removedCells(removedCells) : null);
            }}
            onDone={() => onAction?.()}
          />
        </div>
      </div>
      {notice !== null && (
        <div className="rdg-notice" role="status">
          {notice}
        </div>
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
  value: number;
  onApply(n: number): void;
  /** After Enter or Esc, so the host can give focus back to the grid. */
  onDone(): void;
}

/** A small "Rows [ 50 ]" field: Enter or leaving the field applies the number, Esc or garbage restores the old one. */
function CountField({ label, ariaLabel, value, onApply, onDone }: CountFieldProps) {
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
  value: string;
  active: boolean;
  onPick(color: string): void;
  onClear(): void;
}

function ColorButton({ icon, title, value, active, onPick, onClear }: ColorButtonProps) {
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
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => input.current?.click()}
      >
        <Icon name={icon} />
        <span className="rdg-swatch" style={{ ['--rdg-swatch' as string]: value }} />
      </button>
      <input ref={input} type="color" aria-label={m.colorPicker(title)} defaultValue={value} key={value} tabIndex={-1} />
      {active && (
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
