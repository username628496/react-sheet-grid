import { type CSSProperties, type ReactNode, useEffect, useRef, useSyncExternalStore } from 'react';
import type { Spreadsheet } from '../core/Spreadsheet';
import type { HorizontalAlign, Style } from '../core/model/StyleTable';

const NUMBER_FORMAT_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '', label: 'Automatic' },
  { value: '0', label: 'Number (1235)' },
  { value: '0.00', label: 'Number (1234.57)' },
  { value: '#,##0', label: 'Number (1,235)' },
  { value: '#,##0.00', label: 'Number (1,234.57)' },
  { value: '0%', label: 'Percent (26%)' },
  { value: '0.00%', label: 'Percent (25.67%)' },
  { value: '$#,##0.00', label: 'Currency ($1,234.57)' },
];

const barStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  padding: '4px 8px',
  borderBottom: '1px solid #dadce0',
  background: '#f8f9fa',
  fontFamily: 'Arial, sans-serif',
  fontSize: 13,
  flexWrap: 'wrap',
};

function buttonStyle(active: boolean, disabled = false): CSSProperties {
  return {
    minWidth: 28,
    height: 28,
    border: '1px solid transparent',
    borderRadius: 4,
    background: active ? '#d3e3fd' : 'transparent',
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.4 : 1,
    fontSize: 14,
  };
}

// Reading from the sheet through one string keeps useSyncExternalStore's snapshot comparison trivial and stable.
function snapshot(sheet: Spreadsheet): string {
  const { selection, history } = sheet;
  const style = sheet.styles.get(sheet.getCellByView(selection.activeRow, selection.activeCol).styleId);
  return JSON.stringify([history.canUndo, history.canRedo, style]);
}

function parse(s: string): { canUndo: boolean; canRedo: boolean; style: Style } {
  const [canUndo, canRedo, style] = JSON.parse(s) as [boolean, boolean, Style];
  return { canUndo, canRedo, style };
}

interface ToolbarProps {
  sheet: Spreadsheet;
  /** Called after an action so the host can hand keyboard focus back to the grid. */
  onAction?: () => void;
}

/**
 * Formatting toolbar. Buttons cancel the default mousedown so the grid's hidden
 * textarea keeps focus (and an in-progress edit is not committed by a blur).
 */
export function Toolbar({ sheet, onAction }: ToolbarProps) {
  const raw = useSyncExternalStore(
    (listener) => sheet.subscribe(listener),
    () => snapshot(sheet),
  );
  const { canUndo, canRedo, style } = parse(raw);
  const keepFocus = (e: { preventDefault(): void }): void => e.preventDefault();
  const run = (fn: () => void): void => {
    fn();
    onAction?.();
  };
  const align = (a: HorizontalAlign): void => run(() => sheet.formatSelection({ align: a }, 'Align'));

  const button = (label: string, title: string, active: boolean, onClick: () => void, disabled = false, extra?: CSSProperties): ReactNode => (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={keepFocus}
      onClick={() => run(onClick)}
      style={{ ...buttonStyle(active, disabled), ...extra }}
    >
      {label}
    </button>
  );

  return (
    <div role="toolbar" aria-label="Formatting" style={barStyle} data-testid="toolbar">
      {button('↶', 'Undo', false, () => sheet.undo(), !canUndo)}
      {button('↷', 'Redo', false, () => sheet.redo(), !canRedo)}
      <Separator />
      {button('B', 'Bold', style.bold === true, () => sheet.toggleStyle('bold'), false, { fontWeight: 'bold' })}
      {button('I', 'Italic', style.italic === true, () => sheet.toggleStyle('italic'), false, { fontStyle: 'italic' })}
      {button('U', 'Underline', style.underline === true, () => sheet.toggleStyle('underline'), false, { textDecoration: 'underline' })}
      {button('S', 'Strikethrough', style.strike === true, () => sheet.toggleStyle('strike'), false, { textDecoration: 'line-through' })}
      <ColorButton
        label="A"
        title="Text color"
        value={style.color ?? '#1f1f1f'}
        active={style.color !== undefined}
        onPick={(color) => run(() => sheet.formatSelection({ color }, 'Text color'))}
        onClear={() => run(() => sheet.formatSelection({ color: undefined }, 'Text color'))}
        underline
      />
      <ColorButton
        label="▦"
        title="Fill color"
        value={style.background ?? '#ffffff'}
        active={style.background !== undefined}
        onPick={(background) => run(() => sheet.formatSelection({ background }, 'Fill color'))}
        onClear={() => run(() => sheet.formatSelection({ background: undefined }, 'Fill color'))}
      />
      <Separator />
      {button('⇤', 'Align left', style.align === 'left', () => align('left'))}
      {button('↔', 'Align center', style.align === 'center', () => align('center'))}
      {button('⇥', 'Align right', style.align === 'right', () => align('right'))}
      <Separator />
      <select
        aria-label="Number format"
        title="Number format"
        value={style.numberFormat ?? ''}
        onMouseDown={(e) => e.stopPropagation()}
        onChange={(e) => {
          const numberFormat = e.target.value === '' ? undefined : e.target.value;
          run(() => sheet.formatSelection({ numberFormat }, 'Number format'));
        }}
        style={{ height: 28 }}
      >
        {NUMBER_FORMAT_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function Separator() {
  return <span aria-hidden style={{ width: 1, height: 20, background: '#dadce0', margin: '0 4px' }} />;
}

interface ColorButtonProps {
  label: string;
  title: string;
  value: string;
  active: boolean;
  underline?: boolean;
  onPick(color: string): void;
  onClear(): void;
}

function ColorButton({ label, title, value, active, underline, onPick, onClear }: ColorButtonProps) {
  const input = useRef<HTMLInputElement>(null);
  const pick = useRef(onPick);
  pick.current = onPick;

  // The native color input fires `input` continuously while dragging; `change` fires once on commit,
  // which keeps one color choice = one undo step.
  useEffect(() => {
    const el = input.current;
    if (el === null) return;
    const handler = (): void => pick.current(el.value);
    el.addEventListener('change', handler);
    return () => el.removeEventListener('change', handler);
  }, []);

  return (
    <span style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        title={title}
        aria-label={title}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => input.current?.click()}
        style={{
          ...buttonStyle(false),
          borderBottom: underline ? `3px solid ${value}` : undefined,
          background: underline ? 'transparent' : active ? value : 'transparent',
        }}
      >
        {label}
      </button>
      <input
        ref={input}
        type="color"
        aria-label={`${title} picker`}
        defaultValue={value}
        key={value}
        tabIndex={-1}
        style={{ position: 'absolute', inset: 0, opacity: 0, pointerEvents: 'none', width: '100%', height: '100%' }}
      />
      {active && (
        <button
          type="button"
          title={`Reset ${title.toLowerCase()}`}
          aria-label={`Reset ${title.toLowerCase()}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={onClear}
          style={{ ...buttonStyle(false), minWidth: 16, fontSize: 10, padding: 0 }}
        >
          ✕
        </button>
      )}
    </span>
  );
}
