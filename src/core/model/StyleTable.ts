import { type ConditionalRule, canonicalRules } from './conditional';
import { type Validation, canonicalValidation } from './validation';
import { type Borders, BORDER_SIDES, canonicalBorder } from './borders';

export type HorizontalAlign = 'left' | 'center' | 'right';

export type TextWrap = 'overflow' | 'wrap' | 'clip';
export type VerticalAlign = 'top' | 'middle' | 'bottom';

export interface Style {
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly underline?: boolean;
  readonly strike?: boolean;
  readonly color?: string;
  readonly background?: string;
  readonly align?: HorizontalAlign;
  readonly numberFormat?: string;
  /** Pixels; omitted means the default size. */
  readonly fontSize?: number;
  /** What happens to text wider than its cell: spill into empty neighbours (default), wrap onto more lines, or be cut off. */
  readonly wrap?: TextWrap;
  /** Where the text sits in a taller cell (default middle). */
  readonly valign?: VerticalAlign;
  /** Lines around the cell. Each side stands on its own; adjacent cells can both draw the edge between them. */
  readonly borders?: Borders;
  /** Which input the cell accepts. */
  readonly validation?: Validation;
  /** Colors that apply while a condition on the cell's value holds; the first matching rule wins. */
  readonly conditional?: readonly ConditionalRule[];
}

export const DEFAULT_STYLE_ID = 0;

// Sorted keys make the intern key independent of property insertion order.
function styleKey(style: Style): string {
  const entries = Object.entries(style)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return JSON.stringify(entries);
}

const EMPTY_STYLE: Style = Object.freeze({});

// Nested borders must have a fixed key order for the intern key to be a function of their content.
function normalize(style: Style): Style {
  if (style.validation !== undefined) style = { ...style, validation: canonicalValidation(style.validation) };
  if (style.conditional !== undefined) style = { ...style, conditional: style.conditional.length === 0 ? undefined : canonicalRules(style.conditional) };
  const borders = style.borders;
  if (borders === undefined) return style;
  const next: { -readonly [K in keyof Borders]: Borders[K] } = {};
  for (const side of BORDER_SIDES) {
    const b = borders[side];
    if (b !== undefined) next[side] = canonicalBorder(b);
  }
  return { ...style, borders: Object.keys(next).length === 0 ? undefined : next };
}

/**
 * Shared style registry: cells store only a `styleId`, so a million cells
 * with the same format cost one Style object. Ids are never reused, which
 * keeps undo/redo safe when commands hold on to old ids.
 */
export class StyleTable {
  private readonly styles: Style[] = [EMPTY_STYLE];
  private readonly idByKey = new Map<string, number>([[styleKey(EMPTY_STYLE), DEFAULT_STYLE_ID]]);

  get size(): number {
    return this.styles.length;
  }

  intern(style: Style): number {
    style = normalize(style);
    const key = styleKey(style);
    const existing = this.idByKey.get(key);
    if (existing !== undefined) return existing;
    const id = this.styles.length;
    this.styles.push(Object.freeze({ ...style }));
    this.idByKey.set(key, id);
    return id;
  }

  get(styleId: number): Style {
    return this.styles[styleId] ?? EMPTY_STYLE;
  }

  /** Returns the id of `styleId`'s style with `patch` applied on top. */
  derive(styleId: number, patch: Partial<Style>): number {
    return this.intern({ ...this.get(styleId), ...patch });
  }
}
