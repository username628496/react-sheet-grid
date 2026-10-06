import type { SelectionModel } from '../../core/selection/SelectionModel';
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
  const ax = colSeg.origin + cols.offsetOf(selection.activeCol) - colSeg.base;
  const ay = rowSeg.origin + rows.offsetOf(selection.activeRow) - rowSeg.base;
  ctx.strokeStyle = theme.accent;
  ctx.lineWidth = 2;
  ctx.strokeRect(ax, ay, cols.getSize(selection.activeCol), rows.getSize(selection.activeRow));
}
