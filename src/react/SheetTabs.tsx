import { type KeyboardEvent, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Spreadsheet } from '../core/Spreadsheet';
import type { Workbook } from '../core/Workbook';
import { ChromeStyles } from './chrome';
import { ConfirmDialog } from './ConfirmDialog';
import { useMessages, useTheme } from './GridProvider';
import { Icon } from './icons';
import { Menu, type MenuEntry } from './Menu';

interface SheetTabsProps {
  workbook: Workbook;
  /** Called after an action so the host can hand keyboard focus back to the grid. */
  onAction?: () => void;
}

/** The bottom bar of a workbook: one tab per sheet, a button to add one, and a menu per tab. */
export function SheetTabs({ workbook, onAction }: SheetTabsProps) {
  const m = useMessages();
  const theme = useTheme();
  useSyncExternalStore(
    (listener) => workbook.subscribe(listener),
    () => workbook.revision,
    () => workbook.revision,
  );
  const [menu, setMenu] = useState<{ sheet: Spreadsheet; x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState<Spreadsheet | null>(null);
  const [deleting, setDeleting] = useState<Spreadsheet | null>(null);
  const readOnly = workbook.readOnly;
  const active = workbook.active;

  const select = (sheet: Spreadsheet): void => {
    workbook.setActive(sheet);
    onAction?.();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLElement>, sheet: Spreadsheet): void => {
    const index = workbook.indexOf(sheet);
    const go = (to: number): void => {
      const target = workbook.sheets[Math.max(0, Math.min(workbook.sheets.length - 1, to))];
      if (target === undefined) return;
      workbook.setActive(target);
      requestAnimationFrame(() => document.querySelector<HTMLElement>('.rdg-tab[aria-selected="true"]')?.focus());
    };
    if (e.key === 'ArrowRight') go(index + 1);
    else if (e.key === 'ArrowLeft') go(index - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(workbook.sheets.length - 1);
    else if (e.key === 'F2' && !readOnly) setRenaming(sheet);
    else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      const r = e.currentTarget.getBoundingClientRect();
      setMenu({ sheet, x: r.left, y: r.top });
    } else return;
    e.preventDefault();
  };

  const menuEntries = (sheet: Spreadsheet): MenuEntry[] => {
    const index = workbook.indexOf(sheet);
    return [
      { label: m.renameSheet, shortcut: 'F2', disabled: readOnly, run: () => setRenaming(sheet) },
      { label: m.duplicateSheet, disabled: readOnly, run: () => void workbook.duplicateSheet(sheet) },
      { label: m.deleteSheet, disabled: readOnly || workbook.sheets.length < 2, run: () => setDeleting(sheet) },
      'separator',
      { label: m.moveSheetLeft, disabled: readOnly || index === 0, run: () => void workbook.moveSheet(sheet, index - 1) },
      { label: m.moveSheetRight, disabled: readOnly || index === workbook.sheets.length - 1, run: () => void workbook.moveSheet(sheet, index + 1) },
    ];
  };

  return (
    <div className="rdg-chrome rdg-tabs" data-rdg-theme={theme} data-testid="sheet-tabs">
      <ChromeStyles />
      <button
        type="button"
        className="rdg-btn rdg-tabs-add"
        title={m.addSheet}
        aria-label={m.addSheet}
        disabled={readOnly}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          workbook.addSheet();
          onAction?.();
        }}
      >
        <Icon name="insert" />
      </button>
      <div role="tablist" aria-label={m.sheetTabs} className="rdg-tablist">
        {workbook.sheets.map((sheet) =>
          renaming === sheet ? (
            <RenameField
              key={sheet.name}
              workbook={workbook}
              sheet={sheet}
              onDone={() => {
                setRenaming(null);
                onAction?.();
              }}
            />
          ) : (
            <button
              key={sheet.name}
              type="button"
              role="tab"
              className="rdg-tab"
              aria-selected={sheet === active}
              tabIndex={sheet === active ? 0 : -1}
              title={sheet.name}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => select(sheet)}
              onDoubleClick={() => !readOnly && setRenaming(sheet)}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ sheet, x: e.clientX, y: e.clientY });
              }}
              onKeyDown={(e) => onKeyDown(e, sheet)}
            >
              {sheet.name}
            </button>
          ),
        )}
      </div>
      {menu !== null && (
        <Menu
          label={menu.sheet.name}
          testId="sheet-tab-menu"
          x={menu.x}
          y={menu.y}
          entries={menuEntries(menu.sheet)}
          onClose={() => setMenu(null)}
        />
      )}
      {deleting !== null && (
        <ConfirmDialog
          testId="delete-sheet-dialog"
          title={m.deleteSheetTitle(deleting.name)}
          body={m.deleteSheetBody}
          confirmLabel={m.deleteSheet}
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            workbook.deleteSheet(deleting);
            setDeleting(null);
            onAction?.();
          }}
        />
      )}
    </div>
  );
}

function RenameField({ workbook, sheet, onDone }: { workbook: Workbook; sheet: Spreadsheet; onDone: () => void }) {
  const m = useMessages();
  const [text, setText] = useState(sheet.name);
  const ref = useRef<HTMLInputElement>(null);
  const finished = useRef(false);
  const problem = workbook.nameProblem(text, sheet);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const finish = (commit: boolean): void => {
    if (finished.current) return;
    if (commit && problem === null) workbook.renameSheet(sheet, text);
    finished.current = true;
    onDone();
  };

  return (
    <input
      ref={ref}
      className="rdg-tab-input"
      aria-label={m.sheetName}
      aria-invalid={problem !== null}
      title={problem === null ? undefined : m.sheetNameProblem[problem]}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && problem === null) finish(true);
        else if (e.key === 'Escape') finish(false);
        e.stopPropagation();
      }}
    />
  );
}
