export type BorderStyle = 'solid' | 'dashed' | 'dotted';
export type BorderSide = 'top' | 'right' | 'bottom' | 'left';

/** One edge of a cell: how thick (1 to 3 pixels), what pattern, and which color. */
export interface Border {
  readonly width: 1 | 2 | 3;
  readonly style: BorderStyle;
  readonly color: string;
}

export type Borders = { readonly [K in BorderSide]?: Border };

export const BORDER_SIDES: readonly BorderSide[] = ['top', 'right', 'bottom', 'left'];

export const OPPOSITE: Readonly<Record<BorderSide, BorderSide>> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };

export const DEFAULT_BORDER: Border = { width: 1, style: 'solid', color: '#000000' };

/** What the Borders menu can do to the selected range. */
export type BorderPreset = 'all' | 'outer' | 'inner' | 'horizontal' | 'vertical' | 'top' | 'bottom' | 'left' | 'right' | 'none';

/** The same borders always have the same key order, so the style table interns equal borders once. */
export function canonicalBorder(b: Border): Border {
  return { width: b.width, style: b.style, color: b.color };
}

/** `borders` with one side set (or removed with null), in canonical key order; undefined when nothing is left. */
export function withBorder(borders: Borders | undefined, side: BorderSide, border: Border | null): Borders | undefined {
  const next: { -readonly [K in BorderSide]?: Border } = {};
  for (const s of BORDER_SIDES) {
    const value = s === side ? border : (borders?.[s] ?? null);
    if (value !== null) next[s] = canonicalBorder(value);
  }
  return Object.keys(next).length === 0 ? undefined : next;
}

export function isBorder(value: unknown): value is Border {
  if (typeof value !== 'object' || value === null) return false;
  const b = value as Record<string, unknown>;
  return (b.width === 1 || b.width === 2 || b.width === 3) && (b.style === 'solid' || b.style === 'dashed' || b.style === 'dotted') && typeof b.color === 'string';
}

/**
 * Which sides of the cell at (row, col) a preset touches inside the rectangle r1..r2 x c1..c2. Keeping this a pure
 * function makes the geometry easy to test without a sheet.
 */
export function presetSides(preset: BorderPreset, row: number, col: number, r1: number, c1: number, r2: number, c2: number): BorderSide[] {
  const sides: BorderSide[] = [];
  const top = row === r1;
  const bottom = row === r2;
  const left = col === c1;
  const right = col === c2;
  switch (preset) {
    case 'all':
    case 'none':
      return [...BORDER_SIDES];
    case 'outer':
      if (top) sides.push('top');
      if (right) sides.push('right');
      if (bottom) sides.push('bottom');
      if (left) sides.push('left');
      return sides;
    case 'inner':
    case 'horizontal':
    case 'vertical': {
      const horizontal = preset !== 'vertical';
      const vertical = preset !== 'horizontal';
      if (horizontal && !top) sides.push('top');
      if (vertical && !right) sides.push('right');
      if (horizontal && !bottom) sides.push('bottom');
      if (vertical && !left) sides.push('left');
      return sides;
    }
    case 'top':
      return top ? ['top'] : [];
    case 'bottom':
      return bottom ? ['bottom'] : [];
    case 'left':
      return left ? ['left'] : [];
    case 'right':
      return right ? ['right'] : [];
  }
}
