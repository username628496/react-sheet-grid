import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { columnLabel } from '../core/model/address';
import type { Spreadsheet } from '../core/Spreadsheet';

interface FilterDialogProps {
  sheet: Spreadsheet;
  viewCol: number;
  x: number;
  y: number;
  onClose: () => void;
}

const BLANK_LABEL = '(Blanks)';

/** "Filter by values": a checklist of the distinct values in a column. */
export function FilterDialog({ sheet, viewCol, x, y, onClose }: FilterDialogProps) {
  const { values, truncated } = useMemo(() => sheet.getDistinctValues(viewCol), [sheet, viewCol]);
  const [selected, setSelected] = useState<Set<string>>(() => {
    const current = sheet.viewState.filters.get(sheet.mapping.toDataCol(viewCol));
    return new Set(current ?? values.map((v) => v.text));
  });
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const shown = values.filter((v) => (v.text === '' ? BLANK_LABEL : v.text).toLowerCase().includes(query.toLowerCase()));

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

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={`Filter column ${columnLabel(sheet.mapping.toDataCol(viewCol))}`}
      data-testid="filter-dialog"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
        if (e.key === 'Enter' && e.target instanceof HTMLInputElement && e.target.type === 'search') apply();
      }}
      style={{
        position: 'fixed',
        left,
        top,
        zIndex: 1000,
        width: 280,
        padding: 12,
        background: '#fff',
        border: '1px solid #dadce0',
        borderRadius: 8,
        boxShadow: '0 2px 12px rgba(0,0,0,0.25)',
        fontFamily: 'Arial, sans-serif',
        fontSize: 13,
      }}
    >
      <div style={{ fontWeight: 'bold', marginBottom: 8 }}>
        Filter column {columnLabel(sheet.mapping.toDataCol(viewCol))} by values
      </div>
      <input
        type="search"
        autoFocus
        placeholder="Search"
        aria-label="Search values"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{ width: '100%', boxSizing: 'border-box', padding: 6, marginBottom: 8 }}
      />
      <div style={{ display: 'flex', gap: 12, marginBottom: 6 }}>
        <button type="button" onClick={() => setSelected(new Set([...selected, ...shown.map((v) => v.text)]))}>
          Select all
        </button>
        <button
          type="button"
          onClick={() => {
            const hide = new Set(shown.map((v) => v.text));
            setSelected(new Set([...selected].filter((t) => !hide.has(t))));
          }}
        >
          Clear
        </button>
      </div>
      <div style={{ maxHeight: 220, overflow: 'auto', border: '1px solid #eee', padding: 4 }}>
        {shown.length === 0 && <div style={{ color: '#5f6368', padding: 4 }}>No values</div>}
        {shown.map((v) => (
          <label key={v.text} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 2px', cursor: 'pointer' }}>
            <input type="checkbox" checked={selected.has(v.text)} onChange={() => toggle(v.text)} />
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {v.text === '' ? BLANK_LABEL : v.text}
            </span>
            <span style={{ color: '#5f6368' }}>{v.count}</span>
          </label>
        ))}
      </div>
      {truncated && (
        <div style={{ color: '#b06000', marginTop: 6 }}>Only the first {values.length} values are listed.</div>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
        <button type="button" onClick={apply} style={{ background: '#1a73e8', color: '#fff', border: 0, padding: '6px 14px', borderRadius: 4 }}>
          OK
        </button>
      </div>
    </div>,
    document.body,
  );
}
