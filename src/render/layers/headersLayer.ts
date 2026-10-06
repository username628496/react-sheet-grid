import { columnLabel } from '../../core/model/address';
import type { Spreadsheet } from '../../core/Spreadsheet';
import { theme } from '../theme';
import type { Viewport } from '../viewport';

export interface HeaderHighlight {
  isRowSelected(viewRow: number): boolean;
  isColSelected(viewCol: number): boolean;
  /** Small indicator drawn at the right end of a column header (sort arrow, filter funnel). */
  colMark?(viewCol: number): string | null;
}

export function drawHeaders(
  ctx: CanvasRenderingContext2D,
  sheet: Spreadsheet,
  vp: Viewport,
  highlight: HeaderHighlight | null,
): void {
  const { rows, cols, mapping } = sheet;
  const hw = vp.headerWidth;
  const hh = vp.headerHeight;
  ctx.font = `${theme.fontSize - 1}px ${theme.fontFamily}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';

  // Column header strip.
  for (const seg of vp.colSegments) {
    if (seg.last < seg.first) continue;
    ctx.save();
    ctx.beginPath();
    ctx.rect(seg.clipStart, 0, seg.clipEnd - seg.clipStart, hh);
    ctx.clip();
    let x = seg.origin + cols.offsetOf(seg.first) - seg.base;
    for (let c = seg.first; c <= seg.last; c++) {
      const w = cols.getSize(c);
      const active = highlight?.isColSelected(c) === true;
      ctx.fillStyle = active ? theme.headerActive : theme.headerBackground;
      ctx.fillRect(x, 0, w, hh);
      ctx.fillStyle = active ? theme.headerActiveText : theme.headerText;
      ctx.fillText(columnLabel(mapping.toDataCol(c)), x + w / 2, hh / 2 + 0.5);
      const mark = highlight?.colMark?.(c) ?? null;
      if (mark !== null && w > 40) {
        ctx.fillStyle = theme.accent;
        ctx.fillText(mark, x + w - 10, hh / 2 + 0.5);
      }
      ctx.fillStyle = theme.headerLine;
      ctx.fillRect(Math.floor(x + w) - 1, 0, 1, hh);
      x += w;
    }
    ctx.restore();
  }

  // Row header strip.
  for (const seg of vp.rowSegments) {
    if (seg.last < seg.first) continue;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, seg.clipStart, hw, seg.clipEnd - seg.clipStart);
    ctx.clip();
    let y = seg.origin + rows.offsetOf(seg.first) - seg.base;
    for (let r = seg.first; r <= seg.last; r++) {
      const h = rows.getSize(r);
      const active = highlight?.isRowSelected(r) === true;
      ctx.fillStyle = active ? theme.headerActive : theme.headerBackground;
      ctx.fillRect(0, y, hw, h);
      ctx.fillStyle = active ? theme.headerActiveText : theme.headerText;
      ctx.fillText(String(r + 1), hw / 2, y + h / 2 + 0.5);
      ctx.fillStyle = theme.headerLine;
      ctx.fillRect(0, Math.floor(y + h) - 1, hw, 1);
      y += h;
    }
    ctx.restore();
  }

  // Corner and header borders.
  ctx.fillStyle = theme.headerBackground;
  ctx.fillRect(0, 0, hw, hh);
  ctx.fillStyle = theme.headerLine;
  ctx.fillRect(hw - 1, 0, 1, hh);
  ctx.fillRect(0, hh - 1, hw, 1);
  ctx.fillRect(hw - 1, hh - 1, 1, 1);
  ctx.fillRect(0, hh - 1, vp.width, 1);
  ctx.fillRect(hw - 1, 0, 1, vp.height);
}
