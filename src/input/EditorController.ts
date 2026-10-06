import type { Spreadsheet } from '../core/Spreadsheet';
import type { GridSurface } from '../render/GridSurface';
import { fontFor, theme } from '../render/theme';

export type EditMode = 'typing' | 'caret';

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
  private original = '';
  private readonly measureCtx: CanvasRenderingContext2D | null;

  constructor(
    readonly textarea: HTMLTextAreaElement,
    private readonly sheet: Spreadsheet,
    private readonly surface: GridSurface,
  ) {
    this.measureCtx = document.createElement('canvas').getContext('2d');
    this.reposition();
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

    if (!this.editing) {
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
    t.style.cssText =
      `${BASE_STYLE}left:${left}px;top:${top}px;width:${w}px;height:${h}px;padding:0 4px;` +
      `background:${theme.background};color:${style.color ?? theme.text};caret-color:${theme.text};` +
      `border:2px solid ${theme.accent};pointer-events:auto;font:${font};line-height:${lineHeight}px;` +
      'box-shadow:0 2px 6px rgba(0,0,0,0.25);';
  }

  private end(): void {
    this.editing = false;
    this.textarea.value = '';
    this.reposition();
    this.focus();
    this.sheet.notify();
  }
}
