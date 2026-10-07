import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChromeStyles } from './chrome';
import { useMessages, useTheme } from './GridProvider';
import { type Command, matchCommands, rememberCommand } from './toolbarCommands';

const STORAGE_KEY = 'rdg-recent-commands';

function loadRecent(): string[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string').slice(0, 8) : [];
  } catch {
    return []; // storage blocked or damaged: no history, nothing else lost
  }
}

function saveRecent(recent: readonly string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(recent));
  } catch {
    /* private mode: the history just lasts until reload */
  }
}

interface CommandPaletteProps {
  /** Built when the palette opens, so labels and states describe the selection at that moment. */
  commands: readonly Command[];
  onClose: () => void;
}

/** "Search commands": type a few words, arrow to the one you want, Enter. Works without accents and remembers what you use. */
export function CommandPalette({ commands, onClose }: CommandPaletteProps) {
  const m = useMessages();
  const theme = useTheme();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState(loadRecent);
  const listRef = useRef<HTMLDivElement>(null);
  const matches = useMemo(() => matchCommands(commands, query, recent), [commands, query, recent]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active, matches]);

  const run = (command: Command | undefined): void => {
    if (command === undefined || command.disabled) return;
    const next = rememberCommand(recent, command.id);
    setRecent(next);
    saveRecent(next);
    onClose();
    command.run();
  };

  return createPortal(
    <div className="rdg-chrome rdg-overlay rdg-palette-overlay" data-rdg-theme={theme} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <ChromeStyles />
      <div role="dialog" aria-label={m.commandSearch} data-testid="command-palette" className="rdg-chrome rdg-popup rdg-palette">
        <input
          autoFocus
          className="rdg-search rdg-palette-input"
          type="search"
          role="combobox"
          aria-expanded
          aria-controls="rdg-palette-list"
          aria-activedescendant={matches[active] === undefined ? undefined : `rdg-cmd-${matches[active].id}`}
          aria-label={m.commandSearch}
          placeholder={m.commandSearchPlaceholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
            else if (e.key === 'ArrowDown') setActive((a) => Math.min(matches.length - 1, a + 1));
            else if (e.key === 'ArrowUp') setActive((a) => Math.max(0, a - 1));
            else if (e.key === 'Home') setActive(0);
            else if (e.key === 'End') setActive(Math.max(0, matches.length - 1));
            else if (e.key === 'Enter') run(matches[active]);
            else return;
            e.preventDefault();
          }}
        />
        <div ref={listRef} id="rdg-palette-list" role="listbox" aria-label={m.commandSearch} className="rdg-palette-list">
          {matches.length === 0 && <div className="rdg-muted" style={{ padding: 10 }}>{m.noCommands}</div>}
          {matches.map((c, i) => (
            <div
              key={c.id}
              id={`rdg-cmd-${c.id}`}
              role="option"
              aria-selected={i === active}
              aria-disabled={c.disabled}
              className="rdg-palette-item"
              data-active={i === active}
              onMouseMove={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => run(c)}
            >
              <span className="rdg-palette-check" aria-hidden>{c.checked === true ? '✓' : ''}</span>
              <span className="rdg-palette-label">{c.label}</span>
              <span className="rdg-muted rdg-palette-group">{c.group}</span>
              {c.shortcut !== undefined && <kbd className="rdg-kbd">{c.shortcut}</kbd>}
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
