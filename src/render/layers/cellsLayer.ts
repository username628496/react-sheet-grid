import { DEFAULT_STYLE_ID } from '../../core/model/StyleTable';
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
      font = fontFor(style.bold, style.italic);
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
        const textWidth = measurer.measure(font, text);
        const available = w - pad * 2;
        const align = style.align ?? defaultAlign(cell.value);
        ctx.font = font;
        ctx.fillStyle = style.color ?? theme.text;
        // Text wider than its cell spills into empty neighbours (to the right for left-aligned text, to the
        // left for right-aligned, both ways for centered), as in Sheets. Only text does; numbers are clipped.
        const spills = textWidth > available && typeof cell.value === 'string';
        const extra = spills ? computeOverflow(sheet, dataRow, c, align, textWidth, available, overflow) : null;
        const clipped = textWidth > available && (extra === null || textWidth > available + extra.left + extra.right);
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
        // Numbers that do not fit keep the old behaviour: start at the left edge and get clipped.
        if (textWidth > available && !spills) tx = x + pad;
        ctx.fillText(text, tx, y + h / 2 + 0.5);
        if (style.underline === true || style.strike === true) {
          // Canvas has no text-decoration, so the lines are drawn by hand across the visible part of the text.
          const lineWidth = spills ? textWidth : Math.min(textWidth, available);
          const mid = Math.round(y + h / 2);
          if (style.underline === true) ctx.fillRect(tx, mid + 7, lineWidth, 1);
          if (style.strike === true) ctx.fillRect(tx, mid, lineWidth, 1);
        }
        if (clipped) ctx.restore();
      }
      x += w;
    }
    y += h;
  }
}
