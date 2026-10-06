import { type CSSProperties, useEffect, useRef } from 'react';
import type { Spreadsheet } from '../core/Spreadsheet';
import { GridController } from '../input/GridController';
import { GridSurface } from '../render/GridSurface';
import { CellEditor } from './CellEditor';

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

  useEffect(() => {
    const mount = mountRef.current;
    const textarea = editorRef.current;
    if (mount === null || textarea === null) return;
    const surface = new GridSurface(mount, sheet, { frozenRows, frozenCols });
    const controller = new GridController(surface, sheet, textarea);
    onReady?.(controller);
    return () => {
      controller.destroy();
      surface.destroy();
    };
    // onReady is intentionally not a dependency: a new callback identity must not rebuild the grid.
  }, [sheet, frozenRows, frozenCols]);

  return (
    <div ref={mountRef} className={className} style={{ width: '100%', height: '100%', ...style }} data-testid="grid">
      <CellEditor ref={editorRef} />
    </div>
  );
}
