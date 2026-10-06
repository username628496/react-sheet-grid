import type { Cell } from '../core/model/Cell';
import { formatValue } from '../core/model/format';
import type { ViewRange } from '../core/selection/SelectionModel';
import type { Spreadsheet } from '../core/Spreadsheet';
import { parseHtmlTable, parseTsv, toHtmlTable, toTsv } from './clipboard';
import type { EditorController } from './EditorController';

interface InternalClip {
  rows: number;
  cols: number;
  cells: Cell[][];
  /** The plain text we wrote, used to recognise our own copy when it comes back. */
  text: string;
  source: ViewRange;
  cut: boolean;
}

export class ClipboardController {
  /** Range drawn with a dashed outline after copy/cut; cleared by Escape or any edit. */
  marquee: ViewRange | null = null;
  private clip: InternalClip | null = null;
  private marqueeVersion = 0;
  private readonly textarea: HTMLTextAreaElement;

  constructor(
    private readonly sheet: Spreadsheet,
    private readonly editor: EditorController,
  ) {
    this.textarea = editor.textarea;
    this.textarea.addEventListener('copy', this.onCopy);
    this.textarea.addEventListener('cut', this.onCut);
    this.textarea.addEventListener('paste', this.onPaste);
  }

  destroy(): void {
    this.textarea.removeEventListener('copy', this.onCopy);
    this.textarea.removeEventListener('cut', this.onCut);
    this.textarea.removeEventListener('paste', this.onPaste);
  }

  /** The marquee only makes sense for the data it was drawn on. */
  get visibleMarquee(): ViewRange | null {
    if (this.marquee !== null && this.marqueeVersion !== this.sheet.history.version) this.marquee = null;
    return this.marquee;
  }

  clearMarquee(): void {
    if (this.marquee === null) return;
    this.marquee = null;
    this.sheet.notify();
  }

  /** For the context menu: runs the browser's own copy/cut so the normal event handlers produce the data. */
  exec(command: 'copy' | 'cut'): void {
    this.editor.focus();
    document.execCommand(command);
  }

  /** For the context menu: reads the system clipboard (needs the user's permission) and pastes. */
  async pasteFromSystem(): Promise<void> {
    try {
      let html = '';
      let text = '';
      for (const item of await navigator.clipboard.read()) {
        if (item.types.includes('text/html')) html = await (await item.getType('text/html')).text();
        if (item.types.includes('text/plain')) text = await (await item.getType('text/plain')).text();
      }
      this.paste(html, text);
    } catch {
      // Permission denied or API missing (Firefox): fall back to plain text, else the user can press Ctrl+V.
      try {
        this.paste('', await navigator.clipboard.readText());
      } catch {
        /* nothing more to try */
      }
    }
  }

  private copyData(cut: boolean): InternalClip | null {
    const range = this.sheet.selection.primary;
    const { rows, cols, cells } = this.sheet.readCells(range);
    if (rows === 0 || cols === 0) return null;
    const text = cells.map((line) => line.map((cell) => formatValue(cell.value, this.sheet.styles.get(cell.styleId).numberFormat)));
    return { rows, cols, cells, text: toTsv(text), source: range, cut };
  }

  private write(e: ClipboardEvent, clip: InternalClip): void {
    const display = clip.cells.map((line) =>
      line.map((cell) => formatValue(cell.value, this.sheet.styles.get(cell.styleId).numberFormat)),
    );
    const styles = clip.cells.map((line) => line.map((cell) => this.sheet.styles.get(cell.styleId)));
    e.clipboardData?.setData('text/plain', clip.text);
    e.clipboardData?.setData('text/html', toHtmlTable(display, styles));
    e.preventDefault();
    this.clip = clip;
    this.marquee = this.sheet.selection.primary;
    this.marqueeVersion = this.sheet.history.version;
    this.sheet.notify();
  }

  private readonly onCopy = (e: ClipboardEvent): void => {
    if (this.editor.editing) return; // native copy inside the cell editor
    const clip = this.copyData(false);
    if (clip !== null) this.write(e, clip);
  };

  private readonly onCut = (e: ClipboardEvent): void => {
    if (this.editor.editing) return;
    const clip = this.copyData(true);
    if (clip !== null) this.write(e, clip);
  };

  private readonly onPaste = (e: ClipboardEvent): void => {
    if (this.editor.editing) return;
    e.preventDefault();
    this.paste(e.clipboardData?.getData('text/html') ?? '', e.clipboardData?.getData('text/plain') ?? '');
  };

  private paste(html: string, text: string): void {
    const { sheet } = this;
    const clip = this.clip;
    if (clip !== null && text !== '' && text === clip.text) {
      // Our own copy: keep formulas and formatting instead of round-tripping through text.
      sheet.pasteMatrix(clip.rows, clip.cols, (i, j) => (clip.cells[i]?.[j] as Cell), clip.cut ? clip.source : null);
      if (clip.cut) {
        this.clip = null;
        this.marquee = null;
      }
    } else {
      // Other apps: prefer HTML (richer, exact cell boundaries), fall back to plain text.
      const matrix = (html !== '' ? parseHtmlTable(html) : null) ?? (text !== '' ? parseTsv(text) : null);
      if (matrix === null) return;
      sheet.pasteText(matrix);
    }
  }
}
