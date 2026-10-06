import type { Style } from './StyleTable';

export const DEFAULT_FONT_SIZE = 13;
export const FONT_FAMILY = 'Arial, "Helvetica Neue", sans-serif';
/** Space between a cell's edge and its text, left and right. */
export const CELL_HORIZONTAL_PADDING = 4;
export const MIN_FONT_SIZE = 6;
export const MAX_FONT_SIZE = 96;

/** Sizes the "increase / decrease font size" buttons step through, as in Sheets. */
export const FONT_SIZE_STEPS = [6, 7, 8, 9, 10, 11, 12, 13, 14, 16, 18, 21, 24, 28, 32, 36, 48, 60, 72, 96] as const;

export function clampFontSize(size: number): number {
  return Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, Math.round(Number.isFinite(size) ? size : DEFAULT_FONT_SIZE)));
}

/** The CSS font shorthand for a style. `scale` is for DOM boxes laid over a zoomed canvas, which need screen pixels. */
export function fontString(style: Pick<Style, 'bold' | 'italic' | 'fontSize'>, scale = 1): string {
  const size = (style.fontSize ?? DEFAULT_FONT_SIZE) * scale;
  return `${style.italic === true ? 'italic ' : ''}${style.bold === true ? 'bold ' : ''}${size}px ${FONT_FAMILY}`;
}

/** Height of one line of text at `size`. */
export function lineHeightFor(size: number): number {
  return Math.ceil(size * 1.25);
}

/** Vertical padding inside a cell (top plus bottom), so a single line of 13px text fits the default 21px row exactly. */
export const CELL_VERTICAL_PADDING = 4;

/** The next size up or down the step list from `size` (sizes between steps move to the nearest step in that direction). */
export function stepFontSize(size: number, direction: 1 | -1): number {
  if (direction === 1) return FONT_SIZE_STEPS.find((s) => s > size) ?? size;
  for (let i = FONT_SIZE_STEPS.length - 1; i >= 0; i--) {
    const s = FONT_SIZE_STEPS[i] as number;
    if (s < size) return s;
  }
  return size;
}
