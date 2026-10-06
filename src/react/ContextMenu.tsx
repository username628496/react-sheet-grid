import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { columnLabel } from '../core/model/address';
import type { GridController } from '../input/GridController';
import { ChromeStyles } from './chrome';
import { useMessages, useTheme } from './GridProvider';
import type { Messages } from './messages';

interface Item {
  label: string;
  shortcut?: string;
  disabled?: boolean;
  title?: string;
  run: () => void;
}

type Entry = Item | 'separator';

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
  const entries: Entry[] = [
    { label: m.cut, shortcut: `${MOD}X`, run: () => controller.clipboard.exec('cut') },
    { label: m.copy, shortcut: `${MOD}C`, run: () => controller.clipboard.exec('copy') },
    { label: m.paste, shortcut: `${MOD}V`, run: () => void controller.clipboard.pasteFromSystem() },
    'separator',
  ];
  const structure = (label: string, run: () => void): Item => ({ label, run });
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
  entries.push({ label: m.clearContents, shortcut: 'Del', run: () => sheet.clearSelection() }, 'separator');
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
  const ref = useRef<HTMLDivElement>(null);
  const m = useMessages();
  const theme = useTheme();
  const [active, setActive] = useState(-1);
  const [pos, setPos] = useState({ x, y });
  // Built once per opening: the selection cannot change while the menu is up.
  const [entries] = useState(() => buildMenuEntries(controller, (col) => onFilter(col, x, y), m));
  const items = entries.filter((e): e is Item => e !== 'separator');

  // Keep the menu on screen.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const r = el.getBoundingClientRect();
    setPos({ x: Math.max(4, Math.min(x, window.innerWidth - r.width - 4)), y: Math.max(4, Math.min(y, window.innerHeight - r.height - 4)) });
    el.focus();
  }, [x, y]);

  useEffect(() => {
    const close = (e: Event): void => {
      if (ref.current !== null && e.target instanceof Node && ref.current.contains(e.target)) return;
      onClose();
    };
    window.addEventListener('mousedown', close, true);
    window.addEventListener('blur', onClose);
    window.addEventListener('resize', onClose);
    return () => {
      window.removeEventListener('mousedown', close, true);
      window.removeEventListener('blur', onClose);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  const activate = (item: Item): void => {
    if (item.disabled === true) return;
    onClose();
    // The clipboard commands need keyboard focus back on the grid's textarea.
    controller.editor.focus();
    item.run();
  };

  const onKeyDown = (e: React.KeyboardEvent): void => {
    const enabled = items.map((it, i) => (it.disabled === true ? -1 : i)).filter((i) => i >= 0);
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      controller.editor.focus();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const pos0 = enabled.indexOf(active);
      const step = e.key === 'ArrowDown' ? 1 : -1;
      const next = enabled[(pos0 + step + enabled.length) % enabled.length] ?? enabled[0] ?? -1;
      setActive(next);
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();
      const item = items[active];
      if (item !== undefined) activate(item);
    }
  };

  let index = -1;
  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={m.cellMenu}
      tabIndex={-1}
      data-testid="context-menu"
      data-rdg-theme={theme}
      className="rdg-chrome rdg-popup rdg-menu"
      style={{ left: pos.x, top: pos.y }}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      <ChromeStyles />
      {entries.map((entry, i) => {
        if (entry === 'separator') return <div key={`s${i}`} role="separator" className="rdg-menusep" />;
        index++;
        const myIndex = index;
        return (
          <button
            key={entry.label}
            type="button"
            role="menuitem"
            className="rdg-menuitem"
            data-active={active === myIndex}
            disabled={entry.disabled}
            title={entry.title}
            onMouseEnter={() => setActive(myIndex)}
            onClick={() => activate(entry)}
          >
            <span>{entry.label}</span>
            {entry.shortcut !== undefined && <span className="rdg-hint">{entry.shortcut}</span>}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
