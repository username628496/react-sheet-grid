import { type KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChromeStyles } from './chrome';
import { useTheme } from './GridProvider';

export interface MenuItem {
  label: string;
  shortcut?: string;
  disabled?: boolean;
  /** Shows the item as the current choice of a group (radio-like). */
  checked?: boolean;
  title?: string;
  run: () => void;
}

export type MenuEntry = MenuItem | 'separator';

interface MenuProps {
  entries: readonly MenuEntry[];
  /** Where the menu opens (viewport coordinates); it is moved if it would leave the screen. */
  x: number;
  y: number;
  label: string;
  testId?: string;
  /** `reason` is 'outside' when a press outside the menu closed it (so a toggle button can tell it apart from a choice). */
  onClose: (reason?: 'outside') => void;
  /** Runs after the menu closed and before the item's action, e.g. to give focus back to the grid. */
  beforeRun?: () => void;
}

/**
 * Keyboard-operable popup menu in a portal: Arrow keys move, Enter runs, Escape and outside clicks close.
 * Used by the context menu and by the toolbar's drop-downs.
 */
export function Menu({ entries, x, y, label, testId, onClose, beforeRun }: MenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const theme = useTheme();
  const [active, setActive] = useState(-1);
  const [pos, setPos] = useState({ x, y });
  const items = entries.filter((e): e is MenuItem => e !== 'separator');

  // Keep the menu on screen.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const r = el.getBoundingClientRect();
    setPos({ x: Math.max(4, Math.min(x, window.innerWidth - r.width - 4)), y: Math.max(4, Math.min(y, window.innerHeight - r.height - 4)) });
    el.focus();
  }, [x, y]);

  useEffect(() => {
    const close = (e: Event): void => {
      if (ref.current !== null && e.target instanceof Node && ref.current.contains(e.target)) return;
      onClose('outside');
    };
    const dismiss = (): void => onClose();
    window.addEventListener('mousedown', close, true);
    window.addEventListener('blur', dismiss);
    window.addEventListener('resize', dismiss);
    return () => {
      window.removeEventListener('mousedown', close, true);
      window.removeEventListener('blur', dismiss);
      window.removeEventListener('resize', dismiss);
    };
  }, [onClose]);

  const activate = (item: MenuItem): void => {
    if (item.disabled === true) return;
    onClose();
    beforeRun?.();
    item.run();
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    const enabled = items.map((it, i) => (it.disabled === true ? -1 : i)).filter((i) => i >= 0);
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      beforeRun?.();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const at = enabled.indexOf(active);
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive(enabled[(at + step + enabled.length) % enabled.length] ?? enabled[0] ?? -1);
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      setActive((e.key === 'Home' ? enabled[0] : enabled[enabled.length - 1]) ?? -1);
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();
      const item = items[active];
      if (item !== undefined) activate(item);
    }
  };

  let index = -1;
  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      tabIndex={-1}
      data-testid={testId}
      data-rdg-theme={theme}
      className="rdg-chrome rdg-popup rdg-menu"
      style={{ left: pos.x, top: pos.y }}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      <ChromeStyles />
      {entries.map((entry, i) => {
        if (entry === 'separator') return <div key={`s${i}`} role="separator" className="rdg-menusep" />;
        index++;
        const myIndex = index;
        return (
          <button
            key={entry.label}
            type="button"
            role={entry.checked === undefined ? 'menuitem' : 'menuitemradio'}
            aria-checked={entry.checked}
            className="rdg-menuitem"
            data-active={active === myIndex}
            disabled={entry.disabled}
            title={entry.title}
            onMouseEnter={() => setActive(myIndex)}
            onClick={() => activate(entry)}
          >
            <span>{entry.label}</span>
            {entry.shortcut !== undefined && <span className="rdg-hint">{entry.shortcut}</span>}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
