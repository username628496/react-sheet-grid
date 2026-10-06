import { type KeyboardEvent, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import type { GridController } from '../input/GridController';
import { ChromeStyles } from './chrome';
import { useMessages, useTheme } from './GridProvider';
import { Icon } from './icons';

interface FindDialogProps {
  controller: GridController;
  /** Where the grid is on screen, so the panel opens in its top-right corner. */
  anchor: DOMRect;
  /** Changes every time the user asks to open it, to move focus into the search box again. */
  focusToken: number;
  onClose: () => void;
}

const TYPING_DELAY = 140; // a search walks every filled cell; wait until typing pauses

/** Find / Replace panel. A thin view: the work is done by the controller's `FindSession`. */
export function FindDialog({ controller, anchor, focusToken, onClose }: FindDialogProps) {
  const m = useMessages();
  const theme = useTheme();
  const session = controller.find;
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const { settings } = state;
  const findInput = useRef<HTMLInputElement>(null);
  // The text boxes keep their own value so typing is instant; the search follows once typing pauses.
  const [query, setQuery] = useState(settings.query);
  const [replacement, setReplacement] = useState(settings.replacement);
  const pending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Re-opening (or a new prefill from the selection) puts the box and the session back in step.
  useEffect(() => {
    setQuery(session.getSnapshot().settings.query);
    findInput.current?.focus();
    findInput.current?.select();
  }, [focusToken, session]);

  useEffect(() => () => clearTimeout(pending.current), []);

  // Safari and Firefox on a Mac do not focus a button when it is clicked, so after "Replace all" the focus is nowhere and
  // Escape would never reach the panel. Listen at the document while nothing else holds focus.
  const closeRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    const onDocumentKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.isComposing) return;
      const active = document.activeElement;
      if (active === null || active === document.body) closeRef.current();
    };
    document.addEventListener('keydown', onDocumentKey);
    return () => document.removeEventListener('keydown', onDocumentKey);
  }, []);

  const pushQuery = (value: string): void => {
    setQuery(value);
    clearTimeout(pending.current);
    pending.current = setTimeout(() => session.update({ query: value }), TYPING_DELAY);
  };
  const flush = (): void => {
    clearTimeout(pending.current);
    if (query !== settings.query) session.update({ query });
  };

  const close = (): void => {
    onClose();
    controller.editor.focus();
  };
  closeRef.current = close;
  // Buttons hand focus back to the search box so the keyboard keeps working (Enter for the next result, Esc to close).
  const act = (fn: () => void): void => {
    flush();
    fn();
    findInput.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT' && (e.target as HTMLInputElement).type === 'text') {
      e.preventDefault();
      flush();
      if (e.target === findInput.current || !state.replaceMode) {
        if (e.shiftKey) session.previous();
        else session.next();
      } else {
        session.replaceCurrent();
      }
    }
  };

  const count =
    settings.query === ''
      ? ''
      : state.count === 0
        ? m.findNoResults
        : m.findCount(state.index + 1, state.count, state.truncated);

  const check = (key: 'matchCase' | 'wholeCell' | 'inFormulas' | 'ignoreAccents', label: string) => (
    <label className="rdg-check">
      <input type="checkbox" checked={settings[key]} onChange={(e) => session.update({ [key]: e.target.checked })} />
      <span>{label}</span>
    </label>
  );

  const width = 380;
  const left = Math.max(8, Math.min(window.innerWidth - width - 8, anchor.right - width - 22));
  const top = Math.max(8, anchor.top + 8);

  return createPortal(
    <div
      role="dialog"
      aria-label={m.findAndReplace}
      data-testid="find-dialog"
      data-rdg-theme={theme}
      className="rdg-chrome rdg-popup rdg-dialog rdg-find"
      style={{ left, top, width }}
      onKeyDown={onKeyDown}
    >
      <ChromeStyles />
      <div className="rdg-find-row">
        <button
          type="button"
          className="rdg-btn rdg-find-toggle"
          aria-label={m.showReplace}
          aria-expanded={state.replaceMode}
          title={m.showReplace}
          onClick={() => session.setReplaceMode(!state.replaceMode)}
        >
          <Icon name="chevron" />
        </button>
        <input
          ref={findInput}
          type="text"
          className="rdg-search rdg-find-input"
          aria-label={m.find}
          placeholder={m.find}
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(e) => pushQuery(e.target.value)}
        />
        <span className="rdg-find-count" aria-live="polite" data-testid="find-count">
          {count}
        </span>
        <button type="button" className="rdg-btn" aria-label={m.previousMatch} title={m.previousMatch} disabled={state.count === 0} onClick={() => act(() => session.previous())}>
          <Icon name="chevronUp" />
        </button>
        <button type="button" className="rdg-btn" aria-label={m.nextMatch} title={m.nextMatch} disabled={state.count === 0} onClick={() => act(() => session.next())}>
          <Icon name="chevron" />
        </button>
        <button type="button" className="rdg-btn" aria-label={m.close} title={m.close} onClick={close}>
          <Icon name="close" />
        </button>
      </div>
      {state.replaceMode && (
        <div className="rdg-find-row">
          <span className="rdg-find-gutter" />
          <input
            type="text"
            className="rdg-search rdg-find-input"
            aria-label={m.replaceWith}
            placeholder={m.replaceWith}
            autoComplete="off"
            spellCheck={false}
            value={replacement}
            onChange={(e) => {
              setReplacement(e.target.value);
              session.update({ replacement: e.target.value });
            }}
          />
          <button type="button" className="rdg-textbtn" disabled={state.count === 0 || controller.sheet.readOnly} onClick={() => act(() => session.replaceCurrent())}>
            {m.replace}
          </button>
          <button type="button" className="rdg-textbtn" disabled={state.count === 0 || controller.sheet.readOnly} onClick={() => act(() => session.replaceAll())}>
            {m.replaceAll}
          </button>
        </div>
      )}
      <div className="rdg-find-options">
        {check('matchCase', m.matchCase)}
        {check('wholeCell', m.matchWholeCell)}
        {check('ignoreAccents', m.ignoreAccents)}
        {check('inFormulas', m.searchInFormulas)}
        <label className="rdg-check">
          <span>{m.searchIn}</span>
          <select
            className="rdg-select"
            style={{ minWidth: 0 }}
            aria-label={m.searchIn}
            value={settings.scope}
            onChange={(e) => session.update({ scope: e.target.value as 'sheet' | 'selection' })}
          >
            <option value="sheet">{m.scopeSheet}</option>
            <option value="selection" disabled={state.scopeRange === null}>
              {m.scopeSelection}
            </option>
          </select>
        </label>
      </div>
      <div className="rdg-find-result" role="status" aria-live="polite" data-testid="find-replaced">
        {state.replaced === null ? '' : m.replacedSummary(state.replaced.occurrences, state.replaced.cells)}
      </div>
    </div>,
    document.body,
  );
}
