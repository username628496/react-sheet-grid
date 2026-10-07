import type { HorizontalAlign } from '../core/model/StyleTable';
import type { Direction } from '../core/selection/navigation';

export type KeyContext = 'navigating' | 'editing' | 'editingFormula';

export interface KeyInput {
  key: string;
  shift: boolean;
  alt: boolean;
  /** Meta on Mac, Ctrl elsewhere. */
  mod: boolean;
  isComposing: boolean;
  keyCode: number;
  /** Physical key, used where the character depends on the keyboard layout (Shift+digit). */
  code?: string;
}

export type CommitMove = 'down' | 'up' | 'right' | 'left' | 'none';

export type Action =
  | { type: 'move'; dir: Direction; extend: boolean; jump: boolean }
  | { type: 'page'; dir: 'up' | 'down'; extend: boolean }
  | { type: 'edge'; edge: 'home' | 'end'; ctrl: boolean; extend: boolean }
  | { type: 'advance'; horizontal: boolean; backward: boolean }
  | { type: 'selectAll' }
  | { type: 'selectRow' }
  | { type: 'selectColumn' }
  | { type: 'clear' }
  | { type: 'startEdit' }
  | { type: 'startTyping' }
  | { type: 'commit'; move: CommitMove }
  | { type: 'cancel' }
  | { type: 'newline' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'bold' }
  | { type: 'italic' }
  | { type: 'underline' }
  | { type: 'strike' }
  | { type: 'fillDown' }
  | { type: 'fillRight' }
  | { type: 'commitFill' }
  | { type: 'clearFormat' }
  | { type: 'align'; align: HorizontalAlign }
  | { type: 'numberFormat'; format: string }
  | { type: 'pasteValues' }
  | { type: 'pasteFormat' }
  | { type: 'showShortcuts' }
  | { type: 'fontSize'; direction: 1 | -1 }
  | { type: 'find'; replace: boolean }
  | { type: 'openList' }
  | { type: 'leaveGrid'; backward: boolean }
  | { type: 'hide'; axis: 'row' | 'col' }
  | { type: 'unhide'; axis: 'row' | 'col' }
  | { type: 'scrollToActive' }
  | { type: 'pointMove'; dir: Direction; extend: boolean }
  | { type: 'toggleAbsolute' };

export interface KeyOptions {
  /** In "enter mode" (started by typing) arrows commit and move; after F2/double-click they move the caret. */
  arrowsCommit: boolean;
  /** A cell reference can be inserted at the caret (right after = ( , or an operator), so arrows point at cells. */
  canPoint?: boolean;
}

const ARROWS: Record<string, Direction> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};

export function isMacPlatform(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
}

export function toKeyInput(
  e: { key: string; shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean; isComposing: boolean; keyCode: number; code?: string },
  isMac: boolean,
): KeyInput {
  return {
    key: e.key,
    shift: e.shiftKey,
    alt: e.altKey,
    mod: isMac ? e.metaKey : e.ctrlKey,
    isComposing: e.isComposing,
    keyCode: e.keyCode,
    code: e.code,
  };
}

/**
 * Same physical key means different things per context. Returns null when the
 * key must be left to the browser (typing in the editor, native clipboard
 * shortcuts, and everything while an IME is composing).
 */
export function resolveKey(
  context: KeyContext,
  k: KeyInput,
  options: KeyOptions = { arrowsCommit: false },
): Action | null {
  // Handling shortcuts mid-composition would break Telex/VNI input.
  if (k.isComposing || k.keyCode === 229) return null;
  return context === 'navigating' ? navigatingKey(k) : editingKey(context, k, options);
}

function navigatingKey(k: KeyInput): Action | null {
  // The way out of the grid for keyboard users (Tab moves between cells here).
  if (k.mod && k.alt && k.shift && (k.key === 'ArrowDown' || k.key === 'ArrowUp')) return { type: 'leaveGrid', backward: k.key === 'ArrowUp' };
  const arrow = ARROWS[k.key];
  if (arrow !== undefined) {
    // Alt+Down opens the dropdown of a list cell, as in Sheets.
    if (k.alt) return k.key === 'ArrowDown' && !k.mod && !k.shift ? { type: 'openList' } : null;
    return { type: 'move', dir: arrow, extend: k.shift, jump: k.mod };
  }
  // Option+V types a symbol on a Mac, so paste-format is recognized by the physical key.
  if (k.mod && k.alt && k.code === 'KeyV') return { type: 'pasteFormat' };
  // Same keys as Sheets; the digits are matched by physical key because Option/Shift change the character.
  if (k.mod && k.alt && !k.shift && k.code === 'Digit9') return { type: 'hide', axis: 'row' };
  if (k.mod && k.alt && !k.shift && k.code === 'Digit0') return { type: 'hide', axis: 'col' };
  if (k.mod && k.shift && !k.alt && k.code === 'Digit9') return { type: 'unhide', axis: 'row' };
  if (k.mod && k.shift && !k.alt && k.code === 'Digit0') return { type: 'unhide', axis: 'col' };
  switch (k.key) {
    case 'Tab':
      return { type: 'advance', horizontal: true, backward: k.shift };
    case 'Enter':
      return k.shift ? { type: 'advance', horizontal: false, backward: true } : { type: 'startEdit' };
    case 'F2':
      return { type: 'startEdit' };
    case 'Escape':
      return { type: 'cancel' }; // clears the copy marquee
    case 'Home':
      return { type: 'edge', edge: 'home', ctrl: k.mod, extend: k.shift };
    case 'End':
      return { type: 'edge', edge: 'end', ctrl: k.mod, extend: k.shift };
    case 'PageUp':
      return { type: 'page', dir: 'up', extend: k.shift };
    case 'PageDown':
      return { type: 'page', dir: 'down', extend: k.shift };
    case 'Delete':
    case 'Backspace':
      return k.mod ? { type: 'scrollToActive' } : { type: 'clear' };
    default:
      break;
  }
  if (k.mod && !k.alt) {
    const key = k.key.toLowerCase();
    if (k.shift) {
      // Shift+digit gives different characters per layout, so these use the physical key.
      const numberFormats: Record<string, string> = { Digit1: '#,##0.00', Digit4: '$#,##0.00', Digit5: '0%' };
      const format = k.code === undefined ? undefined : numberFormats[k.code];
      if (format !== undefined) return { type: 'numberFormat', format };
      if (k.code === 'Period') return { type: 'fontSize', direction: 1 };
      if (k.code === 'Comma') return { type: 'fontSize', direction: -1 };
      switch (key) {
        case 'z':
          return { type: 'redo' };
        case 'l':
          return { type: 'align', align: 'left' };
        case 'e':
          return { type: 'align', align: 'center' };
        case 'r':
          return { type: 'align', align: 'right' };
        case 'x':
          return { type: 'strike' };
        case 'v':
          return { type: 'pasteValues' }; // the paste event itself still comes from the browser
        case 'h':
          return { type: 'find', replace: true };
        default:
          return null;
      }
    }
    switch (key) {
      case 'a':
        return { type: 'selectAll' };
      case 'z':
        return { type: 'undo' };
      case 'y':
        return { type: 'redo' };
      case 'b':
        return { type: 'bold' };
      case 'i':
        return { type: 'italic' };
      case 'u':
        return { type: 'underline' };
      case 'd':
        return { type: 'fillDown' };
      case 'r':
        return { type: 'fillRight' };
      case '\\':
        return { type: 'clearFormat' };
      case ' ':
        return { type: 'selectColumn' };
      case '/':
        return { type: 'showShortcuts' };
      case 'f':
        return { type: 'find', replace: false };
      case 'h':
        return { type: 'find', replace: true }; // Ctrl+H; on a Mac Cmd+H belongs to the system, so Cmd+Shift+H (below) is used
      default:
        return null; // Mod+C/X/V arrive as clipboard events, not keys.
    }
  }
  if (k.shift && k.key === ' ') return { type: 'selectRow' };
  // A single printable character starts editing; the browser then types it into
  // the (already focused) editor textarea, so the first character is never lost.
  if (!k.mod && !k.alt && [...k.key].length === 1) return { type: 'startTyping' };
  return null;
}

function editingKey(context: KeyContext, k: KeyInput, options: KeyOptions): Action | null {
  switch (k.key) {
    case 'Enter':
      if (k.mod) return { type: 'commitFill' }; // Ctrl/Cmd+Enter fills the whole selection
      if (k.alt) return { type: 'newline' };
      return { type: 'commit', move: k.shift ? 'up' : 'down' };
    case 'Tab':
      return { type: 'commit', move: k.shift ? 'left' : 'right' };
    case 'Escape':
      return { type: 'cancel' };
    default:
      break;
  }
  const arrow = ARROWS[k.key];
  if (context === 'editingFormula') {
    // F4 cycles $ on the reference under the caret; arrows point at cells when a reference may go here,
    // otherwise they move the caret as usual.
    if (k.key === 'F4') return { type: 'toggleAbsolute' };
    if (arrow !== undefined && options.canPoint === true && !k.mod && !k.alt) {
      return { type: 'pointMove', dir: arrow, extend: k.shift };
    }
  }
  if (arrow !== undefined && options.arrowsCommit && context === 'editing' && !k.shift && !k.mod && !k.alt) {
    return { type: 'commit', move: arrow };
  }
  return null;
}
