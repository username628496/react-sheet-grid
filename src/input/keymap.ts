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
  | { type: 'italic' };

export interface KeyOptions {
  /** In "enter mode" (started by typing) arrows commit and move; after F2/double-click they move the caret. */
  arrowsCommit: boolean;
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
  e: { key: string; shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean; isComposing: boolean; keyCode: number },
  isMac: boolean,
): KeyInput {
  return {
    key: e.key,
    shift: e.shiftKey,
    alt: e.altKey,
    mod: isMac ? e.metaKey : e.ctrlKey,
    isComposing: e.isComposing,
    keyCode: e.keyCode,
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
  const arrow = ARROWS[k.key];
  if (arrow !== undefined) {
    if (k.alt) return null;
    return { type: 'move', dir: arrow, extend: k.shift, jump: k.mod };
  }
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
      return { type: 'clear' };
    default:
      break;
  }
  if (k.mod && !k.alt) {
    switch (k.key.toLowerCase()) {
      case 'a':
        return { type: 'selectAll' };
      case 'z':
        return k.shift ? { type: 'redo' } : { type: 'undo' };
      case 'y':
        return { type: 'redo' };
      case 'b':
        return { type: 'bold' };
      case 'i':
        return { type: 'italic' };
      case ' ':
        return { type: 'selectColumn' };
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
  // While typing a formula the arrows stay with the caret; pointing at cells is not supported yet.
  if (arrow !== undefined && options.arrowsCommit && context === 'editing' && !k.shift && !k.mod && !k.alt) {
    return { type: 'commit', move: arrow };
  }
  return null;
}
