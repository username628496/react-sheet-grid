import { useEffect, useState } from 'react';
import { formatNumber } from '../core/model/format';
import type { SelectionStats, Spreadsheet } from '../core/Spreadsheet';

const barStyle = {
  display: 'flex',
  gap: 16,
  alignItems: 'center',
  minHeight: 26,
  padding: '0 12px',
  borderTop: '1px solid #dadce0',
  background: '#f8f9fa',
  fontFamily: 'Arial, sans-serif',
  fontSize: 12,
  color: '#444746',
} as const;

/**
 * Sum / average / count of the selected numbers, shown when more than one cell is selected.
 * Recomputed at most once per animation frame: dragging a selection fires change events far
 * faster than the bar needs to update.
 */
export function StatusBar({ sheet }: { sheet: Spreadsheet }) {
  const [stats, setStats] = useState<SelectionStats | null>(null);

  useEffect(() => {
    let frame = 0;
    const update = (): void => {
      frame = 0;
      setStats(sheet.selection.isSingleCell() ? null : sheet.getSelectionStats());
    };
    const schedule = (): void => {
      if (frame === 0) frame = requestAnimationFrame(update);
    };
    update();
    const off = sheet.subscribe(schedule);
    return () => {
      off();
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [sheet]);

  return (
    <div role="status" aria-label="Selection summary" style={barStyle} data-testid="status-bar">
      {stats === null ? (
        <span style={{ color: '#80868b' }}>&nbsp;</span>
      ) : (
        <>
          <span>
            Sum: <b data-testid="stat-sum">{formatNumber(stats.sum, undefined)}</b>
          </span>
          <span>
            Average: <b data-testid="stat-average">{formatNumber(stats.average, undefined)}</b>
          </span>
          <span>
            Count: <b data-testid="stat-count">{stats.count}</b>
          </span>
        </>
      )}
    </div>
  );
}
