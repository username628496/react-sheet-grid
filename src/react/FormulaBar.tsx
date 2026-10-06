import { type KeyboardEvent, useEffect, useRef, useSyncExternalStore } from 'react';
import { formatRangeAddress, parseRangeAddress } from '../core/model/address';
import type { Spreadsheet } from '../core/Spreadsheet';
import type { GridController } from '../input/GridController';
import type { CommitMove } from '../input/keymap';
import { ChromeStyles } from './chrome';
import { useMessages, useTheme } from './GridProvider';

interface FormulaBarProps {
  sheet: Spreadsheet;
  /** The controller from DataGrid's onReady; the bar is inert until it exists. */
  grid: GridController | null;
}

/**
 * Name box (shows and jumps to a cell or range) plus a text field for the active cell's content.
 *
 * The grid's hidden textarea stays the one place edits are committed from. While the user types in this bar the
 * textarea mirrors the text (and caret), so the cell shows the edit, clicking cells still inserts references, and
 * Enter/Esc/Tab behave exactly like in the cell editor. No text goes through React state: both inputs are written
 * imperatively, like the grid, so typing never re-renders.
 */
export function FormulaBar({ sheet, grid }: FormulaBarProps) {
  const m = useMessages();
  const theme = useTheme();
  const nameRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLInputElement>(null);

  // Shows the selection address and the cell text, except in the field the user is typing into.
  useEffect(() => {
    const name = nameRef.current;
    const text = textRef.current;
    if (name === null || text === null) return;
    const refresh = (): void => {
      if (document.activeElement !== name) {
        name.value = formatRangeAddress(sheet.selection.primary, sheet.rowCount, sheet.colCount);
      }
      const editor = grid?.editor;
      if (editor?.editing === true) {
        // The bar normally mirrors the textarea, so they only differ when the grid changed the text itself
        // (a click that inserted a reference, F4): then the bar follows, caret included.
        if (text.value !== editor.text) {
          text.value = editor.text;
          if (document.activeElement === text) text.setSelectionRange(editor.textarea.selectionStart, editor.textarea.selectionEnd);
        }
      } else if (document.activeElement !== text) {
        const { activeRow, activeCol } = sheet.selection;
        text.value = sheet.getEditText(activeRow, activeCol);
      }
    };
    refresh();
    const unsubscribe = sheet.subscribe(refresh);
    // Typing in the cell editor does not notify the sheet; the bar mirrors it from the textarea's input events.
    const textarea = grid?.editor.textarea;
    textarea?.addEventListener('input', refresh);
    return () => {
      unsubscribe();
      textarea?.removeEventListener('input', refresh);
    };
  }, [sheet, grid]);

  const readOnly = useSyncExternalStore(
    (listener) => sheet.subscribe(listener),
    () => sheet.readOnly,
  );
  const pushToEditor = (): void => {
    const text = textRef.current;
    if (text === null || grid === null) return;
    grid.editor.syncFromBar(text.value, text.selectionStart ?? text.value.length, text.selectionEnd ?? text.value.length);
  };

  const onTextFocus = (): void => {
    const text = textRef.current;
    if (text === null || grid === null) return;
    if (!grid.editor.editing) grid.editor.beginFromBar(text.value);
    else pushToEditor();
  };

  const onTextBlur = (): void => {
    // Focus going to the grid (a click that inserts a reference) keeps the edit alive. Focus going nowhere ends it,
    // like clicking away from the cell editor.
    setTimeout(() => {
      if (grid === null || !grid.editor.editing || !grid.editor.fromBar) return;
      if (document.activeElement === textRef.current || !document.hasFocus()) return;
      if (document.activeElement === document.body) grid.editor.commit();
    }, 0);
  };

  const finish = (move: CommitMove): void => {
    if (grid === null) return;
    grid.keyboard.commitAndMove(move);
    grid.editor.focus();
  };

  const onTextKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    // IME: Enter confirms a composition, it must not commit the cell.
    if (e.nativeEvent.isComposing || e.keyCode === 229 || grid === null) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      finish('down');
    } else if (e.key === 'Tab') {
      e.preventDefault();
      finish(e.shiftKey ? 'left' : 'right');
    } else if (e.key === 'Escape') {
      e.preventDefault();
      grid.editor.cancel();
      grid.editor.focus();
    }
  };

  const onNameKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.nativeEvent.isComposing || e.keyCode === 229 || grid === null) return;
    const name = nameRef.current;
    if (name === null) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      name.value = formatRangeAddress(sheet.selection.primary, sheet.rowCount, sheet.colCount);
      grid.editor.focus();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const range = parseRangeAddress(name.value, sheet.rowCount, sheet.colCount);
      if (range === null) {
        name.select(); // not an address: keep the box so it can be corrected
        return;
      }
      grid.editor.commit();
      const { selection } = sheet;
      const fullHeight = range.startRow === 0 && range.endRow === sheet.rowCount - 1;
      const fullWidth = range.startCol === 0 && range.endCol === sheet.colCount - 1;
      if (fullHeight && fullWidth) {
        selection.selectAll();
      } else if (fullHeight) {
        selection.selectCol(range.startCol);
        if (range.endCol > range.startCol) selection.selectCol(range.endCol, true);
      } else if (fullWidth) {
        selection.selectRow(range.startRow);
        if (range.endRow > range.startRow) selection.selectRow(range.endRow, true);
      } else {
        selection.selectCell(range.startRow, range.startCol);
        if (range.endRow > range.startRow || range.endCol > range.startCol) selection.extendTo(range.endRow, range.endCol);
      }
      grid.surface.scrollCellIntoView(range.startRow, range.startCol);
      sheet.notify();
      grid.editor.focus();
    }
  };

  return (
    <div className="rdg-chrome rdg-formulabar" data-rdg-theme={theme} data-testid="formula-bar">
      <ChromeStyles />
      <input
        ref={nameRef}
        className="rdg-field rdg-namebox"
        aria-label={m.nameBox}
        data-testid="name-box"
        spellCheck={false}
        autoComplete="off"
        disabled={grid === null}
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={onNameKeyDown}
      />
      <span aria-hidden className="rdg-fx">
        fx
      </span>
      <input
        ref={textRef}
        className="rdg-field rdg-formula"
        aria-label={m.formulaBar}
        data-testid="formula-input"
        spellCheck={false}
        autoComplete="off"
        disabled={grid === null}
        readOnly={readOnly}
        onFocus={onTextFocus}
        onBlur={onTextBlur}
        onInput={pushToEditor}
        onKeyUp={pushToEditor}
        onMouseUp={pushToEditor}
        onKeyDown={onTextKeyDown}
      />
    </div>
  );
}
