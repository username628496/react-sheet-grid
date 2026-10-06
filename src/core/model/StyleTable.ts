export type HorizontalAlign = 'left' | 'center' | 'right';

export interface Style {
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly color?: string;
  readonly background?: string;
  readonly align?: HorizontalAlign;
  readonly numberFormat?: string;
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
