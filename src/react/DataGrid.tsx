import { type CSSProperties, useCallback, useEffect, useId, useRef, useState } from 'react';
import { formatValue } from '../core/model/format';
import type { Spreadsheet } from '../core/Spreadsheet';
import { GridController } from '../input/GridController';
import { GridSurface } from '../render/GridSurface';
import { applyCanvasTheme } from '../render/theme';
import { CellEditor } from './CellEditor';
import { describeEditing, describeSelection } from './a11y';
import { ChromeStyles } from './chrome';
import { useMessages, useTheme } from './GridProvider';
import { ContextMenu } from './ContextMenu';
import { FilterDialog } from './FilterDialog';
import { Menu, type MenuEntry } from './Menu';
import { ConditionalDialog } from './ConditionalDialog';
import { ValidationDialog } from './ValidationDialog';
import { FindDialog } from './FindDialog';
import { ShortcutsDialog } from './ShortcutsDialog';

export interface DataGridProps {
  sheet: Spreadsheet;
  /** Initial frozen panes. They live in the sheet afterwards (and can be changed from the toolbar). */
  frozenRows?: number;
  frozenCols?: number;
  className?: string;
  style?: CSSProperties;
  /** Gives the host app access to the imperative controller (scrolling, focus, editor state). */
  /** Zoom factor, 0.5 to 2 (1 = 100%). Changes made from the toolbar are reported through `onZoomChange`. */
  zoom?: number;
  onZoomChange?: (zoom: number) => void;
  onReady?: (controller: GridController) => void;
}

/**
 * Thin React shell. No cell data or scroll position goes through React state:
 * the surface draws imperatively and React only mounts/unmounts it.
 */
export function DataGrid({ sheet, frozenRows, frozenCols, className, style, zoom, onZoomChange, onReady }: DataGridProps) {
  const zoomCallback = useRef(onZoomChange);
  zoomCallback.current = onZoomChange;
  const mountRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const colorTheme = useTheme();
  const m = useMessages();
  const hintId = useId();
  const [announcement, setAnnouncement] = useState('');
  const [controller, setController] = useState<GridController | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [filter, setFilter] = useState<{ col: number; x: number; y: number } | null>(null);
  const [help, setHelp] = useState(false);
  const [list, setList] = useState<{ row: number; col: number; x: number; y: number } | null>(null);
  const [validation, setValidation] = useState(false);
  const [conditional, setConditional] = useState(false);
  const [find, setFind] = useState<{ anchor: DOMRect; token: number } | null>(null);
  const closeHelp = useCallback(() => {
    setHelp(false);
    editorRef.current?.focus({ preventScroll: true });
  }, []);
  const closeMenu = useCallback(() => setMenu(null), []);
  const closeFilter = useCallback(() => {
    setFilter(null);
    editorRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (controller === null) return;
    if (zoom !== undefined) controller.surface.setZoom(zoom);
    return controller.surface.subscribeZoom((z) => zoomCallback.current?.(z));
  }, [controller, zoom]);

  // The canvas reads its colors from a shared palette; switching it needs a repaint and a restyled editor box.
  useEffect(() => {
    applyCanvasTheme(colorTheme);
    controller?.surface.invalidate();
    controller?.editor.reposition();
  }, [colorTheme, controller]);

  // Tell assistive technology what the canvas shows: the active cell (or the selection) after each change, and when an
  // edit starts. Debounced so holding an arrow key speaks the cell you land on, not every cell you pass.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let key = '';
    let wasEditing = false;
    const update = (): void => {
      const editing = controller?.editor.editing === true;
      const { activeRow, activeCol, primary } = sheet.selection;
      // The cell's text is part of the key: undo, a sort or data arriving changes what the active cell holds without moving
      // the selection, and that has to be heard too.
      const content = editing ? '' : sheet.getDisplayText(activeRow, activeCol);
      const next = `${activeRow},${activeCol},${primary.startRow},${primary.startCol},${primary.endRow},${primary.endCol},${editing},${content}`;
      if (next === key) return; // typed text, scrolling and other notifications do not change what to say
      key = next;
      const startedEditing = editing && !wasEditing;
      wasEditing = editing;
      clearTimeout(timer);
      if (editing && !startedEditing) return;
      timer = setTimeout(() => setAnnouncement(editing ? describeEditing(sheet, m) : describeSelection(sheet, m)), 60);
    };
    update();
    const off = sheet.subscribe(update);
    return () => {
      off();
      clearTimeout(timer);
    };
  }, [sheet, controller, m]);

  useEffect(() => {
    const mount = mountRef.current;
    const textarea = editorRef.current;
    if (mount === null || textarea === null) return;
    const surface = new GridSurface(mount, sheet, { frozenRows, frozenCols });
    const ctrl = new GridController(surface, sheet, textarea);
    ctrl.mouse.onContext = (x, y) => setMenu({ x, y });
    ctrl.onShowShortcuts = () => setHelp(true);
    ctrl.onOpenFilter = (col, x, y) => setFilter({ col, x, y });
    ctrl.onOpenValidation = () => setValidation(true);
    ctrl.onOpenConditional = () => setConditional(true);
    ctrl.onOpenList = (row, col) => {
      if (sheet.readOnly || sheet.styles.get(sheet.getCellByView(row, col).styleId).validation?.kind !== 'list') return;
      ctrl.editor.commit();
      ctrl.surface.scrollCellIntoView(row, col);
      const rect = mount.getBoundingClientRect();
      const z = ctrl.surface.zoom;
      const vp = ctrl.surface.viewport;
      setList({ row, col, x: rect.left + vp.colLeft(col) * z, y: rect.top + (vp.rowTop(row) + sheet.rows.getSize(row)) * z });
    };
    ctrl.onOpenFind = (replace) => {
      ctrl.find.show(replace);
      setFind((current) => ({ anchor: mount.getBoundingClientRect(), token: (current?.token ?? 0) + 1 }));
    };
    setController(ctrl);
    onReady?.(ctrl);
    return () => {
      ctrl.destroy();
      surface.destroy();
      setController(null);
      setMenu(null);
      setFind(null);
      setList(null);
      setValidation(false);
      setConditional(false);
    };
    // onReady is intentionally not a dependency: a new callback identity must not rebuild the grid.
  }, [sheet, frozenRows, frozenCols]);

  return (
    <>
      <ChromeStyles />
      <div
        ref={mountRef}
        className={className}
        style={{ width: '100%', height: '100%', ...style }}
        data-testid="grid"
        role="application"
        aria-roledescription={m.a11yRoleDescription}
        aria-label={m.a11yLabel}
        aria-describedby={hintId}
      >
        <CellEditor ref={editorRef} label={m.a11yEditorLabel} />
        <span id={hintId} className="rdg-chrome rdg-sr-only">
          {m.a11yHint}
        </span>
        <div className="rdg-chrome rdg-sr-only" aria-live="polite" aria-atomic="true" data-testid="grid-announcer">
          {announcement}
        </div>
      </div>
      {controller !== null && menu !== null && (
        <ContextMenu
          controller={controller}
          x={menu.x}
          y={menu.y}
          onClose={closeMenu}
          onFilter={(col, x, y) => setFilter({ col, x, y })}
        />
      )}
      {controller !== null && find !== null && (
        <FindDialog
          controller={controller}
          anchor={find.anchor}
          focusToken={find.token}
          onClose={() => {
            controller.find.hide();
            setFind(null);
          }}
        />
      )}
      {list !== null && (
        <Menu
          label={m.validationList}
          testId="list-menu"
          x={list.x}
          y={list.y}
          entries={listEntries(sheet, list.row, list.col)}
          onClose={() => {
            setList(null);
            editorRef.current?.focus({ preventScroll: true });
          }}
        />
      )}
      {validation && (
        <ValidationDialog
          sheet={sheet}
          onClose={() => {
            setValidation(false);
            editorRef.current?.focus({ preventScroll: true });
          }}
        />
      )}
      {conditional && (
        <ConditionalDialog
          sheet={sheet}
          onClose={() => {
            setConditional(false);
            editorRef.current?.focus({ preventScroll: true });
          }}
        />
      )}
      {help && <ShortcutsDialog onClose={closeHelp} />}
      {filter !== null && <FilterDialog sheet={sheet} viewCol={filter.col} x={filter.x} y={filter.y} onClose={closeFilter} />}
    </>
  );
}

/** The choices of a list cell; the one the cell holds is marked. */
function listEntries(sheet: Spreadsheet, viewRow: number, viewCol: number): MenuEntry[] {
  const cell = sheet.getCellByView(viewRow, viewCol);
  const rule = sheet.styles.get(cell.styleId).validation;
  if (rule?.kind !== 'list') return [];
  const current = formatValue(cell.value);
  return rule.items.map((item) => ({ label: item, checked: item === current, run: () => void sheet.setCellInput(viewRow, viewCol, item) }));
}
