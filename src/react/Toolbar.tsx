import { type KeyboardEvent, type ReactNode, useEffect, useRef, useSyncExternalStore } from 'react';
import type { Spreadsheet } from '../core/Spreadsheet';
import type { HorizontalAlign, Style } from '../core/model/StyleTable';
import { ChromeStyles } from './chrome';
import { Icon, type IconName } from './icons';

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

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** "Bold (⌘B)": the tooltip names the shortcut in the user's own platform vocabulary. */
function tip(label: string, shortcut?: string): string {
  if (shortcut === undefined) return label;
  const keys = shortcut
    .replace('Mod', IS_MAC ? '⌘' : 'Ctrl+')
    .replace('Shift', IS_MAC ? '⇧' : 'Shift+')
    .replace(/\+$/, '');
  return `${label} (${keys})`;
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
 * Arrow keys, Home and End move between the controls (the WAI-ARIA toolbar pattern); Escape returns to the grid.
 */
export function Toolbar({ sheet, onAction }: ToolbarProps) {
  const raw = useSyncExternalStore(
    (listener) => sheet.subscribe(listener),
    () => snapshot(sheet),
  );
  const { canUndo, canRedo, style } = parse(raw);
  const run = (fn: () => void): void => {
    fn();
    onAction?.();
  };
  const align = (a: HorizontalAlign): void => run(() => sheet.formatSelection({ align: a }, 'Align'));

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Escape') {
      onAction?.();
      return;
    }
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!keys.includes(e.key)) return;
    if (e.target instanceof HTMLSelectElement) return; // arrows change the option there
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), select'));
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (items.length === 0 || at < 0) return;
    e.preventDefault();
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (at + (e.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  };

  const button = (icon: IconName, label: string, shortcut: string | undefined, active: boolean | undefined, onClick: () => void, disabled = false, extra?: ReactNode): ReactNode => (
    <button
      type="button"
      className="rdg-btn"
      title={tip(label, shortcut)}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => run(onClick)}
    >
      <Icon name={icon} />
      {extra}
    </button>
  );

  return (
    <div role="toolbar" aria-label="Formatting" aria-orientation="horizontal" className="rdg-chrome rdg-toolbar" data-testid="toolbar" onKeyDown={onKeyDown}>
      <ChromeStyles />
      <div className="rdg-group" role="group" aria-label="History">
        {button('undo', 'Undo', 'Mod+Z', undefined, () => sheet.undo(), !canUndo)}
        {button('redo', 'Redo', 'Mod+Y', undefined, () => sheet.redo(), !canRedo)}
        {button('clearFormat', 'Clear formatting', 'Mod+\\', undefined, () => sheet.clearFormatting())}
      </div>
      <span className="rdg-sep" aria-hidden />
      <div className="rdg-group" role="group" aria-label="Sort">
        {button('sortAsc', 'Sort A to Z', undefined, undefined, () => sheet.sortByColumn(sheet.selection.activeCol, true))}
        {button('sortDesc', 'Sort Z to A', undefined, undefined, () => sheet.sortByColumn(sheet.selection.activeCol, false))}
      </div>
      <span className="rdg-sep" aria-hidden />
      <div className="rdg-group" role="group" aria-label="Text style">
        {button('bold', 'Bold', 'Mod+B', style.bold === true, () => sheet.toggleStyle('bold'))}
        {button('italic', 'Italic', 'Mod+I', style.italic === true, () => sheet.toggleStyle('italic'))}
        {button('underline', 'Underline', 'Mod+U', style.underline === true, () => sheet.toggleStyle('underline'))}
        {button('strike', 'Strikethrough', 'Mod+Shift+X', style.strike === true, () => sheet.toggleStyle('strike'))}
        <ColorButton
          icon="textColor"
          title="Text color"
          value={style.color ?? '#1f2328'}
          active={style.color !== undefined}
          onPick={(color) => run(() => sheet.formatSelection({ color }, 'Text color'))}
          onClear={() => run(() => sheet.formatSelection({ color: undefined }, 'Text color'))}
        />
        <ColorButton
          icon="fillColor"
          title="Fill color"
          value={style.background ?? '#ffffff'}
          active={style.background !== undefined}
          onPick={(background) => run(() => sheet.formatSelection({ background }, 'Fill color'))}
          onClear={() => run(() => sheet.formatSelection({ background: undefined }, 'Fill color'))}
        />
      </div>
      <span className="rdg-sep" aria-hidden />
      <div className="rdg-group" role="group" aria-label="Alignment">
        {button('alignLeft', 'Align left', 'Mod+Shift+L', style.align === 'left', () => align('left'))}
        {button('alignCenter', 'Align center', 'Mod+Shift+E', style.align === 'center', () => align('center'))}
        {button('alignRight', 'Align right', 'Mod+Shift+R', style.align === 'right', () => align('right'))}
      </div>
      <span className="rdg-sep" aria-hidden />
      <select
        className="rdg-select"
        aria-label="Number format"
        title="Number format"
        value={style.numberFormat ?? ''}
        onMouseDown={(e) => e.stopPropagation()}
        onChange={(e) => {
          const numberFormat = e.target.value === '' ? undefined : e.target.value;
          run(() => sheet.formatSelection({ numberFormat }, 'Number format'));
        }}
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

interface ColorButtonProps {
  icon: IconName;
  title: string;
  value: string;
  active: boolean;
  onPick(color: string): void;
  onClear(): void;
}

function ColorButton({ icon, title, value, active, onPick, onClear }: ColorButtonProps) {
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
    <span className="rdg-color">
      <button
        type="button"
        className="rdg-btn"
        title={title}
        aria-label={title}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => input.current?.click()}
      >
        <Icon name={icon} />
        <span className="rdg-swatch" style={{ ['--rdg-swatch' as string]: value }} />
      </button>
      <input ref={input} type="color" aria-label={`${title} picker`} defaultValue={value} key={value} tabIndex={-1} />
      {active && (
        <button
          type="button"
          className="rdg-reset"
          title={`Reset ${title.toLowerCase()}`}
          aria-label={`Reset ${title.toLowerCase()}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={onClear}
        >
          <Icon name="close" />
        </button>
      )}
    </span>
  );
}
