import { DEFAULT_FONT_SIZE, lineHeightFor } from '../../core/model/font';
import { wrapLines } from '../../core/layout/wrap';
import { DEFAULT_STYLE_ID, type Style, type VerticalAlign } from '../../core/model/StyleTable';
import { defaultAlign, formatValue } from '../../core/model/format';
import type { Spreadsheet } from '../../core/Spreadsheet';
import { fontFor, theme } from '../theme';
import { computeOverflow, type Overflow } from '../overflow';
import type { TextMeasurer } from '../textMeasure';
import type { Segment } from '../viewport';

/** Font strings per styleId, so we never rebuild them per cell. */
export class FontCache {
  private readonly byStyle = new Map<number, string>();
  constructor(private readonly sheet: Spreadsheet) {}

  get(styleId: number): string {
    let font = this.byStyle.get(styleId);
    if (font === undefined) {
      const style = this.sheet.styles.get(styleId);
      font = fontFor(style);
      this.byStyle.set(styleId, font);
    }
    return font;
  }
}

export function drawCellBackgrounds(
  ctx: CanvasRenderingContext2D,
  sheet: Spreadsheet,
  rowSeg: Segment,
  colSeg: Segment,
): void {
  const { rows, cols, model, mapping, styles } = sheet;
  let y = rowSeg.origin + rows.offsetOf(rowSeg.first) - rowSeg.base;
  for (let r = rowSeg.first; r <= rowSeg.last; r++) {
    const h = rows.getSize(r);
    const dataRow = mapping.toDataRow(r);
    let x = colSeg.origin + cols.offsetOf(colSeg.first) - colSeg.base;
    for (let c = colSeg.first; c <= colSeg.last; c++) {
      const w = cols.getSize(c);
      const cell = model.getCell(dataRow, mapping.toDataCol(c));
      if (cell.styleId !== DEFAULT_STYLE_ID) {
        const bg = styles.get(cell.styleId).background;
        if (bg !== undefined) {
          ctx.fillStyle = bg;
          ctx.fillRect(x, y, w, h);
        }
      }
      x += w;
    }
    y += h;
  }
}

const overflow: Overflow = { left: 0, right: 0 }; // reused: no allocation per cell

// Wrapping a string means measuring several candidate lines; the result only depends on font, width and text, so it is
// remembered. The map is emptied when it grows large instead of tracking recency: cheap, and a miss just recomputes.
const WRAP_CACHE_LIMIT = 5000;
const wrapCache = new Map<string, string[]>();

function wrappedLines(measurer: TextMeasurer, font: string, available: number, text: string): string[] {
  const key = `${font}|${available}|${text}`;
  let lines = wrapCache.get(key);
  if (lines === undefined) {
    if (wrapCache.size >= WRAP_CACHE_LIMIT) wrapCache.clear();
    lines = wrapLines(text, available, (candidate) => measurer.measure(font, candidate));
    wrapCache.set(key, lines);
  }
  return lines;
}

/** Underline and strikethrough: canvas has no text-decoration, so they are drawn by hand across `width`. */
function drawDecorations(ctx: CanvasRenderingContext2D, style: Style, x: number, centerY: number, width: number, size: number): void {
  if (style.underline !== true && style.strike !== true) return;
  const thickness = Math.max(1, Math.round(size / 13));
  if (style.underline === true) ctx.fillRect(x, Math.round(centerY + size * 0.54), width, thickness);
  if (style.strike === true) ctx.fillRect(x, Math.round(centerY), width, thickness);
}

/** Vertical position of the centre of a line of height `lh` in a cell of height `h`, for the style's vertical alignment. */
function lineCentre(y: number, h: number, lh: number, valign: VerticalAlign | undefined): number {
  if (valign === 'top') return y + 2 + lh / 2;
  if (valign === 'bottom') return y + h - 2 - lh / 2;
  return y + h / 2;
}

export function drawCellText(
  ctx: CanvasRenderingContext2D,
  sheet: Spreadsheet,
  rowSeg: Segment,
  colSeg: Segment,
  measurer: TextMeasurer,
  fonts: FontCache,
): void {
  const { rows, cols, model, mapping, styles } = sheet;
  const pad = theme.cellPadding;
  ctx.textBaseline = 'middle';
  let y = rowSeg.origin + rows.offsetOf(rowSeg.first) - rowSeg.base;
  for (let r = rowSeg.first; r <= rowSeg.last; r++) {
    const h = rows.getSize(r);
    const dataRow = mapping.toDataRow(r);
    let x = colSeg.origin + cols.offsetOf(colSeg.first) - colSeg.base;
    for (let c = colSeg.first; c <= colSeg.last; c++) {
      const w = cols.getSize(c);
      const cell = model.getCell(dataRow, mapping.toDataCol(c));
      if (cell.value !== null && w > 0 && h > 0) {
        const style = styles.get(cell.styleId);
        const text = formatValue(cell.value, style.numberFormat);
        const font = fonts.get(cell.styleId);
        const size = style.fontSize ?? DEFAULT_FONT_SIZE;
        const lh = lineHeightFor(size);
        const available = w - pad * 2;
        const align = style.align ?? defaultAlign(cell.value);
        ctx.font = font;
        ctx.fillStyle = style.color ?? theme.text;

        if (style.wrap === 'wrap' && typeof cell.value === 'string') {
          // Wrapped text: several lines inside the cell, clipped to it. Numbers never wrap.
          const lines = wrappedLines(measurer, font, available, text);
          const block = lines.length * lh;
          const top = style.valign === 'top' ? y + 2 : style.valign === 'bottom' ? y + h - block - 2 : y + (h - block) / 2;
          ctx.save();
          ctx.beginPath();
          ctx.rect(x, y, w, h);
          ctx.clip();
          ctx.textAlign = 'left';
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i] as string;
            const lineWidth = measurer.measure(font, line);
            const tx = align === 'right' ? x + w - pad - lineWidth : align === 'center' ? x + (w - lineWidth) / 2 : x + pad;
            const cy = top + i * lh + lh / 2;
            ctx.fillText(line, tx, cy + 0.5);
            drawDecorations(ctx, style, tx, cy, lineWidth, size);
          }
          ctx.restore();
        } else {
          const textWidth = measurer.measure(font, text);
          // Text wider than its cell spills into empty neighbours (to the right for left-aligned text, to the
          // left for right-aligned, both ways for centered), as in Sheets. Only text does, and only when the cell
          // is not set to clip; numbers are clipped.
          const spills = textWidth > available && typeof cell.value === 'string' && style.wrap !== 'clip';
          const extra = spills ? computeOverflow(sheet, dataRow, c, align, textWidth, available, overflow) : null;
          // A line taller than its row is cut as well.
          const clipped = (textWidth > available && (extra === null || textWidth > available + extra.left + extra.right)) || lh > h;
          if (clipped) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(x - (extra?.left ?? 0), y, w + (extra?.left ?? 0) + (extra?.right ?? 0), h);
            ctx.clip();
          }
          let tx = x + pad;
          ctx.textAlign = 'left';
          if (align === 'right') tx = x + w - pad - textWidth;
          else if (align === 'center') tx = x + (w - textWidth) / 2;
          // Text that does not fit and does not spill starts at the left edge and gets clipped.
          if (textWidth > available && !spills) tx = x + pad;
          if (extra !== null && (extra.left > 0 || extra.right > 0)) {
            eraseSpillLines(ctx, sheet, dataRow, c, x, y, w, h, tx, tx + textWidth, extra);
            ctx.fillStyle = style.color ?? theme.text;
          }
          const cy = lineCentre(y, h, lh, style.valign);
          ctx.fillText(text, tx, cy + 0.5);
          drawDecorations(ctx, style, tx, Math.round(cy), spills ? textWidth : Math.min(textWidth, available), size);
          if (clipped) ctx.restore();
        }
      }
      x += w;
    }
    y += h;
  }
}

/**
 * Grid lines are drawn before the text, so a spilled string would be struck through by the vertical lines of the
 * empty cells it crosses. Sheets hides those lines; we paint them over in the background colour. Boundaries next to
 * a coloured cell are kept, and so is the edge where the spill stops (it is the clip edge, not crossed by text).
 */
function eraseSpillLines(
  ctx: CanvasRenderingContext2D,
  sheet: Spreadsheet,
  dataRow: number,
  viewCol: number,
  x: number,
  y: number,
  w: number,
  h: number,
  textLeft: number,
  textRight: number,
  extra: Overflow,
): void {
  const { cols, model, mapping, styles } = sheet;
  const top = Math.floor(y);
  const height = Math.floor(y + h) - 1 - top; // the bottom pixel row is the horizontal grid line
  const hasBackground = (c: number): boolean => {
    const id = model.getCell(dataRow, mapping.toDataCol(c)).styleId;
    return id !== DEFAULT_STYLE_ID && styles.get(id).background !== undefined;
  };
  ctx.fillStyle = theme.background;
  if (hasBackground(viewCol)) return;
  let edge = x + w;
  for (let c = viewCol + 1; edge < x + w + extra.right - 0.5 && edge < textRight && c < cols.count; c++) {
    if (hasBackground(c)) break;
    ctx.fillRect(Math.floor(edge) - 1, top, 1, height);
    edge += cols.getSize(c);
  }
  edge = x;
  for (let c = viewCol - 1; edge > x - extra.left + 0.5 && edge > textLeft && c >= 0; c--) {
    if (hasBackground(c)) break;
    ctx.fillRect(Math.floor(edge) - 1, top, 1, height);
    edge -= cols.getSize(c);
  }
}
