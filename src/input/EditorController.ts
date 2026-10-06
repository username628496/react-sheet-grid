import type { Spreadsheet } from '../core/Spreadsheet';
import type { Direction } from '../core/selection/navigation';
import { canInsertReference, cycleReference, findReferences, refToText, type RefMatch } from '../formula/refText';
import type { GridSurface } from '../render/GridSurface';
import { fontFor, REF_COLORS, theme } from '../render/theme';

export type EditMode = 'typing' | 'caret';

export interface ColoredRef extends RefMatch {
  color: string;
}

const DELTA: Record<Direction, readonly [number, number]> = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] };

const BASE_STYLE =
  'position:absolute;z-index:3;margin:0;border:0;outline:none;resize:none;overflow:hidden;' +
  'box-sizing:border-box;white-space:pre;';

/**
 * The single hidden <textarea> that owns keyboard focus. It stays focused in
 * navigating mode (invisible, parked over the active cell so IME candidate
 * windows appear in the right place) and simply becomes visible when editing
 * starts. Because it is the same element, the character that triggered
 * editing, or an IME composition, is typed into it without being lost.
 */
export class EditorController {
  editing = false;
  mode: EditMode = 'caret';
  /** References in the formula being edited, with the color used for the text and for the cells on the grid. */
  refs: ColoredRef[] = [];
  private original = '';
  private readonly measureCtx: CanvasRenderingContext2D | null;
  // "Pointing": arrows/clicks insert a cell reference at the caret; `pointSpan` is the text of the last one inserted.
  private pointSpan: { start: number; end: number } | null = null;
  private pointAnchor = { row: 0, col: 0 };
  private pointFocus = { row: 0, col: 0 };
  // While an IME composition is in progress the textarea must show its own text (the composition underline).
  private composing = false;
  private backdrop: HTMLDivElement | null = null;

  constructor(
    readonly textarea: HTMLTextAreaElement,
    private readonly sheet: Spreadsheet,
    private readonly surface: GridSurface,
  ) {
    this.measureCtx = document.createElement('canvas').getContext('2d');
    textarea.addEventListener('input', this.onInput);
    textarea.addEventListener('compositionstart', this.onCompositionStart);
    textarea.addEventListener('compositionend', this.onCompositionEnd);
    this.reposition();
  }

  destroy(): void {
    this.textarea.removeEventListener('input', this.onInput);
    this.textarea.removeEventListener('compositionstart', this.onCompositionStart);
    this.textarea.removeEventListener('compositionend', this.onCompositionEnd);
    this.backdrop?.remove();
  }

  private readonly onInput = (): void => {
    this.pointSpan = null; // the user typed: whatever was being pointed at is now ordinary text
  };

  private readonly onCompositionStart = (): void => {
    this.composing = true;
    this.reposition();
  };

  private readonly onCompositionEnd = (): void => {
    this.composing = false;
    this.reposition();
  };

  /** Is the caret right after a reference inserted by pointing (so the next arrow replaces it)? */
  get isPointing(): boolean {
    const span = this.pointSpan;
    const t = this.textarea;
    return this.editing && span !== null && t.selectionStart === span.end && t.selectionEnd === span.end;
  }

  /**
   * Arrow keys point at cells only in "enter mode" (the text was typed, not opened with F2) or while already
   * pointing. After the caret has been moved by hand it is "edit mode" and arrows move the caret.
   */
  canPointWithKeys(): boolean {
    return (this.mode === 'typing' || this.isPointing) && this.canPoint();
  }

  /** Clicks point at cells whenever a reference may be inserted at the caret. */
  canPoint(): boolean {
    if (!this.editing || !this.textarea.value.startsWith('=')) return false;
    return this.isPointing || canInsertReference(this.textarea.value, this.textarea.selectionStart);
  }

  /** Arrow key while pointing: moves the referenced cell one step; with Shift it grows a range instead. */
  pointMove(dir: Direction, extend: boolean): void {
    const first = !this.isPointing;
    const { selection } = this.sheet;
    if (first) {
      this.pointSpan = { start: this.textarea.selectionStart, end: this.textarea.selectionEnd };
      // The first arrow moves away from the cell being edited.
      this.pointFocus = { row: selection.activeRow, col: selection.activeCol };
      this.pointAnchor = { ...this.pointFocus };
    }
    const [dr, dc] = DELTA[dir];
    // Like moving a normal selection: a plain arrow moves from the anchor cell, Shift grows from the moving corner.
    const base = extend && !first ? this.pointFocus : this.pointAnchor;
    const focus = {
      row: Math.max(0, Math.min(this.sheet.rowCount - 1, base.row + dr)),
      col: Math.max(0, Math.min(this.sheet.colCount - 1, base.col + dc)),
    };
    this.pointFocus = focus;
    if (!extend || first) this.pointAnchor = { ...focus };
    this.writePointedRef();
  }

  /** Click (or drag with `extend`) on a cell while a reference may be inserted. */
  pointTo(viewRow: number, viewCol: number, extend: boolean): void {
    const wasPointing = this.isPointing;
    if (!wasPointing) {
      this.pointSpan = { start: this.textarea.selectionStart, end: this.textarea.selectionEnd };
    }
    this.pointFocus = { row: viewRow, col: viewCol };
    if (!(extend && wasPointing)) this.pointAnchor = { row: viewRow, col: viewCol };
    this.writePointedRef();
  }

  /** F4: relative <-> absolute for the reference at the caret. */
  toggleAbsolute(): void {
    const t = this.textarea;
    const wasPointing = this.isPointing;
    const result = cycleReference(t.value, t.selectionStart);
    if (result === null) return;
    t.value = result.text;
    t.setSelectionRange(result.end, result.end);
    this.pointSpan = wasPointing ? { start: result.start, end: result.end } : null;
    this.reposition();
    this.sheet.notify();
  }

  private writePointedRef(): void {
    const span = this.pointSpan;
    if (span === null) return;
    const { mapping } = this.sheet;
    const text = refToText(
      mapping.toDataRow(this.pointAnchor.row),
      mapping.toDataCol(this.pointAnchor.col),
      mapping.toDataRow(this.pointFocus.row),
      mapping.toDataCol(this.pointFocus.col),
    );
    this.textarea.setRangeText(text, span.start, span.end, 'end');
    this.pointSpan = { start: span.start, end: span.start + text.length };
    this.surface.scrollCellIntoView(this.pointFocus.row, this.pointFocus.col);
    this.reposition();
    this.sheet.notify();
  }

  get text(): string {
    return this.textarea.value;
  }

  focus(): void {
    this.textarea.focus({ preventScroll: true });
  }

  /** `text` is the initial content: '' for typing mode, the cell's text for F2/double-click. */
  begin(mode: EditMode, text: string): void {
    const { selection } = this.sheet;
    this.surface.scrollCellIntoView(selection.activeRow, selection.activeCol);
    this.editing = true;
    this.pointSpan = null;
    this.mode = mode;
    this.original = this.sheet.getEditText(selection.activeRow, selection.activeCol);
    this.textarea.value = text;
    this.focus();
    this.textarea.setSelectionRange(text.length, text.length);
    this.reposition();
    this.sheet.notify();
  }

  /** Writes the text into the cell (only when it changed) and leaves edit mode. */
  commit(): void {
    if (!this.editing) return;
    const text = this.textarea.value;
    this.end();
    const { selection } = this.sheet;
    if (text !== this.original) this.sheet.setCellInput(selection.activeRow, selection.activeCol, text);
  }

  cancel(): void {
    if (this.editing) this.end();
  }

  insertNewline(): void {
    const t = this.textarea;
    t.setRangeText('\n', t.selectionStart, t.selectionEnd, 'end');
    this.reposition();
  }

  reposition(): void {
    const { selection, rows, cols, styles } = this.sheet;
    const vp = this.surface.viewport;
    const r = selection.activeRow;
    const c = selection.activeCol;
    const left = vp.colLeft(c);
    const top = vp.rowTop(r);
    const cellW = cols.getSize(c);
    const cellH = rows.getSize(r);
    const style = styles.get(this.sheet.getCellByView(r, c).styleId);
    const font = fontFor(style.bold, style.italic);
    const t = this.textarea;

    this.refs = this.editing ? this.colorRefs(findReferences(t.value)) : [];

    if (!this.editing) {
      this.backdrop?.style.setProperty('display', 'none');
      t.style.cssText =
        `${BASE_STYLE}left:${left}px;top:${top}px;width:${cellW}px;height:${cellH}px;padding:0;` +
        `background:transparent;color:transparent;caret-color:transparent;pointer-events:none;font:${font};`;
      return;
    }

    const lines = t.value.split('\n');
    let width = 0;
    if (this.measureCtx !== null) {
      this.measureCtx.font = font;
      for (const line of lines) width = Math.max(width, this.measureCtx.measureText(line).width);
    }
    const lineHeight = Math.max(14, rows.defaultSize - 4);
    const maxWidth = Math.max(cellW, vp.width - left);
    const w = Math.min(maxWidth, Math.max(cellW, Math.ceil(width) + 16));
    const h = Math.max(cellH, lines.length * lineHeight + 4);
    // Formulas are drawn in a backdrop element behind a transparent textarea so each reference can have its own
    // color. Not during IME composition, when the textarea has to show its own text.
    const colored = t.value.startsWith('=') && !this.composing;
    const box = `${BASE_STYLE}left:${left}px;top:${top}px;width:${w}px;height:${h}px;padding:0 4px;font:${font};line-height:${lineHeight}px;`;
    t.style.cssText =
      `${box}background:${colored ? 'transparent' : theme.background};color:${colored ? 'transparent' : (style.color ?? theme.text)};` +
      `caret-color:${theme.text};border:2px solid ${theme.accent};pointer-events:auto;` +
      (colored ? '' : 'box-shadow:0 2px 6px rgba(0,0,0,0.25);');
    this.renderBackdrop(colored, `${box}background:${theme.background};color:${theme.text};border:2px solid transparent;pointer-events:none;box-shadow:0 2px 6px rgba(0,0,0,0.25);z-index:2;`);
  }

  private colorRefs(found: RefMatch[]): ColoredRef[] {
    const colorByRef = new Map<string, string>();
    return found.map((ref) => {
      // The same reference gets the same color wherever it appears, ignoring $ and case.
      const key = ref.text.replace(/\$/g, '').toUpperCase();
      let color = colorByRef.get(key);
      if (color === undefined) {
        color = REF_COLORS[colorByRef.size % REF_COLORS.length] as string;
        colorByRef.set(key, color);
      }
      return { ...ref, color };
    });
  }

  private renderBackdrop(visible: boolean, css: string): void {
    if (!visible) {
      this.backdrop?.style.setProperty('display', 'none');
      return;
    }
    if (this.backdrop === null) {
      this.backdrop = document.createElement('div');
      this.backdrop.setAttribute('aria-hidden', 'true');
      this.textarea.parentElement?.insertBefore(this.backdrop, this.textarea);
    }
    const el = this.backdrop;
    el.style.cssText = css;
    // Rebuilt from the current text on every change: formulas are short.
    el.replaceChildren();
    const text = this.textarea.value;
    let at = 0;
    for (const ref of this.refs) {
      if (ref.start > at) el.append(document.createTextNode(text.slice(at, ref.start)));
      const span = document.createElement('span');
      span.textContent = text.slice(ref.start, ref.end);
      span.style.color = ref.color;
      el.append(span);
      at = ref.end;
    }
    if (at < text.length) el.append(document.createTextNode(text.slice(at)));
  }

  private end(): void {
    this.editing = false;
    this.pointSpan = null;
    this.composing = false;
    this.textarea.value = '';
    this.reposition();
    this.focus();
    this.sheet.notify();
  }
}
