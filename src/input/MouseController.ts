import { ResizeCommand } from '../core/commands/ResizeCommand';
import { formatValue } from '../core/model/format';
import { fontFor, theme } from '../render/theme';
import type { AxisLayout } from '../core/layout/AxisLayout';
import type { FillDirection } from '../core/fill';
import type { ViewRange } from '../core/selection/SelectionModel';
import type { Spreadsheet } from '../core/Spreadsheet';
import type { GridSurface } from '../render/GridSurface';
import type { EditorController } from './EditorController';

const RESIZE_SLOP = 4;
const MIN_COL_WIDTH = 20;
const MIN_ROW_HEIGHT = 8;

type Hit =
  | { zone: 'corner' }
  | { zone: 'colHeader'; col: number }
  | { zone: 'rowHeader'; row: number }
  | { zone: 'colResize'; col: number }
  | { zone: 'rowResize'; row: number }
  | { zone: 'fillHandle' }
  | { zone: 'cell'; row: number; col: number }
  | { zone: 'none' };

type Drag =
  | { kind: 'cell' }
  | { kind: 'col' }
  | { kind: 'row' }
  | { kind: 'point' }
  | { kind: 'fill'; source: ViewRange }
  | { kind: 'resize'; axis: 'col' | 'row'; indices: number[]; startPos: number; startSize: number };

export interface MouseDeps {
  sheet: Spreadsheet;
  surface: GridSurface;
  editor: EditorController;
}

export class MouseController {
  /** Dashed outline of source + area that would be filled; read by the overlay while dragging the handle. */
  fillPreview: ViewRange | null = null;
  private fillPlan: { direction: FillDirection; count: number } | null = null;
  private drag: Drag | null = null;
  private lastX = 0;
  private lastY = 0;
  private autoScroll: ReturnType<typeof setInterval> | null = null;
  private readonly host: HTMLElement;

  constructor(private readonly deps: MouseDeps) {
    this.host = deps.surface.host;
    this.host.addEventListener('mousedown', this.onMouseDown);
    this.host.addEventListener('mousemove', this.onHover);
    this.host.addEventListener('dblclick', this.onDoubleClick);
    this.host.addEventListener('contextmenu', this.onContextMenu);
  }

  destroy(): void {
    this.host.removeEventListener('mousedown', this.onMouseDown);
    this.host.removeEventListener('mousemove', this.onHover);
    this.host.removeEventListener('dblclick', this.onDoubleClick);
    this.host.removeEventListener('contextmenu', this.onContextMenu);
    this.stopDrag();
  }

  /** Called with the cell under a right click, after the selection was adjusted. Set by the context menu. */
  onContext: ((clientX: number, clientY: number) => void) | null = null;

  /** Position inside the grid in logical pixels: screen pixels divided by the zoom, so hit tests need no zoom logic. */
  private local(e: MouseEvent): { x: number; y: number } {
    const rect = this.host.getBoundingClientRect();
    const zoom = this.deps.surface.zoom;
    return { x: (e.clientX - rect.left) / zoom, y: (e.clientY - rect.top) / zoom };
  }

  private onScrollbar(x: number, y: number): boolean {
    const zoom = this.deps.surface.zoom;
    return x * zoom >= this.host.clientWidth || y * zoom >= this.host.clientHeight;
  }

  private locate(x: number, y: number): Hit {
    const vp = this.deps.surface.viewport;
    const { rows, cols } = this.deps.sheet;
    if (x < vp.headerWidth && y < vp.headerHeight) return { zone: 'corner' };
    if (y < vp.headerHeight) {
      const col = vp.colAt(x);
      if (col < 0) return { zone: 'none' };
      const resize = this.edgeHit(x, vp.colLeft(col), cols.getSize(col), col, vp.frozenCols, vp.headerWidth + vp.frozenWidth, cols);
      if (resize !== null) return { zone: 'colResize', col: resize };
      return { zone: 'colHeader', col };
    }
    if (x < vp.headerWidth) {
      const row = vp.rowAt(y);
      if (row < 0) return { zone: 'none' };
      const resize = this.edgeHit(y, vp.rowTop(row), rows.getSize(row), row, vp.frozenRows, vp.headerHeight + vp.frozenHeight, rows);
      if (resize !== null) return { zone: 'rowResize', row: resize };
      return { zone: 'rowHeader', row };
    }
    if (this.overFillHandle(x, y)) return { zone: 'fillHandle' };
    const row = vp.rowAt(y);
    const col = vp.colAt(x);
    return row < 0 || col < 0 ? { zone: 'none' } : { zone: 'cell', row, col };
  }

  private overFillHandle(x: number, y: number): boolean {
    const { sheet, editor, surface } = this.deps;
    if (editor.editing || sheet.readOnly) return false; // nothing to fill in a read-only sheet
    const vp = surface.viewport;
    const p = sheet.selection.primary;
    const right = vp.colLeft(p.endCol) + sheet.cols.getSize(p.endCol);
    const bottom = vp.rowTop(p.endRow) + sheet.rows.getSize(p.endRow);
    // A corner scrolled underneath the frozen area or the headers is not grabbable.
    if (right < vp.headerWidth || bottom < vp.headerHeight) return false;
    if (p.endCol >= vp.frozenCols && right < vp.headerWidth + vp.frozenWidth) return false;
    if (p.endRow >= vp.frozenRows && bottom < vp.headerHeight + vp.frozenHeight) return false;
    return Math.abs(x - right) <= 5 && Math.abs(y - bottom) <= 5;
  }

  // Returns the index whose trailing edge is under `pos`, if close enough to grab.
  private edgeHit(
    pos: number,
    start: number,
    size: number,
    index: number,
    frozenCount: number,
    scrollStart: number,
    layout: AxisLayout,
  ): number | null {
    const visible = (i: number, edge: number): boolean => i < frozenCount || edge >= scrollStart;
    const end = start + size;
    if (Math.abs(pos - end) <= RESIZE_SLOP && visible(index, end)) return index;
    if (index > 0 && Math.abs(pos - start) <= RESIZE_SLOP && layout.getSize(index - 1) > 0 && visible(index - 1, start)) {
      return index - 1;
    }
    return null;
  }

  private readonly onMouseDown = (e: MouseEvent): void => {
    if (e.button !== 0) return;
    const { x, y } = this.local(e);
    if (this.onScrollbar(x, y)) return;
    const { sheet, editor } = this.deps;
    const { selection } = sheet;
    // Keep focus on the hidden textarea; also stops native text selection while dragging.
    e.preventDefault();
    // While typing a formula, clicking a cell inserts a reference to it instead of ending the edit.
    if (editor.editing && editor.canPoint()) {
      const pre = this.locate(x, y);
      if (pre.zone === 'cell') {
        editor.pointTo(pre.row, pre.col, e.shiftKey);
        this.lastX = x;
        this.lastY = y;
        this.startDrag({ kind: 'point' });
        return;
      }
    }
    editor.commit();
    editor.focus();
    const additive = e.metaKey || e.ctrlKey;
    const hit = this.locate(x, y);
    this.lastX = x;
    this.lastY = y;
    switch (hit.zone) {
      case 'corner':
        selection.selectAll();
        return;
      case 'colHeader':
        selection.selectCol(hit.col, e.shiftKey, additive);
        this.startDrag({ kind: 'col' });
        return;
      case 'rowHeader':
        selection.selectRow(hit.row, e.shiftKey, additive);
        this.startDrag({ kind: 'row' });
        return;
      case 'colResize':
      case 'rowResize': {
        const axis = hit.zone === 'colResize' ? 'col' : 'row';
        const index = hit.zone === 'colResize' ? hit.col : hit.row;
        const layout = axis === 'col' ? sheet.cols : sheet.rows;
        this.startDrag({
          kind: 'resize',
          axis,
          indices: this.resizeTargets(axis, index),
          startPos: axis === 'col' ? x : y,
          startSize: layout.getSize(index),
        });
        return;
      }
      case 'fillHandle':
        this.startDrag({ kind: 'fill', source: selection.primary });
        return;
      case 'cell':
        if (e.shiftKey) selection.extendTo(hit.row, hit.col);
        else if (additive) selection.addCell(hit.row, hit.col);
        else selection.selectCell(hit.row, hit.col);
        this.startDrag({ kind: 'cell' });
        return;
      default:
        return;
    }
  };

  // Resizing a column that is part of a whole-column selection resizes all selected columns.
  private resizeTargets(axis: 'col' | 'row', index: number): number[] {
    const { sheet } = this.deps;
    const p = sheet.selection.primary;
    if (axis === 'col') {
      const full = p.startRow === 0 && p.endRow === sheet.rowCount - 1;
      if (full && index >= p.startCol && index <= p.endCol) return range(p.startCol, p.endCol);
    } else {
      const full = p.startCol === 0 && p.endCol === sheet.colCount - 1;
      if (full && index >= p.startRow && index <= p.endRow) return range(p.startRow, p.endRow);
    }
    return [index];
  }

  private startDrag(drag: Drag): void {
    this.drag = drag;
    window.addEventListener('mousemove', this.onDragMove);
    window.addEventListener('mouseup', this.onMouseUp);
  }

  private stopDrag(): void {
    this.drag = null;
    window.removeEventListener('mousemove', this.onDragMove);
    window.removeEventListener('mouseup', this.onMouseUp);
    if (this.autoScroll !== null) clearInterval(this.autoScroll);
    this.autoScroll = null;
  }

  private readonly onDragMove = (e: MouseEvent): void => {
    const { x, y } = this.local(e);
    this.lastX = x;
    this.lastY = y;
    this.applyDrag();
    this.updateAutoScroll();
  };

  private applyDrag(): void {
    const { drag } = this;
    if (drag === null) return;
    const { sheet, surface } = this.deps;
    const vp = surface.viewport;
    const { selection } = sheet;
    if (drag.kind === 'cell') {
      selection.extendTo(vp.rowAtClamped(this.lastY), vp.colAtClamped(this.lastX));
    } else if (drag.kind === 'col') {
      selection.selectCol(vp.colAtClamped(this.lastX), true);
    } else if (drag.kind === 'row') {
      selection.selectRow(vp.rowAtClamped(this.lastY), true);
    } else if (drag.kind === 'point') {
      this.deps.editor.pointTo(vp.rowAtClamped(this.lastY), vp.colAtClamped(this.lastX), true);
    } else if (drag.kind === 'fill') {
      this.planFill(drag.source, vp.rowAtClamped(this.lastY), vp.colAtClamped(this.lastX));
      sheet.notify();
    } else {
      const layout = drag.axis === 'col' ? sheet.cols : sheet.rows;
      const min = drag.axis === 'col' ? MIN_COL_WIDTH : MIN_ROW_HEIGHT;
      const pos = drag.axis === 'col' ? this.lastX : this.lastY;
      const size = Math.max(min, Math.round(drag.startSize + pos - drag.startPos));
      // Live preview writes the layout directly; the command is created once on mouse up.
      for (const i of drag.indices) layout.setSize(i, size);
      sheet.notify();
    }
  }

  // Fills along whichever axis the pointer moved further from the source range.
  private planFill(source: ViewRange, row: number, col: number): void {
    const dr = row > source.endRow ? row - source.endRow : row < source.startRow ? row - source.startRow : 0;
    const dc = col > source.endCol ? col - source.endCol : col < source.startCol ? col - source.startCol : 0;
    if (dr === 0 && dc === 0) {
      this.fillPlan = null;
      this.fillPreview = null;
      return;
    }
    if (Math.abs(dr) >= Math.abs(dc)) {
      this.fillPlan = { direction: dr > 0 ? 'down' : 'up', count: Math.abs(dr) };
      this.fillPreview = {
        ...source,
        startRow: dr < 0 ? source.startRow + dr : source.startRow,
        endRow: dr > 0 ? source.endRow + dr : source.endRow,
      };
    } else {
      this.fillPlan = { direction: dc > 0 ? 'right' : 'left', count: Math.abs(dc) };
      this.fillPreview = {
        ...source,
        startCol: dc < 0 ? source.startCol + dc : source.startCol,
        endCol: dc > 0 ? source.endCol + dc : source.endCol,
      };
    }
  }

  // Drags past the edge keep scrolling at a speed proportional to the overshoot.
  private updateAutoScroll(): void {
    const { drag } = this;
    if (drag === null || drag.kind === 'resize') return;
    const vp = this.deps.surface.viewport;
    const speed = (over: number): number => Math.sign(over) * Math.min(40, 4 + Math.abs(over) / 4);
    const dx = this.lastX < vp.headerWidth + vp.frozenWidth ? this.lastX - (vp.headerWidth + vp.frozenWidth) : this.lastX - vp.width;
    const dy = this.lastY < vp.headerHeight + vp.frozenHeight ? this.lastY - (vp.headerHeight + vp.frozenHeight) : this.lastY - vp.height;
    const sx = drag.kind === 'row' || (dx <= 0 && this.lastX >= vp.headerWidth + vp.frozenWidth) ? 0 : speed(dx);
    const sy = drag.kind === 'col' || (dy <= 0 && this.lastY >= vp.headerHeight + vp.frozenHeight) ? 0 : speed(dy);
    if (sx === 0 && sy === 0) {
      if (this.autoScroll !== null) clearInterval(this.autoScroll);
      this.autoScroll = null;
      return;
    }
    if (this.autoScroll !== null) clearInterval(this.autoScroll);
    this.autoScroll = setInterval(() => {
      this.deps.surface.scrollBy(sx, sy);
      this.applyDrag();
    }, 16);
  }

  private readonly onMouseUp = (): void => {
    const { drag } = this;
    this.stopDrag();
    if (drag !== null && drag.kind === 'fill') {
      const plan = this.fillPlan;
      this.fillPlan = null;
      this.fillPreview = null;
      if (plan !== null) this.deps.sheet.fillRange(drag.source, plan.direction, plan.count);
      else this.deps.sheet.notify();
      return;
    }
    if (drag === null || drag.kind !== 'resize') return;
    const { sheet } = this.deps;
    const layout = drag.axis === 'col' ? sheet.cols : sheet.rows;
    const finalSize = layout.getSize(drag.indices[0] as number);
    if (finalSize === drag.startSize) return;
    // Put the original size back so the command captures it as its "before" state.
    for (const i of drag.indices) layout.setSize(i, drag.startSize);
    sheet.execute(new ResizeCommand(drag.axis, drag.indices, finalSize));
  };

  private readonly onHover = (e: MouseEvent): void => {
    if (this.drag !== null) return;
    const { x, y } = this.local(e);
    if (this.onScrollbar(x, y)) {
      this.host.style.cursor = '';
      return;
    }
    const hit = this.locate(x, y);
    this.host.style.cursor =
      hit.zone === 'colResize' ? 'col-resize' : hit.zone === 'rowResize' ? 'row-resize' : hit.zone === 'fillHandle' ? 'crosshair' : '';
  };

  private readonly onDoubleClick = (e: MouseEvent): void => {
    const { x, y } = this.local(e);
    if (this.onScrollbar(x, y)) return;
    const hit = this.locate(x, y);
    if (hit.zone === 'colResize') {
      this.autoFitColumns(hit.col);
      return;
    }
    if (hit.zone === 'rowResize') {
      this.autoFitRows(hit.row);
      return;
    }
    if (hit.zone === 'fillHandle') {
      // Double-click on the handle fills down as far as the neighbouring column has data.
      const source = this.deps.sheet.selection.primary;
      const count = this.deps.sheet.autoFillExtent(source);
      if (count > 0) this.deps.sheet.fillRange(source, 'down', count);
      return;
    }
    const zone = hit.zone;
    if (zone !== 'cell') return;
    const { sheet, editor } = this.deps;
    const { selection } = sheet;
    editor.begin('caret', sheet.getEditText(selection.activeRow, selection.activeCol));
  };

  /** Double-click on a column border: each affected column gets the width of its widest content. */
  private autoFitColumns(viewCol: number): void {
    const { sheet } = this.deps;
    const indices = this.resizeTargets('col', viewCol);
    const sizes = indices.map((c) => this.fitWidth(c));
    if (indices.every((c, k) => sheet.cols.getSize(c) === sizes[k])) return;
    sheet.execute(new ResizeCommand('col', indices, sizes));
  }

  /** Cells neither wrap nor vary in font size, so the height that fits any row's content is the default height. */
  private autoFitRows(viewRow: number): void {
    const { sheet } = this.deps;
    const indices = this.resizeTargets('row', viewRow);
    const size = sheet.rows.defaultSize;
    if (indices.every((r) => sheet.rows.getSize(r) === size)) return;
    sheet.execute(new ResizeCommand('row', indices, size));
  }

  private fitWidth(viewCol: number): number {
    const { sheet, surface } = this.deps;
    const dataCol = sheet.mapping.toDataCol(viewCol);
    const candidates: Array<{ text: string; styleId: number }> = [];
    sheet.model.forEachCell((dataRow, col, cell) => {
      if (col !== dataCol || cell.value === null || sheet.mapping.toViewRow(dataRow) < 0) return;
      candidates.push({ text: formatValue(cell.value, sheet.styles.get(cell.styleId).numberFormat), styleId: cell.styleId });
    });
    if (candidates.length === 0) return sheet.cols.defaultSize;
    // Measuring is the slow part, and only the longest strings can be the widest.
    candidates.sort((a, b) => b.text.length - a.text.length);
    let widest = 0;
    for (const { text, styleId } of candidates.slice(0, 100)) {
      const style = sheet.styles.get(styleId);
      widest = Math.max(widest, surface.renderer.measure(fontFor(style.bold, style.italic), text));
    }
    return Math.min(600, Math.max(MIN_COL_WIDTH, Math.ceil(widest) + theme.cellPadding * 2 + 2));
  }

  private readonly onContextMenu = (e: MouseEvent): void => {
    const { x, y } = this.local(e);
    if (this.onScrollbar(x, y)) return;
    e.preventDefault();
    const { sheet, editor } = this.deps;
    editor.commit();
    editor.focus();
    const hit = this.locate(x, y);
    const { selection } = sheet;
    if (hit.zone === 'cell' && !selection.contains(hit.row, hit.col)) selection.selectCell(hit.row, hit.col);
    else if (hit.zone === 'colHeader' && !selection.isColSelected(hit.col)) selection.selectCol(hit.col);
    else if (hit.zone === 'rowHeader' && !selection.isRowSelected(hit.row)) selection.selectRow(hit.row);
    this.onContext?.(e.clientX, e.clientY);
  };
}

function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let i = from; i <= to; i++) out.push(i);
  return out;
}
