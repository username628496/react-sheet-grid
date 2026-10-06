import { useEffect, useRef, type CSSProperties } from 'react';
import type { Spreadsheet } from '../core/Spreadsheet';
import { GridSurface } from '../render/GridSurface';

export interface DataGridProps {
  sheet: Spreadsheet;
  frozenRows?: number;
  frozenCols?: number;
  className?: string;
  style?: CSSProperties;
}

/**
 * Thin React shell. No cell data or scroll position goes through React state:
 * the surface draws imperatively and React only mounts/unmounts it.
 */
export function DataGrid({ sheet, frozenRows = 0, frozenCols = 0, className, style }: DataGridProps) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (mount === null) return;
    const surface = new GridSurface(mount, sheet, { frozenRows, frozenCols });
    return () => surface.destroy();
  }, [sheet, frozenRows, frozenCols]);

  return <div ref={mountRef} className={className} style={{ width: '100%', height: '100%', ...style }} data-testid="grid" />;
}
