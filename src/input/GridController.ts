import type { Spreadsheet } from '../core/Spreadsheet';
import { drawSelection } from '../render/layers/selectionLayer';
import type { GridSurface } from '../render/GridSurface';
import { drawCopyMarquee, drawFindMatches, drawFormulaRef } from '../render/layers/selectionLayer';
import { ClipboardController } from './ClipboardController';
import { EditorController } from './EditorController';
import { FindSession } from './FindSession';
import { FormatPainter } from './FormatPainter';
import { KeyboardController } from './KeyboardController';
import { MouseController } from './MouseController';

/** Wires the surface, the hidden editor textarea and the mouse/keyboard controllers together. */
export class GridController {
  readonly editor: EditorController;
  readonly mouse: MouseController;
  readonly keyboard: KeyboardController;
  readonly clipboard: ClipboardController;
  readonly painter: FormatPainter;
  readonly find: FindSession;
  /** Set by the host to show its shortcut help (Mod+/). */
  onShowShortcuts: (() => void) | null = null;
  /** Set by the host to open its "filter by values" dialog for a column, anchored at viewport coordinates. */
  /** Set by the host to show the Find / Replace panel (Mod+F, Mod+H). */
  onOpenFind: ((replace: boolean) => void) | null = null;
  /** Set by the host to show the choices of a list cell (clicking its arrow, Alt+Down). */
  onOpenList: ((viewRow: number, viewCol: number) => void) | null = null;
  /** Set by the host to show its data validation dialog for the selection. */
  onOpenValidation: (() => void) | null = null;
  onOpenFilter: ((viewCol: number, x: number, y: number) => void) | null = null;
  private readonly unsubscribe: Array<() => void> = [];

  constructor(
    readonly surface: GridSurface,
    readonly sheet: Spreadsheet,
    textarea: HTMLTextAreaElement,
  ) {
    this.editor = new EditorController(textarea, sheet, surface);
    this.mouse = new MouseController({ sheet, surface, editor: this.editor, openList: (r, c) => this.onOpenList?.(r, c) });
    this.clipboard = new ClipboardController(sheet, this.editor);
    this.painter = new FormatPainter(sheet, surface);
    this.find = new FindSession(sheet, surface);
    this.keyboard = new KeyboardController({ sheet, surface, editor: this.editor, clipboard: this.clipboard, showShortcuts: () => this.onShowShortcuts?.(), openFind: (replace) => this.onOpenFind?.(replace), openList: () => this.onOpenList?.(sheet.selection.activeRow, sheet.selection.activeCol) });

    surface.renderer.highlight = {
      isRowSelected: (r) => sheet.selection.isRowSelected(r),
      isColSelected: (c) => sheet.selection.isColSelected(c),
      colMark: (c) => {
        const dir = sheet.sortDirection(c);
        const filtered = sheet.isColumnFiltered(c);
        if (dir === null && !filtered) return null;
        return `${dir === 'asc' ? '↑' : dir === 'desc' ? '↓' : ''}${filtered ? '▾' : ''}`;
      },
    };
    surface.renderer.overlay = (ctx, rowSeg, colSeg) => {
      drawSelection(ctx, sheet, sheet.selection, rowSeg, colSeg, !this.editor.editing);
      const marquee = this.clipboard.visibleMarquee;
      if (marquee !== null) drawCopyMarquee(ctx, sheet, marquee, rowSeg, colSeg);
      for (const ref of this.editor.refs) {
        // Formulas hold data coordinates; the grid is drawn in view coordinates.
        const { mapping } = sheet;
        const startRow = mapping.toViewRow(ref.r1);
        const endRow = mapping.toViewRow(ref.r2);
        if (startRow < 0 || endRow < 0) continue;
        drawFormulaRef(ctx, sheet, { startRow, endRow, startCol: mapping.toViewCol(ref.c1), endCol: mapping.toViewCol(ref.c2) }, ref.color, rowSeg, colSeg);
      }
      if (this.find.isOpen) drawFindMatches(ctx, sheet, this.find, rowSeg, colSeg);
      const fill = this.mouse.fillPreview;
      if (fill !== null) drawCopyMarquee(ctx, sheet, fill, rowSeg, colSeg);
    };

    // The textarea follows the active cell through selection changes, resizes and scrolling.
    const reposition = (): void => this.editor.reposition();
    this.unsubscribe.push(sheet.subscribe(reposition), surface.subscribeView(reposition));
  }

  destroy(): void {
    for (const off of this.unsubscribe) off();
    this.mouse.destroy();
    this.editor.destroy();
    this.keyboard.destroy();
    this.clipboard.destroy();
    this.painter.destroy();
    this.find.destroy();
    this.surface.renderer.overlay = null;
    this.surface.renderer.highlight = null;
  }
}
