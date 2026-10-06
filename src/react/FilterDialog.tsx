import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { columnLabel } from '../core/model/address';
import type { Spreadsheet } from '../core/Spreadsheet';
import { ChromeStyles } from './chrome';
import { useMessages, useTheme } from './GridProvider';

interface FilterDialogProps {
  sheet: Spreadsheet;
  viewCol: number;
  x: number;
  y: number;
  onClose: () => void;
}

/** "Filter by values": a checklist of the distinct values in a column. */
export function FilterDialog({ sheet, viewCol, x, y, onClose }: FilterDialogProps) {
  const m = useMessages();
  const theme = useTheme();
  const { values, truncated } = useMemo(() => sheet.getDistinctValues(viewCol), [sheet, viewCol]);
  const [selected, setSelected] = useState<Set<string>>(() => {
    const current = sheet.viewState.filters.get(sheet.mapping.toDataCol(viewCol));
    return new Set(current ?? values.map((v) => v.text));
  });
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const shown = values.filter((v) => (v.text === '' ? m.blanks : v.text).toLowerCase().includes(query.toLowerCase()));

  useEffect(() => {
    const close = (e: Event): void => {
      if (ref.current !== null && e.target instanceof Node && ref.current.contains(e.target)) return;
      onClose();
    };
    window.addEventListener('mousedown', close, true);
    return () => window.removeEventListener('mousedown', close, true);
  }, [onClose]);

  const toggle = (text: string): void => {
    const next = new Set(selected);
    if (next.has(text)) next.delete(text);
    else next.add(text);
    setSelected(next);
  };

  const apply = (): void => {
    onClose();
    const everything = values.every((v) => selected.has(v.text)) && !truncated;
    sheet.setColumnFilter(viewCol, everything ? null : selected);
  };

  const left = Math.max(4, Math.min(x, window.innerWidth - 300));
  const top = Math.max(4, Math.min(y, window.innerHeight - 380));

  const colName = columnLabel(sheet.mapping.toDataCol(viewCol));
  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={m.filterTitle(colName)}
      data-testid="filter-dialog"
      data-rdg-theme={theme}
      className="rdg-chrome rdg-popup rdg-dialog"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
        if (e.key === 'Enter' && e.target instanceof HTMLInputElement && e.target.type === 'search') apply();
      }}
      style={{ left, top, width: 280 }}
    >
      <ChromeStyles />
      <div style={{ fontWeight: 600, marginBottom: 8 }}>{m.filterTitle(colName)}</div>
      <input
        type="search"
        autoFocus
        className="rdg-search"
        placeholder={m.search}
        aria-label={m.searchValues}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <button type="button" className="rdg-textbtn" onClick={() => setSelected(new Set([...selected, ...shown.map((v) => v.text)]))}>
          {m.selectAll}
        </button>
        <button
          type="button"
          className="rdg-textbtn"
          onClick={() => {
            const hide = new Set(shown.map((v) => v.text));
            setSelected(new Set([...selected].filter((t) => !hide.has(t))));
          }}
        >
          {m.clear}
        </button>
      </div>
      <div className="rdg-list">
        {shown.length === 0 && <div className="rdg-muted" style={{ padding: 4 }}>{m.noValues}</div>}
        {shown.map((v) => (
          <label key={v.text} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 2px', cursor: 'pointer' }}>
            <input type="checkbox" checked={selected.has(v.text)} onChange={() => toggle(v.text)} />
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {v.text === '' ? m.blanks : v.text}
            </span>
            <span className="rdg-muted">{v.count}</span>
          </label>
        ))}
      </div>
      {truncated && <div style={{ color: 'var(--rdg-notice-text)', marginTop: 6 }}>{m.onlyFirstValues(values.length)}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
        <button type="button" className="rdg-textbtn" onClick={onClose}>
          {m.cancel}
        </button>
        <button type="button" className="rdg-textbtn rdg-primary" onClick={apply}>
          {m.ok}
        </button>
      </div>
    </div>,
    document.body,
  );
}
