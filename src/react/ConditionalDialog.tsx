import { type ReactElement, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { columnLabel } from '../core/model/address';
import { type Condition, type ConditionalRule, MAX_CONDITIONAL_RULES, TEXT_OPS, type TextOp } from '../core/model/conditional';
import { formatDate, parseDateInput } from '../core/model/dates';
import { COMPARISONS, type Comparison, needsSecondBound } from '../core/model/validation';
import type { Spreadsheet } from '../core/Spreadsheet';
import { ChromeStyles } from './chrome';
import { useMessages, useTheme } from './GridProvider';

interface ConditionalDialogProps {
  sheet: Spreadsheet;
  onClose: () => void;
}

/** "text:contains", "number:gt", "date:between", "blank", "notBlank": one select value that picks the kind and operator. */
type Choice = string;

interface Draft {
  key: number;
  choice: Choice;
  a: string;
  b: string;
  color: string | null;
  background: string | null;
}

const DEFAULT_BACKGROUND = '#f4c7c3';
let nextKey = 1;

function toDraft(rule: ConditionalRule): Draft {
  const w = rule.when;
  const bound = (n: number | undefined): string => (n === undefined ? '' : w.kind === 'date' ? formatDate(n, 'yyyy-mm-dd') : String(n));
  const base = { key: nextKey++, color: rule.color ?? null, background: rule.background ?? null };
  if (w.kind === 'text') return { ...base, choice: `text:${w.op}`, a: w.text, b: '' };
  if (w.kind === 'number' || w.kind === 'date') return { ...base, choice: `${w.kind}:${w.op}`, a: bound(w.a), b: bound(w.b) };
  return { ...base, choice: w.kind, a: '', b: '' };
}

function bound(kind: 'number' | 'date', text: string): number | null {
  if (text.trim() === '') return null;
  if (kind === 'date') {
    const p = parseDateInput(text.trim(), 'dmy');
    return p === null ? null : Math.floor(p.serial);
  }
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/** Null when the draft is incomplete (a missing number). */
function toRule(d: Draft): ConditionalRule | null {
  const [kind, op] = d.choice.split(':') as [string, string | undefined];
  let when: Condition;
  if (kind === 'text') {
    if (d.a === '') return null;
    when = { kind: 'text', op: op as TextOp, text: d.a };
  } else if (kind === 'number' || kind === 'date') {
    const a = bound(kind, d.a);
    const b = needsSecondBound(op as Comparison) ? bound(kind, d.b) : undefined;
    if (a === null || b === null) return null;
    when = b === undefined ? { kind, op: op as Comparison, a } : { kind, op: op as Comparison, a, b };
  } else {
    when = { kind: kind as 'blank' | 'notBlank' };
  }
  const rule: { when: Condition; color?: string; background?: string } = { when };
  if (d.color !== null) rule.color = d.color;
  if (d.background !== null) rule.background = d.background;
  return rule;
}

/** Edits the list of conditional formatting rules of the selected cells (replacing what they had). */
export function ConditionalDialog({ sheet, onClose }: ConditionalDialogProps) {
  const m = useMessages();
  const theme = useTheme();
  const ref = useRef<HTMLDivElement>(null);
  const existing = sheet.styles.get(sheet.getCellByView(sheet.selection.activeRow, sheet.selection.activeCol).styleId).conditional ?? [];
  const [drafts, setDrafts] = useState<Draft[]>(() => existing.map(toDraft));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('button')?.focus();
  }, []);

  const range = sheet.selection.primary;
  const rangeText =
    range.startRow === range.endRow && range.startCol === range.endCol
      ? `${columnLabel(range.startCol)}${range.startRow + 1}`
      : `${columnLabel(range.startCol)}${range.startRow + 1}:${columnLabel(range.endCol)}${range.endRow + 1}`;

  const update = (key: number, patch: Partial<Draft>): void => {
    setDrafts((list) => list.map((d) => (d.key === key ? { ...d, ...patch } : d)));
    setError(null);
  };

  const save = (): void => {
    const rules: ConditionalRule[] = [];
    for (const d of drafts) {
      const rule = toRule(d);
      if (rule === null) {
        setError(m.validationBadValue);
        return;
      }
      rules.push(rule);
    }
    sheet.setConditionalRules(rules);
    onClose();
  };

  const choiceOptions = (kind: 'number' | 'date'): ReactElement[] =>
    COMPARISONS.map((c) => (
      <option key={`${kind}:${c}`} value={`${kind}:${c}`}>
        {(kind === 'number' ? m.validationNumber : m.validationDate) + ' ' + m.validationComparison[c]}
      </option>
    ));

  const colorPick = (d: Draft, field: 'color' | 'background', label: string, fallback: string) => (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <input type="checkbox" checked={d[field] !== null} onChange={(e) => update(d.key, { [field]: e.target.checked ? fallback : null })} />
      {label}
      <input type="color" aria-label={label} disabled={d[field] === null} value={d[field] ?? fallback} onChange={(e) => update(d.key, { [field]: e.target.value })} />
    </label>
  );

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={m.conditionalFormatting}
      data-testid="conditional-dialog"
      data-rdg-theme={theme}
      className="rdg-chrome rdg-popup rdg-dialog"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
      style={{ left: '50%', top: '12%', transform: 'translateX(-50%)', width: 420, maxHeight: '76vh', overflow: 'auto' }}
    >
      <ChromeStyles />
      <div style={{ fontWeight: 600 }}>{m.conditionalFormatting}</div>
      <div className="rdg-muted" style={{ margin: '2px 0 10px' }}>{m.validationApplyTo(rangeText)}</div>
      {drafts.length === 0 && <div className="rdg-muted" style={{ marginBottom: 8 }}>{m.cfNoRules}</div>}
      {drafts.map((d, i) => {
        const [kind, op] = d.choice.split(':') as [string, string | undefined];
        const hasValue = kind === 'text' || kind === 'number' || kind === 'date';
        const type = kind === 'date' ? 'date' : 'text';
        return (
          <fieldset key={d.key} style={{ border: '1px solid var(--rdg-border)', borderRadius: 6, margin: '0 0 8px', padding: 8, display: 'grid', gap: 6 }} aria-label={`${m.conditionalFormatting} ${i + 1}`}>
            <select className="rdg-select" aria-label={m.validationCriteria} value={d.choice} onChange={(e) => update(d.key, { choice: e.target.value })}>
              {TEXT_OPS.map((t) => (
                <option key={t} value={`text:${t}`}>{m.cfText[t]}</option>
              ))}
              {choiceOptions('number')}
              {choiceOptions('date')}
              <option value="blank">{m.cfBlank}</option>
              <option value="notBlank">{m.cfNotBlank}</option>
            </select>
            {hasValue && (
              <input className="rdg-search" style={{ marginBottom: 0 }} type={type} aria-label={m.validationValue} value={d.a} onChange={(e) => update(d.key, { a: e.target.value })} />
            )}
            {hasValue && op !== undefined && needsSecondBound(op as Comparison) && (
              <input className="rdg-search" style={{ marginBottom: 0 }} type={type} aria-label={`${m.validationValue} ${m.validationValueTo}`} value={d.b} onChange={(e) => update(d.key, { b: e.target.value })} />
            )}
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              {colorPick(d, 'background', m.cfBackground, DEFAULT_BACKGROUND)}
              {colorPick(d, 'color', m.cfTextColor, '#b31412')}
              <button type="button" className="rdg-textbtn" style={{ marginLeft: 'auto' }} onClick={() => setDrafts((list) => list.filter((x) => x.key !== d.key))}>
                {m.cfRemoveRule}
              </button>
            </div>
          </fieldset>
        );
      })}
      {error !== null && <div role="alert" style={{ color: 'var(--rdg-notice-text)', marginBottom: 8 }}>{error}</div>}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 8 }}>
        <button
          type="button"
          className="rdg-textbtn"
          disabled={drafts.length >= MAX_CONDITIONAL_RULES}
          onClick={() => setDrafts((list) => [...list, { key: nextKey++, choice: 'text:contains', a: '', b: '', color: null, background: DEFAULT_BACKGROUND }])}
        >
          {m.cfAddRule}
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
