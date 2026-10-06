import { type CSSProperties, useCallback, useEffect, useRef, useState } from 'react';
import type { Spreadsheet } from '../core/Spreadsheet';
import { GridController } from '../input/GridController';
import { GridSurface } from '../render/GridSurface';
import { applyCanvasTheme } from '../render/theme';
import { CellEditor } from './CellEditor';
import { ChromeStyles } from './chrome';
import { useTheme } from './GridProvider';
import { ContextMenu } from './ContextMenu';
import { FilterDialog } from './FilterDialog';
import { ShortcutsDialog } from './ShortcutsDialog';

export interface DataGridProps {
  sheet: Spreadsheet;
  frozenRows?: number;
  frozenCols?: number;
  className?: string;
  style?: CSSProperties;
  /** Gives the host app access to the imperative controller (scrolling, focus, editor state). */
  onReady?: (controller: GridController) => void;
}

/**
 * Thin React shell. No cell data or scroll position goes through React state:
 * the surface draws imperatively and React only mounts/unmounts it.
 */
export function DataGrid({ sheet, frozenRows = 0, frozenCols = 0, className, style, onReady }: DataGridProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const colorTheme = useTheme();
  const [controller, setController] = useState<GridController | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [filter, setFilter] = useState<{ col: number; x: number; y: number } | null>(null);
  const [help, setHelp] = useState(false);
  const closeHelp = useCallback(() => {
    setHelp(false);
    editorRef.current?.focus({ preventScroll: true });
  }, []);
  const closeMenu = useCallback(() => setMenu(null), []);
  const closeFilter = useCallback(() => {
    setFilter(null);
    editorRef.current?.focus({ preventScroll: true });
  }, []);

  // The canvas reads its colors from a shared palette; switching it needs a repaint and a restyled editor box.
  useEffect(() => {
    applyCanvasTheme(colorTheme);
    controller?.surface.invalidate();
    controller?.editor.reposition();
  }, [colorTheme, controller]);

  // Frozen rows act as the header: sort and filter leave them alone.
  useEffect(() => {
    sheet.headerRows = frozenRows;
  }, [sheet, frozenRows]);

  useEffect(() => {
    const mount = mountRef.current;
    const textarea = editorRef.current;
    if (mount === null || textarea === null) return;
    const surface = new GridSurface(mount, sheet, { frozenRows, frozenCols });
    const ctrl = new GridController(surface, sheet, textarea);
    ctrl.mouse.onContext = (x, y) => setMenu({ x, y });
    ctrl.onShowShortcuts = () => setHelp(true);
    setController(ctrl);
    onReady?.(ctrl);
    return () => {
      ctrl.destroy();
      surface.destroy();
      setController(null);
      setMenu(null);
    };
    // onReady is intentionally not a dependency: a new callback identity must not rebuild the grid.
  }, [sheet, frozenRows, frozenCols]);

  return (
    <>
      <ChromeStyles />
      <div ref={mountRef} className={className} style={{ width: '100%', height: '100%', ...style }} data-testid="grid">
        <CellEditor ref={editorRef} />
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
      {help && <ShortcutsDialog onClose={closeHelp} />}
      {filter !== null && <FilterDialog sheet={sheet} viewCol={filter.col} x={filter.x} y={filter.y} onClose={closeFilter} />}
    </>
  );
}
