import type { Spreadsheet } from '../../core/Spreadsheet';
import { theme } from '../theme';
import type { Segment } from '../viewport';

/** Draws cell borders for one region. Lines sit at x + 0.5 so 1px strokes stay crisp. */
export function drawGridLines(
  ctx: CanvasRenderingContext2D,
  sheet: Spreadsheet,
  rowSeg: Segment,
  colSeg: Segment,
): void {
  const { rows, cols } = sheet;
  const top = rowSeg.origin + rows.offsetOf(rowSeg.first) - rowSeg.base;
  const left = colSeg.origin + cols.offsetOf(colSeg.first) - colSeg.base;
  const bottom = rowSeg.origin + rows.offsetOf(rowSeg.last + 1) - rowSeg.base;
  const right = colSeg.origin + cols.offsetOf(colSeg.last + 1) - colSeg.base;

  ctx.beginPath();
  let x = left;
  for (let c = colSeg.first; c <= colSeg.last; c++) {
    x += cols.getSize(c);
    const px = Math.floor(x) - 0.5;
    ctx.moveTo(px, top);
    ctx.lineTo(px, bottom);
  }
  let y = top;
  for (let r = rowSeg.first; r <= rowSeg.last; r++) {
    y += rows.getSize(r);
    const py = Math.floor(y) - 0.5;
    ctx.moveTo(left, py);
    ctx.lineTo(right, py);
  }
  ctx.strokeStyle = theme.gridLine;
  ctx.lineWidth = 1;
  ctx.stroke();
}
