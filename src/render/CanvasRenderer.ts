import type { Spreadsheet } from '../core/Spreadsheet';
import { drawCellBackgrounds, drawCellText, FontCache } from './layers/cellsLayer';
import { drawGridLines } from './layers/gridLayer';
import { drawHeaders, type HeaderHighlight } from './layers/headersLayer';
import { TextMeasurer } from './textMeasure';
import { theme } from './theme';
import type { Segment, Viewport } from './viewport';

/** Extra per-region drawing hook (selection, fill handle) supplied by the controller layer. */
export type RegionOverlay = (
  ctx: CanvasRenderingContext2D,
  rowSeg: Segment,
  colSeg: Segment,
) => void;

export class CanvasRenderer {
  highlight: HeaderHighlight | null = null;
  overlay: RegionOverlay | null = null;

  private readonly ctx: CanvasRenderingContext2D;
  private readonly measurer: TextMeasurer;
  private readonly fonts: FontCache;
  private frame = 0;
  private cssWidth = 0;
  private cssHeight = 0;
  private dpr = 1;
  private zoom = 1;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly sheet: Spreadsheet,
    private readonly viewport: Viewport,
  ) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (ctx === null) throw new Error('2D canvas is not available');
    this.ctx = ctx;
    this.measurer = new TextMeasurer(ctx);
    this.fonts = new FontCache(sheet);
  }

  /** Sizes the backing store by devicePixelRatio, otherwise text is blurry on Retina. */
  resize(cssWidth: number, cssHeight: number, dpr: number): void {
    this.cssWidth = cssWidth;
    this.cssHeight = cssHeight;
    this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(cssWidth * dpr));
    this.canvas.height = Math.max(1, Math.round(cssHeight * dpr));
    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${cssHeight}px`;
    this.invalidate();
  }

  /** Draws everything scaled: layout stays in logical pixels and the canvas transform does the zooming. */
  setZoom(zoom: number): void {
    this.zoom = zoom;
    this.invalidate();
  }

  /** Width of `text` in `font`, through the same cache the drawing code uses. */
  measure(font: string, text: string): number {
    return this.measurer.measure(font, text);
  }

  /** Coalesces any number of changes into one draw per animation frame. */
  invalidate(): void {
    if (this.frame !== 0) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  dispose(): void {
    if (this.frame !== 0) cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  draw(): void {
    const { ctx, viewport: vp, sheet } = this;
    const scale = this.dpr * this.zoom;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.fillStyle = theme.background;
    ctx.fillRect(0, 0, this.cssWidth / this.zoom, this.cssHeight / this.zoom);
    vp.updateSegments();

    for (const rowSeg of vp.rowSegments) {
      if (rowSeg.last < rowSeg.first) continue;
      for (const colSeg of vp.colSegments) {
        if (colSeg.last < colSeg.first) continue;
        ctx.save();
        ctx.beginPath();
        ctx.rect(colSeg.clipStart, rowSeg.clipStart, colSeg.clipEnd - colSeg.clipStart, rowSeg.clipEnd - rowSeg.clipStart);
        ctx.clip();
        drawCellBackgrounds(ctx, sheet, rowSeg, colSeg);
        drawGridLines(ctx, sheet, rowSeg, colSeg);
        drawCellText(ctx, sheet, rowSeg, colSeg, this.measurer, this.fonts);
        this.overlay?.(ctx, rowSeg, colSeg);
        ctx.restore();
      }
    }

    this.drawFreezeLines();
    drawHeaders(ctx, sheet, vp, this.highlight);
  }

  private drawFreezeLines(): void {
    const { ctx, viewport: vp } = this;
    ctx.fillStyle = theme.freezeLine;
    if (vp.frozenCols > 0) ctx.fillRect(Math.floor(vp.headerWidth + vp.frozenWidth) - 1, 0, 2, this.cssHeight / this.zoom);
    if (vp.frozenRows > 0) ctx.fillRect(0, Math.floor(vp.headerHeight + vp.frozenHeight) - 1, this.cssWidth / this.zoom, 2);
  }
}
