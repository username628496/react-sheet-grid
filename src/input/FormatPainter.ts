import type { Spreadsheet } from '../core/Spreadsheet';
import type { GridSurface } from '../render/GridSurface';

/**
 * "Paint format": remembers the look of the selected cells, then the next selection made with the mouse on the grid
 * receives it (tiled when the target is larger, as a paste would). It stays armed until that happens; Escape, a mouse
 * release outside the grid, or the same button cancels it. Contents are never touched, only formatting.
 */
export class FormatPainter {
  armed = false;
  private pattern: number[][] = [];

  constructor(
    private readonly sheet: Spreadsheet,
    private readonly surface: GridSurface,
  ) {}

  toggle(): void {
    if (this.armed) this.disarm();
    else this.arm();
  }

  private arm(): void {
    const { cells } = this.sheet.readCells(this.sheet.selection.primary);
    this.pattern = cells.map((line) => line.map((cell) => cell.styleId));
    if (this.pattern.length === 0) return;
    this.armed = true;
    window.addEventListener('mouseup', this.onMouseUp, true);
    window.addEventListener('keydown', this.onKeyDown, true);
    this.sheet.notify();
  }

  disarm(): void {
    if (!this.armed) return;
    this.armed = false;
    window.removeEventListener('mouseup', this.onMouseUp, true);
    window.removeEventListener('keydown', this.onKeyDown, true);
    this.sheet.notify();
  }

  private readonly onMouseUp = (e: MouseEvent): void => {
    if (!(e.target instanceof Node) || !this.surface.host.contains(e.target)) {
      // A release on the toolbar is the click that armed us, or a button press that has its own meaning.
      if (e.target instanceof Node && (e.target as Element).closest?.('[data-testid=toolbar]') !== null) return;
      this.disarm();
      return;
    }
    // After the mouse controller has finished the drag, so the selection is final.
    setTimeout(() => this.apply(), 0);
  };

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') this.disarm();
  };

  private apply(): void {
    if (!this.armed) return;
    const pattern = this.pattern;
    this.disarm();
    const rows = pattern.length;
    const cols = pattern[0]?.length ?? 0;
    this.sheet.pasteMatrix(rows, cols, (i, j, existing) => ({ ...existing, styleId: pattern[i]?.[j] ?? existing.styleId }));
  }

  destroy(): void {
    this.disarm();
  }
}
