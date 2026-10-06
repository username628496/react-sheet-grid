import type { Spreadsheet } from '../core/Spreadsheet';
import { CanvasRenderer } from './CanvasRenderer';
import { computeScrollMetrics, Viewport, type ScrollMetrics } from './viewport';

export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 2;

export interface SurfaceOptions {
  frozenRows?: number;
  frozenCols?: number;
}

/**
 * Owns the DOM for the grid: a canvas for drawing and a transparent native
 * scroll host stacked on top of it. Native scrolling gives us scrollbars,
 * wheel and touch behaviour for free; the canvas just redraws from the
 * logical scroll position. Scroll state lives here, never in React state.
 */
export class GridSurface {
  readonly canvas: HTMLCanvasElement;
  readonly host: HTMLDivElement;
  readonly viewport: Viewport;
  readonly renderer: CanvasRenderer;

  private readonly spacer: HTMLDivElement;
  private readonly resizeObserver: ResizeObserver;
  private readonly unsubscribeSheet: () => void;
  private readonly viewListeners = new Set<() => void>();
  private metricsX: ScrollMetrics = { physical: 0, scale: 1 };
  private metricsY: ScrollMetrics = { physical: 0, scale: 1 };
  private hostLeft = 0;
  private hostTop = 0;
  private zoomLevel = 1;
  private readonly zoomListeners = new Set<(zoom: number) => void>();

  constructor(
    private readonly mount: HTMLElement,
    private readonly sheet: Spreadsheet,
    options: SurfaceOptions = {},
  ) {
    this.viewport = new Viewport(sheet.rows, sheet.cols);
    if (options.frozenRows !== undefined || options.frozenCols !== undefined) {
      sheet.setFrozen(options.frozenRows ?? sheet.frozenRows, options.frozenCols ?? sheet.frozenCols);
    }
    this.viewport.frozenRows = sheet.frozenRows;
    this.viewport.frozenCols = sheet.frozenCols;
    // Wide enough for the largest row number plus padding.
    this.viewport.headerWidth = Math.max(46, String(sheet.rowCount).length * 8 + 22);

    mount.style.position = 'relative';
    mount.style.overflow = 'hidden';

    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'position:absolute;left:0;top:0;display:block;';
    // Pixels carry no meaning for assistive technology; the live region and the editor describe the active cell instead.
    this.canvas.setAttribute('aria-hidden', 'true');
    this.host = document.createElement('div');
    this.host.style.cssText = 'position:absolute;inset:0;overflow:scroll;';
    // Scrollable regions are keyboard-focusable in some browsers; focus belongs to the editor textarea only.
    this.host.tabIndex = -1;
    this.host.setAttribute('aria-hidden', 'true');
    this.spacer = document.createElement('div');
    this.spacer.style.cssText = 'width:1px;height:1px;';
    this.host.appendChild(this.spacer);
    mount.append(this.canvas, this.host);

    this.renderer = new CanvasRenderer(this.canvas, sheet, this.viewport);
    this.host.addEventListener('scroll', this.onHostScroll, { passive: true });
    this.resizeObserver = new ResizeObserver(() => this.measure());
    this.resizeObserver.observe(mount);
    this.unsubscribeSheet = sheet.subscribe(() => {
      this.syncFrozen();
      this.updateExtent();
      this.renderer.invalidate();
    });
    this.measure();
  }

  // The frozen counts live in the sheet (they are part of the document); the viewport only mirrors them.
  private syncFrozen(): void {
    const vp = this.viewport;
    if (vp.frozenRows === this.sheet.frozenRows && vp.frozenCols === this.sheet.frozenCols) return;
    vp.frozenRows = this.sheet.frozenRows;
    vp.frozenCols = this.sheet.frozenCols;
    vp.clampScroll();
    this.applyScrollToHost();
    this.emitView();
  }

  /** Screen pixels per logical pixel (1 = 100%). */
  get zoom(): number {
    return this.zoomLevel;
  }

  /**
   * Zooms between 50% and 200% in steps of 5%. Layout, selection and scroll stay in logical pixels (so the data and
   * every size are untouched); only the drawing, the native scroll extent, the mouse mapping and the editor box
   * are scaled. The cell at the top-left of the scrolling area stays where it is.
   */
  setZoom(zoom: number): void {
    const next = Math.round(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Number.isFinite(zoom) ? zoom : 1)) * 20) / 20;
    if (next === this.zoomLevel) return;
    this.zoomLevel = next;
    this.viewport.zoom = next;
    this.renderer.setZoom(next);
    this.measure();
    for (const listener of this.zoomListeners) listener(next);
    this.sheet.notify();
  }

  subscribeZoom(listener: (zoom: number) => void): () => void {
    this.zoomListeners.add(listener);
    return () => this.zoomListeners.delete(listener);
  }

  /** Called whenever scroll position or size changes (used to reposition the cell editor). */
  subscribeView(listener: () => void): () => void {
    this.viewListeners.add(listener);
    return () => this.viewListeners.delete(listener);
  }

  invalidate(): void {
    this.renderer.invalidate();
  }

  scrollCellIntoView(viewRow: number, viewCol: number): void {
    if (this.viewport.scrollIntoView(viewRow, viewCol)) {
      this.applyScrollToHost();
      this.renderer.invalidate();
      this.emitView();
    }
  }

  scrollBy(dx: number, dy: number): void {
    const vp = this.viewport;
    vp.scrollX += dx;
    vp.scrollY += dy;
    vp.clampScroll();
    this.applyScrollToHost();
    this.renderer.invalidate();
    this.emitView();
  }

  destroy(): void {
    this.resizeObserver.disconnect();
    this.unsubscribeSheet();
    this.renderer.dispose();
    this.host.removeEventListener('scroll', this.onHostScroll);
    this.canvas.remove();
    this.host.remove();
  }

  private measure(): void {
    const width = this.mount.clientWidth;
    const height = this.mount.clientHeight;
    const vp = this.viewport;
    vp.width = (this.host.clientWidth || width) / this.zoomLevel;
    vp.height = (this.host.clientHeight || height) / this.zoomLevel;
    this.renderer.resize(width, height, window.devicePixelRatio || 1);
    this.updateExtent();
    this.emitView();
  }

  private updateExtent(): void {
    const vp = this.viewport;
    vp.clampScroll();
    // The native scroll extent is in screen pixels, i.e. the logical distance times the zoom.
    this.metricsX = computeScrollMetrics(vp.maxScrollX * this.zoomLevel);
    this.metricsY = computeScrollMetrics(vp.maxScrollY * this.zoomLevel);
    this.spacer.style.width = `${this.host.clientWidth + this.metricsX.physical}px`;
    this.spacer.style.height = `${this.host.clientHeight + this.metricsY.physical}px`;
    this.applyScrollToHost();
  }

  private applyScrollToHost(): void {
    const vp = this.viewport;
    vp.scrollX = Math.round(vp.scrollX);
    vp.scrollY = Math.round(vp.scrollY);
    this.host.scrollLeft = (vp.scrollX * this.zoomLevel) / this.metricsX.scale;
    this.host.scrollTop = (vp.scrollY * this.zoomLevel) / this.metricsY.scale;
    // Read back: the browser rounds/clamps, and the scroll handler must not mistake that for user input.
    this.hostLeft = this.host.scrollLeft;
    this.hostTop = this.host.scrollTop;
  }

  private readonly onHostScroll = (): void => {
    const vp = this.viewport;
    const left = this.host.scrollLeft;
    const top = this.host.scrollTop;
    if (left === this.hostLeft && top === this.hostTop) return;
    this.hostLeft = left;
    this.hostTop = top;
    vp.scrollX = left >= this.metricsX.physical - 1 ? vp.maxScrollX : Math.round((left * this.metricsX.scale) / this.zoomLevel);
    vp.scrollY = top >= this.metricsY.physical - 1 ? vp.maxScrollY : Math.round((top * this.metricsY.scale) / this.zoomLevel);
    vp.clampScroll();
    this.renderer.invalidate();
    this.emitView();
  };

  private emitView(): void {
    for (const listener of this.viewListeners) listener();
  }
}
