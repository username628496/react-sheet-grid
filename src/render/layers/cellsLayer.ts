import { DEFAULT_FONT_SIZE, lineHeightFor } from '../../core/model/font';
import { wrapLines } from '../../core/layout/wrap';
import { BORDER_SIDES, type Borders } from '../../core/model/borders';
import { DEFAULT_STYLE_ID, type Style, type VerticalAlign } from '../../core/model/StyleTable';
import type { Cell, CellValue } from '../../core/model/Cell';
import { firstMatchingRule } from '../../core/model/conditional';
import { type Validation, isValid } from '../../core/model/validation';
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
        const style = styles.get(cell.styleId);
        const bg = style.conditional === undefined ? style.background : (firstMatchingRule(style.conditional, cell.value)?.background ?? style.background);
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

/**
 * Merged blocks, drawn over the ordinary cells of one pane: the block's fill hides the grid lines and any text of the
 * covered cells, then its own border, text and marks go on top. A block is positioned from the layout, so one whose
 * anchor is scrolled off still draws its visible part (the pane's clip cuts the rest).
 */
export function drawMerges(ctx: CanvasRenderingContext2D, sheet: Spreadsheet, rowSeg: Segment, colSeg: Segment, measurer: TextMeasurer, fonts: FontCache): void {
  const { rows, cols, model, styles, merges } = sheet;
  if (merges.size === 0) return;
  const visible = merges.intersecting(rowSeg.first, colSeg.first, rowSeg.last, colSeg.last);
  for (const m of visible) {
    const x = colSeg.origin + cols.offsetOf(m.col) - colSeg.base;
    const y = rowSeg.origin + rows.offsetOf(m.row) - rowSeg.base;
    const w = cols.offsetOf(m.col + m.colSpan) - cols.offsetOf(m.col);
    const h = rows.offsetOf(m.row + m.rowSpan) - rows.offsetOf(m.row);
    if (w <= 0 || h <= 0) continue;
    const cell = model.getCell(m.row, m.col);
    const style = styles.get(cell.styleId);
    const rule = style.conditional === undefined ? undefined : firstMatchingRule(style.conditional, cell.value);
    ctx.fillStyle = rule?.background ?? style.background ?? theme.background;
    ctx.fillRect(x, y, w, h);
    // Only the block's outer edge keeps a grid line (the same pixel rows/columns the grid pass uses).
    ctx.fillStyle = theme.gridLine;
    ctx.fillRect(Math.floor(x + w) - 1, y, 1, h);
    ctx.fillRect(x, Math.floor(y + h) - 1, w, 1);
    if (style.borders !== undefined) drawBorders(ctx, style.borders, x, y, w, h);
    ctx.textBaseline = 'middle';
    drawCellValue(ctx, sheet, cell, m.row, m.col, x, y, w, h, measurer, fonts, false);
    if (style.validation !== undefined) drawValidationMarks(ctx, style.validation, cell.value, x, y, w, h);
  }
}

/** Width of the dropdown arrow zone at the right of a list cell; a click inside it opens the list. */
export const LIST_ARROW_WIDTH = 16;
const INVALID_COLOR = '#d93025';

/** A red corner on a cell that breaks its rule, and a small arrow on cells that offer a list. */
function drawValidationMarks(ctx: CanvasRenderingContext2D, rule: Validation, value: CellValue | null, x: number, y: number, w: number, h: number): void {
  if (!isValid(rule, value)) {
    ctx.fillStyle = INVALID_COLOR;
    ctx.beginPath();
    ctx.moveTo(x + w - 7, y);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x + w, y + 7);
    ctx.closePath();
    ctx.fill();
  }
  if (rule.kind === 'list' && w > LIST_ARROW_WIDTH * 2) {
    const cx = x + w - LIST_ARROW_WIDTH / 2;
    const cy = y + h / 2;
    ctx.fillStyle = theme.headerText;
    ctx.beginPath();
    ctx.moveTo(cx - 3.5, cy - 1.5);
    ctx.lineTo(cx + 3.5, cy - 1.5);
    ctx.lineTo(cx, cy + 2.5);
    ctx.closePath();
    ctx.fill();
  }
}

const overflow: Overflow = { left: 0, right: 0 }; // reused: no allocation per cell

// Dash patterns are module constants: the render loop must not allocate.
const DASHED: number[] = [4, 3];
const DOTTED: number[] = [1, 2];
const NO_DASH: number[] = [];

/**
 * Draws the borders of one cell on top of the grid lines. A border sits on the boundary between cells, on the same
 * pixels as the grid line it covers (grid lines are the 1px column ending at floor(edge)), widened symmetrically for
 * thicker styles. Solid lines are filled rectangles, so they are crisp at any zoom; dashes need a stroke.
 */
function drawBorders(ctx: CanvasRenderingContext2D, borders: Borders, x: number, y: number, w: number, h: number): void {
  const left = Math.floor(x);
  const right = Math.floor(x + w);
  const top = Math.floor(y);
  const bottom = Math.floor(y + h);
  for (const side of BORDER_SIDES) {
    const b = borders[side];
    if (b === undefined) continue;
    const vertical = side === 'left' || side === 'right';
    const edge = side === 'left' ? left : side === 'right' ? right : side === 'top' ? top : bottom;
    const start = edge - 1 - Math.floor((b.width - 1) / 2); // first pixel of the line across the boundary
    const from = vertical ? top - 1 : left - 1;
    const length = vertical ? bottom - top + 1 : right - left + 1;
    ctx.fillStyle = b.color;
    if (b.style === 'solid') {
      if (vertical) ctx.fillRect(start, from, b.width, length);
      else ctx.fillRect(from, start, length, b.width);
      continue;
    }
    ctx.save();
    ctx.strokeStyle = b.color;
    ctx.lineWidth = b.width;
    ctx.setLineDash(b.style === 'dashed' ? DASHED : DOTTED);
    ctx.beginPath();
    const mid = start + b.width / 2;
    if (vertical) {
      ctx.moveTo(mid, from);
      ctx.lineTo(mid, from + length);
    } else {
      ctx.moveTo(from, mid);
      ctx.lineTo(from + length, mid);
    }
    ctx.stroke();
    ctx.setLineDash(NO_DASH);
    ctx.restore();
  }
}

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

/**
 * Draws the text of one cell into the rectangle (x, y, w, h). A merged block passes its own rectangle and
 * `spill = false`: its text stays inside the block.
 */
function drawCellValue(
  ctx: CanvasRenderingContext2D,
  sheet: Spreadsheet,
  cell: Cell,
  dataRow: number,
  c: number,
  x: number,
  y: number,
  w: number,
  h: number,
  measurer: TextMeasurer,
  fonts: FontCache,
  spill: boolean,
): void {
  const { styles } = sheet;
  const pad = theme.cellPadding;
  if (cell.value === null || w <= 0 || h <= 0) return;
    const style = styles.get(cell.styleId);
    const text = formatValue(cell.value, style.numberFormat);
    const font = fonts.get(cell.styleId);
    const size = style.fontSize ?? DEFAULT_FONT_SIZE;
    const lh = lineHeightFor(size);
    const available = w - pad * 2;
    const align = style.align ?? defaultAlign(cell.value);
    ctx.font = font;
    const color = style.conditional === undefined ? style.color : (firstMatchingRule(style.conditional, cell.value)?.color ?? style.color);
    ctx.fillStyle = color ?? theme.text;

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
      const spills = spill && textWidth > available && typeof cell.value === 'string' && style.wrap !== 'clip';
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
        ctx.fillStyle = color ?? theme.text;
      }
      const cy = lineCentre(y, h, lh, style.valign);
      ctx.fillText(text, tx, cy + 0.5);
      drawDecorations(ctx, style, tx, Math.round(cy), spills ? textWidth : Math.min(textWidth, available), size);
      if (clipped) ctx.restore();
    }
  
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
  ctx.textBaseline = 'middle';
  let y = rowSeg.origin + rows.offsetOf(rowSeg.first) - rowSeg.base;
  for (let r = rowSeg.first; r <= rowSeg.last; r++) {
    const h = rows.getSize(r);
    const dataRow = mapping.toDataRow(r);
    let x = colSeg.origin + cols.offsetOf(colSeg.first) - colSeg.base;
    for (let c = colSeg.first; c <= colSeg.last; c++) {
      const w = cols.getSize(c);
      const cell = model.getCell(dataRow, mapping.toDataCol(c));
      if (cell.styleId !== DEFAULT_STYLE_ID && w > 0 && h > 0) {
        const borders = styles.get(cell.styleId).borders;
        if (borders !== undefined) drawBorders(ctx, borders, x, y, w, h);
      }
      drawCellValue(ctx, sheet, cell, dataRow, c, x, y, w, h, measurer, fonts, true);
      if (cell.styleId !== DEFAULT_STYLE_ID && w > 0 && h > 0) {
        const rule = styles.get(cell.styleId).validation;
        if (rule !== undefined) drawValidationMarks(ctx, rule, cell.value, x, y, w, h);
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
    if (id === DEFAULT_STYLE_ID) return false;
    const st = styles.get(id);
    return st.background !== undefined || (st.conditional !== undefined && firstMatchingRule(st.conditional, model.getCell(dataRow, mapping.toDataCol(c)).value)?.background !== undefined);
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
