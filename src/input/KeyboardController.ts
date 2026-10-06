import { focusOutside } from './focusOutside';
import {
  advanceActive,
  moveByArrow,
  moveByPage,
  moveToEdge,
  type NavContext,
} from '../core/selection/navigation';
import type { Spreadsheet } from '../core/Spreadsheet';
import type { GridSurface } from '../render/GridSurface';
import type { ClipboardController } from './ClipboardController';
import type { EditorController } from './EditorController';
import { type Action, type CommitMove, isMacPlatform, type KeyContext, resolveKey, toKeyInput } from './keymap';

export interface KeyboardDeps {
  sheet: Spreadsheet;
  surface: GridSurface;
  editor: EditorController;
  clipboard: ClipboardController;
  showShortcuts: () => void;
}

export class KeyboardController {
  private readonly isMac = isMacPlatform();
  private readonly textarea: HTMLTextAreaElement;
  private readonly nav: NavContext;

  constructor(private readonly deps: KeyboardDeps) {
    this.textarea = deps.editor.textarea;
    const { sheet } = deps;
    this.nav = {
      get rowCount() {
        return sheet.rowCount;
      },
      get colCount() {
        return sheet.colCount;
      },
      isEmpty: (r, c) => sheet.getCellByView(r, c).value === null,
      rowHidden: (r) => sheet.rows.getSize(r) === 0,
      colHidden: (c) => sheet.cols.getSize(c) === 0,
      usedEnd: () => {
        const used = sheet.model.getUsedRange();
        if (used === null) return null;
        const row = sheet.mapping.toViewRow(used.endRow);
        return { row: row < 0 ? sheet.rowCount - 1 : row, col: sheet.mapping.toViewCol(used.endCol) };
      },
    };
    this.textarea.addEventListener('keydown', this.onKeyDown);
    this.textarea.addEventListener('compositionstart', this.onCompositionStart);
    this.textarea.addEventListener('input', this.onInput);
    this.textarea.addEventListener('blur', this.onBlur);
  }

  destroy(): void {
    this.textarea.removeEventListener('keydown', this.onKeyDown);
    this.textarea.removeEventListener('compositionstart', this.onCompositionStart);
    this.textarea.removeEventListener('input', this.onInput);
    this.textarea.removeEventListener('blur', this.onBlur);
  }

  get context(): KeyContext {
    const { editor } = this.deps;
    if (!editor.editing) return 'navigating';
    return editor.text.startsWith('=') ? 'editingFormula' : 'editing';
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    const { editor } = this.deps;
    const action = resolveKey(this.context, toKeyInput(e, this.isMac), {
      arrowsCommit: editor.mode === 'typing',
      canPoint: editor.canPointWithKeys(),
    });
    if (action === null) {
      // A plain arrow in a formula that is not pointing moves the caret: from now on this is edit mode.
      if (this.context === 'editingFormula' && /^Arrow/.test(e.key) && !e.isComposing) editor.mode = 'caret';
      return;
    }
    // startTyping must not be prevented: the browser's default inserts the character into the textarea.
    // pasteValues likewise lets the browser's paste event through; it only marks the next paste as values-only.
    if (action.type !== 'startTyping' && action.type !== 'pasteValues' && action.type !== 'pasteFormat') e.preventDefault();
    this.run(action);
  };

  // IME input starts with composition events rather than a printable keydown.
  private readonly onCompositionStart = (): void => {
    const { editor } = this.deps;
    if (!editor.editing) editor.begin('typing', '');
  };

  private readonly onInput = (): void => {
    if (this.deps.editor.editing) this.deps.editor.reposition();
  };

  private readonly onBlur = (): void => {
    // Switching windows should not end an edit; clicking elsewhere on the page should.
    // Focus moving to the formula bar continues the same edit.
    if (this.deps.editor.editing && !this.deps.editor.fromBar && document.hasFocus()) this.deps.editor.commit();
  };

  private run(action: Action): void {
    const { sheet, editor } = this.deps;
    const { selection } = sheet;
    switch (action.type) {
      case 'move':
        moveByArrow(selection, action.dir, { extend: action.extend, jump: action.jump }, this.nav);
        break;
      case 'page':
        moveByPage(selection, action.dir, this.pageRows(), action.extend, this.nav);
        break;
      case 'edge':
        moveToEdge(selection, action.edge, { ctrl: action.ctrl, extend: action.extend }, this.nav);
        break;
      case 'advance':
        advanceActive(selection, { horizontal: action.horizontal, backward: action.backward }, this.nav);
        break;
      case 'selectAll':
        selection.selectAll();
        break;
      case 'selectRow':
        selection.selectRow(selection.activeRow);
        break;
      case 'selectColumn':
        selection.selectCol(selection.activeCol);
        break;
      case 'clear':
        sheet.clearSelection();
        break;
      case 'startEdit':
        editor.begin('caret', sheet.getEditText(selection.activeRow, selection.activeCol));
        return;
      case 'startTyping':
        editor.begin('typing', '');
        return;
      case 'commit':
        editor.commit();
        this.moveAfterCommit(action.move);
        break;
      case 'cancel':
        editor.cancel();
        this.deps.clipboard.clearMarquee();
        break;
      case 'newline':
        editor.insertNewline();
        return;
      case 'undo':
        sheet.undo();
        break;
      case 'redo':
        sheet.redo();
        break;
      case 'bold':
      case 'italic':
      case 'underline':
      case 'strike':
        sheet.toggleStyle(action.type);
        break;
      case 'fillDown':
        sheet.fillFromEdge('down');
        break;
      case 'fillRight':
        sheet.fillFromEdge('right');
        break;
      case 'commitFill': {
        const text = editor.text;
        editor.cancel();
        sheet.fillSelectionWithInput(text);
        break;
      }
      case 'clearFormat':
        sheet.clearFormatting();
        break;
      case 'align':
        sheet.formatSelection({ align: action.align }, 'Align');
        break;
      case 'numberFormat':
        sheet.formatSelection({ numberFormat: action.format }, 'Number format');
        break;
      case 'pasteValues':
        this.deps.clipboard.armPaste('values');
        return;
      case 'pasteFormat':
        this.deps.clipboard.armPaste('format');
        return;
      case 'showShortcuts':
        this.deps.showShortcuts();
        return;
      case 'leaveGrid': {
        const root = this.deps.surface.host.parentElement;
        if (root !== null) focusOutside(root, action.backward);
        return;
      }
      case 'hide':
        if (action.axis === 'row') sheet.hideLines('row', selection.primary.startRow, selection.primary.endRow);
        else sheet.hideLines('col', selection.primary.startCol, selection.primary.endCol);
        break;
      case 'unhide':
        if (action.axis === 'row') sheet.showLines('row', selection.primary.startRow, selection.primary.endRow);
        else sheet.showLines('col', selection.primary.startCol, selection.primary.endCol);
        break;
      case 'pointMove':
        editor.pointMove(action.dir, action.extend);
        return;
      case 'toggleAbsolute':
        editor.toggleAbsolute();
        return;
      case 'scrollToActive':
        this.deps.surface.scrollCellIntoView(selection.activeRow, selection.activeCol);
        return;
    }
    this.deps.surface.scrollCellIntoView(selection.focusRow, selection.focusCol);
    editor.reposition();
  }

  /** Enter/Tab in the formula bar: same as in the cell editor. */
  commitAndMove(move: CommitMove): void {
    this.deps.editor.commit();
    this.moveAfterCommit(move);
    this.deps.surface.scrollCellIntoView(this.deps.sheet.selection.activeRow, this.deps.sheet.selection.activeCol);
    this.deps.sheet.notify();
  }

  private moveAfterCommit(move: CommitMove): void {
    const { selection } = this.deps.sheet;
    switch (move) {
      case 'down':
        advanceActive(selection, { horizontal: false, backward: false }, this.nav);
        break;
      case 'up':
        advanceActive(selection, { horizontal: false, backward: true }, this.nav);
        break;
      case 'right':
        advanceActive(selection, { horizontal: true, backward: false }, this.nav);
        break;
      case 'left':
        advanceActive(selection, { horizontal: true, backward: true }, this.nav);
        break;
      case 'none':
        break;
    }
  }

  private pageRows(): number {
    const vp = this.deps.surface.viewport;
    return Math.max(1, Math.floor(vp.scrollAreaHeight / this.deps.sheet.rows.defaultSize));
  }
}
