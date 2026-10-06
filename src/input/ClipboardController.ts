import type { Cell } from '../core/model/Cell';
import { formatValue } from '../core/model/format';
import { rebaseFormula } from '../formula/transform';
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

/** The slice of DataTransfer the controller needs; lets tests drive it without synthetic clipboard events. */
export interface ClipboardWriter {
  setData(format: string, data: string): void;
}
export interface ClipboardReader {
  getData(format: string): string;
}

export class ClipboardController {
  /** Range drawn with a dashed outline after copy/cut; cleared by Escape or any edit. */
  marquee: ViewRange | null = null;
  private clip: InternalClip | null = null;
  private pasteMode: 'normal' | 'values' | 'format' = 'normal';
  private valuesOnlyTimer: ReturnType<typeof setTimeout> | null = null;
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
    if (this.valuesOnlyTimer !== null) clearTimeout(this.valuesOnlyTimer);
    this.valuesOnlyTimer = null;
  }

  /**
   * Cmd/Ctrl+Shift+V (values only) and Cmd/Ctrl+Alt+V (format only). Some browsers fire a normal paste event
   * for these shortcuts and some do not, so the next paste is marked and, if no paste event shows up shortly,
   * the system clipboard is read.
   */
  armPaste(mode: 'values' | 'format'): void {
    this.pasteMode = mode;
    if (this.valuesOnlyTimer !== null) clearTimeout(this.valuesOnlyTimer);
    this.valuesOnlyTimer = setTimeout(() => {
      this.valuesOnlyTimer = null;
      if (this.pasteMode !== 'normal') void this.pasteFromSystem();
    }, 150);
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

  private write(data: ClipboardWriter, clip: InternalClip): void {
    const display = clip.cells.map((line) =>
      line.map((cell) => formatValue(cell.value, this.sheet.styles.get(cell.styleId).numberFormat)),
    );
    const styles = clip.cells.map((line) => line.map((cell) => this.sheet.styles.get(cell.styleId)));
    data.setData('text/plain', clip.text);
    data.setData('text/html', toHtmlTable(display, styles));
    this.clip = clip;
    this.marquee = this.sheet.selection.primary;
    this.marqueeVersion = this.sheet.history.version;
    this.sheet.notify();
  }

  /** Writes the selection into `data`. Returns false when there is nothing to copy. */
  copyTo(data: ClipboardWriter): boolean {
    const clip = this.copyData(false);
    if (clip === null) return false;
    this.write(data, clip);
    return true;
  }

  /** Like copyTo, but the source is cleared when the data is pasted (a move). */
  cutTo(data: ClipboardWriter): boolean {
    if (this.sheet.readOnly) return false;
    const clip = this.copyData(true);
    if (clip === null) return false;
    this.write(data, clip);
    return true;
  }

  /** Pastes from `data`, preferring text/html over text/plain. */
  pasteFrom(data: ClipboardReader): void {
    this.paste(data.getData('text/html'), data.getData('text/plain'));
  }

  private readonly onCopy = (e: ClipboardEvent): void => {
    if (this.editor.editing) return; // native copy inside the cell editor
    if (e.clipboardData !== null && this.copyTo(e.clipboardData)) e.preventDefault();
  };

  private readonly onCut = (e: ClipboardEvent): void => {
    if (this.editor.editing) return;
    if (e.clipboardData !== null && this.cutTo(e.clipboardData)) e.preventDefault();
  };

  private readonly onPaste = (e: ClipboardEvent): void => {
    if (this.editor.editing || e.clipboardData === null) return;
    e.preventDefault();
    this.pasteFrom(e.clipboardData);
  };

  private paste(html: string, text: string): void {
    const { sheet } = this;
    if (sheet.readOnly) return;
    const clip = this.clip;
    const mode = this.pasteMode;
    this.pasteMode = 'normal';
    const valuesOnly = mode === 'values';
    if (this.valuesOnlyTimer !== null) clearTimeout(this.valuesOnlyTimer);
    this.valuesOnlyTimer = null;
    if (mode === 'format' && (clip === null || text !== clip.text)) return; // formats only exist in our own copies
    // An empty text is still our own copy when the cells copied held no value (only formatting, e.g. a border or fill).
    if (clip !== null && text === clip.text) {
      // Our own copy: keep formulas and formatting instead of round-tripping through text.
      sheet.pasteMatrix(
        clip.rows,
        clip.cols,
        (i, j, existing, dataRow, dataCol) => {
          const cell = clip.cells[i]?.[j] as Cell;
          // Values only: the computed result, in the target's own formatting.
          if (valuesOnly) return { value: cell.value, styleId: existing.styleId };
          // Format only: the target keeps its content (and formula) and takes the source's formatting.
          if (mode === 'format') return { ...existing, styleId: cell.styleId };
          if (!clip.cut || cell.formula === undefined) return cell; // a copied formula adapts to its new place via relative refs
          // A moved formula keeps pointing at the same cells, so it is rebased rather than shifted.
          const fromRow = sheet.mapping.toDataRow(clip.source.startRow + i);
          const fromCol = sheet.mapping.toDataCol(clip.source.startCol + j);
          return { ...cell, formula: rebaseFormula(cell.formula, fromRow, fromCol, dataRow, dataCol) };
        },
        clip.cut && mode === 'normal' ? clip.source : null,
      );
      if (clip.cut && mode === 'normal') {
        this.clip = null;
        this.marquee = null;
      }
    } else {
      // Other apps: prefer HTML (richer, exact cell boundaries), fall back to plain text.
      const matrix = (!valuesOnly && html !== '' ? parseHtmlTable(html) : null) ?? (text !== '' ? parseTsv(text) : null);
      if (matrix === null) return;
      sheet.pasteText(matrix);
    }
  }
}
