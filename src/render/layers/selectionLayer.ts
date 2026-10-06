import type { SelectionModel, ViewRange } from '../../core/selection/SelectionModel';
import type { Spreadsheet } from '../../core/Spreadsheet';
import { theme } from '../theme';
import type { Segment } from '../viewport';

/**
 * Draws selection fill and borders for one region. Coordinates are computed
 * from the unclamped range: the region's clip rect hides whatever falls
 * outside it, so a range spanning frozen and scrolling parts lines up in both.
 */
export function drawSelection(
  ctx: CanvasRenderingContext2D,
  sheet: Spreadsheet,
  selection: SelectionModel,
  rowSeg: Segment,
  colSeg: Segment,
  showActiveBorder: boolean,
): void {
  const { rows, cols } = sheet;
  const ranges = selection.allRanges;
  for (let i = 0; i < ranges.length; i++) {
    const range = ranges[i];
    if (range === undefined) continue;
    if (range.endRow < rowSeg.first || range.startRow > rowSeg.last) continue;
    if (range.endCol < colSeg.first || range.startCol > colSeg.last) continue;
    const x = colSeg.origin + cols.offsetOf(range.startCol) - colSeg.base;
    const y = rowSeg.origin + rows.offsetOf(range.startRow) - rowSeg.base;
    const w = cols.offsetOf(range.endCol + 1) - cols.offsetOf(range.startCol);
    const h = rows.offsetOf(range.endRow + 1) - rows.offsetOf(range.startRow);
    const single = range.startRow === range.endRow && range.startCol === range.endCol;
    if (!single) {
      ctx.fillStyle = theme.selectionFill;
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      // Punch the active cell out of the tint so it reads as the cell being edited.
      if (range === selection.primary) {
        const ax = colSeg.origin + cols.offsetOf(selection.activeCol) - colSeg.base;
        const ay = rowSeg.origin + rows.offsetOf(selection.activeRow) - rowSeg.base;
        ctx.rect(ax, ay, cols.getSize(selection.activeCol), rows.getSize(selection.activeRow));
        ctx.fill('evenodd');
      } else {
        ctx.fill();
      }
      ctx.strokeStyle = theme.accent;
      ctx.lineWidth = 1;
      ctx.strokeRect(x - 0.5, y - 0.5, w, h);
    }
  }
  if (!showActiveBorder) return;
  drawFillHandle(ctx, sheet, selection, rowSeg, colSeg);
  const ax = colSeg.origin + cols.offsetOf(selection.activeCol) - colSeg.base;
  const ay = rowSeg.origin + rows.offsetOf(selection.activeRow) - rowSeg.base;
  ctx.strokeStyle = theme.accent;
  ctx.lineWidth = 2;
  ctx.strokeRect(ax, ay, cols.getSize(selection.activeCol), rows.getSize(selection.activeRow));
}

const DASH: number[] = [4, 3]; // module constant: the render loop must not allocate

/** Dashed "marching ants" outline around the copied or cut range. */
export function drawCopyMarquee(
  ctx: CanvasRenderingContext2D,
  sheet: Spreadsheet,
  range: ViewRange,
  rowSeg: Segment,
  colSeg: Segment,
): void {
  if (range.endRow < rowSeg.first || range.startRow > rowSeg.last) return;
  if (range.endCol < colSeg.first || range.startCol > colSeg.last) return;
  const { rows, cols } = sheet;
  const x = colSeg.origin + cols.offsetOf(range.startCol) - colSeg.base;
  const y = rowSeg.origin + rows.offsetOf(range.startRow) - rowSeg.base;
  const w = cols.offsetOf(range.endCol + 1) - cols.offsetOf(range.startCol);
  const h = rows.offsetOf(range.endRow + 1) - rows.offsetOf(range.startRow);
  ctx.save();
  ctx.setLineDash(DASH);
  ctx.strokeStyle = theme.accent;
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);
  ctx.restore();
}

export const FILL_HANDLE_SIZE = 7;

/** Small square at the bottom-right corner of the primary range, the grab point for fill. */
function drawFillHandle(
  ctx: CanvasRenderingContext2D,
  sheet: Spreadsheet,
  selection: SelectionModel,
  rowSeg: Segment,
  colSeg: Segment,
): void {
  const p = selection.primary;
  if (p.endRow < rowSeg.first || p.endRow > rowSeg.last || p.endCol < colSeg.first || p.endCol > colSeg.last) return;
  const x = colSeg.origin + sheet.cols.offsetOf(p.endCol + 1) - colSeg.base;
  const y = rowSeg.origin + sheet.rows.offsetOf(p.endRow + 1) - rowSeg.base;
  const half = FILL_HANDLE_SIZE / 2;
  ctx.fillStyle = theme.background;
  ctx.fillRect(x - half - 1, y - half - 1, FILL_HANDLE_SIZE + 2, FILL_HANDLE_SIZE + 2);
  ctx.fillStyle = theme.accent;
  ctx.fillRect(x - half, y - half, FILL_HANDLE_SIZE, FILL_HANDLE_SIZE);
}
