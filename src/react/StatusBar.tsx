import { useEffect, useState } from 'react';
import { formatNumber } from '../core/model/format';
import type { SelectionStats, Spreadsheet } from '../core/Spreadsheet';
import { ChromeStyles } from './chrome';
import { useMessages, useTheme } from './GridProvider';

/**
 * Sum / average / count of the selected numbers, shown when more than one cell is selected.
 * Recomputed at most once per animation frame: dragging a selection fires change events far
 * faster than the bar needs to update.
 */
export function StatusBar({ sheet }: { sheet: Spreadsheet }) {
  const m = useMessages();
  const theme = useTheme();
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
    <div role="status" aria-label={m.selectionSummary} data-rdg-theme={theme} className="rdg-chrome rdg-statusbar" data-testid="status-bar">
      <ChromeStyles />
      {stats === null ? (
        <span>&nbsp;</span>
      ) : (
        <>
          <span>
            {m.sum}: <b data-testid="stat-sum">{formatNumber(stats.sum, undefined)}</b>
          </span>
          <span>
            {m.average}: <b data-testid="stat-average">{formatNumber(stats.average, undefined)}</b>
          </span>
          <span>
            {m.count}: <b data-testid="stat-count">{stats.count}</b>
          </span>
        </>
      )}
    </div>
  );
}
