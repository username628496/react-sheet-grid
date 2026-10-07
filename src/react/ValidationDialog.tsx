import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { columnLabel } from '../core/model/address';
import { formatDate, parseDateInput } from '../core/model/dates';
import { COMPARISONS, type Comparison, MAX_LIST_ITEMS, needsSecondBound, parseListItems, type Validation } from '../core/model/validation';
import type { Spreadsheet } from '../core/Spreadsheet';
import { ChromeStyles } from './chrome';
import { useMessages, useTheme } from './GridProvider';

interface ValidationDialogProps {
  sheet: Spreadsheet;
  onClose: () => void;
}

type Kind = Validation['kind'];

function boundText(kind: Kind, n: number | undefined): string {
  if (n === undefined) return '';
  return kind === 'date' ? formatDate(n, 'yyyy-mm-dd') : String(n);
}

/** Reads a bound field: a number, or for dates the ISO text a date input gives. */
function readBound(kind: Kind, text: string): number | null {
  if (text.trim() === '') return null;
  if (kind === 'date') {
    const parsed = parseDateInput(text.trim(), 'dmy');
    return parsed === null ? null : Math.floor(parsed.serial);
  }
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/** Sets the data validation rule of the selected cells (and removes it). */
export function ValidationDialog({ sheet, onClose }: ValidationDialogProps) {
  const m = useMessages();
  const theme = useTheme();
  const ref = useRef<HTMLDivElement>(null);
  const existing = sheet.styles.get(sheet.getCellByView(sheet.selection.activeRow, sheet.selection.activeCol).styleId).validation;
  const [kind, setKind] = useState<Kind>(existing?.kind ?? 'list');
  const [items, setItems] = useState(existing?.kind === 'list' ? existing.items.join('\n') : '');
  const [op, setOp] = useState<Comparison>(existing !== undefined && existing.kind !== 'list' ? existing.op : 'between');
  const [a, setA] = useState(existing !== undefined && existing.kind !== 'list' ? boundText(existing.kind, existing.a) : '');
  const [b, setB] = useState(existing !== undefined && existing.kind !== 'list' ? boundText(existing.kind, existing.b) : '');
  const [strict, setStrict] = useState(existing?.strict ?? true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('select')?.focus();
  }, []);

  const range = sheet.selection.primary;
  const rangeText =
    range.startRow === range.endRow && range.startCol === range.endCol
      ? `${columnLabel(range.startCol)}${range.startRow + 1}`
      : `${columnLabel(range.startCol)}${range.startRow + 1}:${columnLabel(range.endCol)}${range.endRow + 1}`;

  const save = (): void => {
    if (kind === 'list') {
      const list = parseListItems(items);
      if (list.length === 0) {
        setError(m.validationNoItems);
        return;
      }
      sheet.setValidation({ kind: 'list', items: list, strict });
    } else {
      const first = readBound(kind, a);
      const second = needsSecondBound(op) ? readBound(kind, b) : undefined;
      if (first === null || second === null) {
        setError(m.validationBadValue);
        return;
      }
      sheet.setValidation(second === undefined ? { kind, op, a: first, strict } : { kind, op, a: first, b: second, strict });
    }
    onClose();
  };

  const field = (value: string, set: (v: string) => void, label: string) => (
    <input
      className="rdg-search"
      style={{ marginBottom: 0 }}
      type={kind === 'date' ? 'date' : 'text'}
      inputMode={kind === 'number' ? 'decimal' : undefined}
      aria-label={label}
      value={value}
      onChange={(e) => {
        set(e.target.value);
        setError(null);
      }}
    />
  );

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={m.dataValidation}
      data-testid="validation-dialog"
      data-rdg-theme={theme}
      className="rdg-chrome rdg-popup rdg-dialog"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
        if (e.key === 'Enter' && e.target instanceof HTMLInputElement) save();
      }}
      style={{ left: '50%', top: '18%', transform: 'translateX(-50%)', width: 340 }}
    >
      <ChromeStyles />
      <div style={{ fontWeight: 600 }}>{m.dataValidation}</div>
      <div className="rdg-muted" style={{ margin: '2px 0 10px' }}>{m.validationApplyTo(rangeText)}</div>
      <label style={{ display: 'block', marginBottom: 8 }}>
        <div className="rdg-muted">{m.validationCriteria}</div>
        <select className="rdg-select" style={{ width: '100%' }} value={kind} onChange={(e) => { setKind(e.target.value as Kind); setError(null); }}>
          <option value="list">{m.validationList}</option>
          <option value="number">{m.validationNumber}</option>
          <option value="date">{m.validationDate}</option>
        </select>
      </label>
      {kind === 'list' ? (
        <label style={{ display: 'block', marginBottom: 8 }}>
          <div className="rdg-muted">{m.validationItemsHint} ({MAX_LIST_ITEMS} max)</div>
          <textarea
            className="rdg-search"
            style={{ height: 90, resize: 'vertical' }}
            aria-label={m.validationItems}
            value={items}
            onChange={(e) => { setItems(e.target.value); setError(null); }}
          />
        </label>
      ) : (
        <div style={{ display: 'grid', gap: 8, marginBottom: 8 }}>
          <select className="rdg-select" aria-label={m.validationCriteria + ' 2'} value={op} onChange={(e) => setOp(e.target.value as Comparison)}>
            {COMPARISONS.map((c) => (
              <option key={c} value={c}>{m.validationComparison[c]}</option>
            ))}
          </select>
          {field(a, setA, m.validationValue)}
          {needsSecondBound(op) && field(b, setB, m.validationValue + ' ' + m.validationValueTo)}
        </div>
      )}
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '4px 0' }}>
        <input type="radio" name="rdg-validation-mode" checked={strict} onChange={() => setStrict(true)} />
        {m.validationReject}
      </label>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '4px 0 8px' }}>
        <input type="radio" name="rdg-validation-mode" checked={!strict} onChange={() => setStrict(false)} />
        {m.validationWarn}
      </label>
      {error !== null && <div role="alert" style={{ color: 'var(--rdg-notice-text)', marginBottom: 8 }}>{error}</div>}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 8 }}>
        <button
          type="button"
          className="rdg-textbtn"
          onClick={() => {
            sheet.setValidation(null);
            onClose();
          }}
        >
          {m.validationRemove}
        </button>
        <span style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="rdg-textbtn" onClick={onClose}>{m.cancel}</button>
          <button type="button" className="rdg-textbtn rdg-primary" onClick={save}>{m.validationSave}</button>
        </span>
      </div>
    </div>,
    document.body,
  );
}
