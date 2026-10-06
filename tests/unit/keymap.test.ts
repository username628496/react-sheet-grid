import { describe, expect, it } from 'vitest';
import { type KeyInput, resolveKey } from '../../src/input/keymap';

function key(k: string, extra: Partial<KeyInput> = {}): KeyInput {
  return { key: k, shift: false, alt: false, mod: false, isComposing: false, keyCode: 0, ...extra };
}

describe('keymap: IME safety', () => {
  it('ignores every key while composing, in every context', () => {
    for (const ctx of ['navigating', 'editing', 'editingFormula'] as const) {
      expect(resolveKey(ctx, key('Enter', { isComposing: true }))).toBeNull();
      expect(resolveKey(ctx, key('a', { isComposing: true }))).toBeNull();
      expect(resolveKey(ctx, key('Process', { keyCode: 229 }))).toBeNull();
      expect(resolveKey(ctx, key('Escape', { keyCode: 229 }))).toBeNull();
    }
  });
});

describe('keymap: navigating', () => {
  it('maps arrows with shift and mod modifiers', () => {
    expect(resolveKey('navigating', key('ArrowDown'))).toEqual({ type: 'move', dir: 'down', extend: false, jump: false });
    expect(resolveKey('navigating', key('ArrowLeft', { shift: true, mod: true }))).toEqual({
      type: 'move',
      dir: 'left',
      extend: true,
      jump: true,
    });
  });

  it('maps Tab, Enter and F2', () => {
    expect(resolveKey('navigating', key('Tab'))).toEqual({ type: 'advance', horizontal: true, backward: false });
    expect(resolveKey('navigating', key('Tab', { shift: true }))).toEqual({ type: 'advance', horizontal: true, backward: true });
    expect(resolveKey('navigating', key('Enter'))).toEqual({ type: 'startEdit' });
    expect(resolveKey('navigating', key('F2'))).toEqual({ type: 'startEdit' });
    expect(resolveKey('navigating', key('Enter', { shift: true }))).toEqual({ type: 'advance', horizontal: false, backward: true });
  });

  it('maps Home/End/Page keys', () => {
    expect(resolveKey('navigating', key('Home', { mod: true }))).toEqual({ type: 'edge', edge: 'home', ctrl: true, extend: false });
    expect(resolveKey('navigating', key('End', { shift: true }))).toEqual({ type: 'edge', edge: 'end', ctrl: false, extend: true });
    expect(resolveKey('navigating', key('PageDown'))).toEqual({ type: 'page', dir: 'down', extend: false });
  });

  it('starts typing on a printable character, including non-ASCII and space', () => {
    expect(resolveKey('navigating', key('a'))).toEqual({ type: 'startTyping' });
    expect(resolveKey('navigating', key('ế'))).toEqual({ type: 'startTyping' });
    expect(resolveKey('navigating', key(' '))).toEqual({ type: 'startTyping' });
    expect(resolveKey('navigating', key('A', { shift: true }))).toEqual({ type: 'startTyping' });
  });

  it('does not start typing for modifier combos or named keys', () => {
    expect(resolveKey('navigating', key('q', { mod: true }))).toBeNull();
    expect(resolveKey('navigating', key('e', { alt: true }))).toBeNull();
    expect(resolveKey('navigating', key('Shift'))).toBeNull();
    expect(resolveKey('navigating', key('F5'))).toBeNull();
  });

  it('leaves clipboard shortcuts to the browser', () => {
    for (const k of ['c', 'x', 'v']) expect(resolveKey('navigating', key(k, { mod: true }))).toBeNull();
  });

  it('maps editing shortcuts', () => {
    expect(resolveKey('navigating', key('a', { mod: true }))).toEqual({ type: 'selectAll' });
    expect(resolveKey('navigating', key('z', { mod: true }))).toEqual({ type: 'undo' });
    expect(resolveKey('navigating', key('z', { mod: true, shift: true }))).toEqual({ type: 'redo' });
    expect(resolveKey('navigating', key('y', { mod: true }))).toEqual({ type: 'redo' });
    expect(resolveKey('navigating', key('Delete'))).toEqual({ type: 'clear' });
    expect(resolveKey('navigating', key('b', { mod: true }))).toEqual({ type: 'bold' });
    expect(resolveKey('navigating', key(' ', { mod: true }))).toEqual({ type: 'selectColumn' });
    expect(resolveKey('navigating', key(' ', { shift: true }))).toEqual({ type: 'selectRow' });
  });
});

describe('keymap: editing', () => {
  it('commits with Enter/Tab and cancels with Escape', () => {
    expect(resolveKey('editing', key('Enter'))).toEqual({ type: 'commit', move: 'down' });
    expect(resolveKey('editing', key('Enter', { shift: true }))).toEqual({ type: 'commit', move: 'up' });
    expect(resolveKey('editing', key('Tab'))).toEqual({ type: 'commit', move: 'right' });
    expect(resolveKey('editing', key('Tab', { shift: true }))).toEqual({ type: 'commit', move: 'left' });
    expect(resolveKey('editing', key('Escape'))).toEqual({ type: 'cancel' });
    expect(resolveKey('editing', key('Enter', { alt: true }))).toEqual({ type: 'newline' });
  });

  it('arrows commit only in enter mode', () => {
    expect(resolveKey('editing', key('ArrowDown'), { arrowsCommit: true })).toEqual({ type: 'commit', move: 'down' });
    expect(resolveKey('editing', key('ArrowDown'), { arrowsCommit: false })).toBeNull();
    expect(resolveKey('editing', key('ArrowLeft', { shift: true }), { arrowsCommit: true })).toBeNull();
  });

  it('leaves typing, undo and select-all to the textarea', () => {
    expect(resolveKey('editing', key('a'))).toBeNull();
    expect(resolveKey('editing', key('z', { mod: true }))).toBeNull();
    expect(resolveKey('editing', key('a', { mod: true }))).toBeNull();
    expect(resolveKey('editing', key('Delete'))).toBeNull();
    expect(resolveKey('editing', key('Home'))).toBeNull();
  });

  it('keeps arrows on the caret while editing a formula', () => {
    expect(resolveKey('editingFormula', key('ArrowRight'), { arrowsCommit: true })).toBeNull();
    expect(resolveKey('editingFormula', key('Enter'))).toEqual({ type: 'commit', move: 'down' });
  });
});
