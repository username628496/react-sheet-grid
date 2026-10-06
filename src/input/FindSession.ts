import type { FindOptions, Spreadsheet } from '../core/Spreadsheet';
import type { ViewRange } from '../core/selection/SelectionModel';

export interface FindSettings {
  query: string;
  replacement: string;
  matchCase: boolean;
  wholeCell: boolean;
  inFormulas: boolean;
  ignoreAccents: boolean;
  scope: 'sheet' | 'selection';
}

/** What the session needs from the grid: scrolling to a match and repainting. A narrow interface keeps it testable. */
export interface FindHost {
  scrollCellIntoView(viewRow: number, viewCol: number): void;
  invalidate(): void;
}

export interface FindSnapshot {
  open: boolean;
  /** The replace row is shown. */
  replaceMode: boolean;
  settings: FindSettings;
  count: number;
  /** 0-based position of the current match, or -1. */
  index: number;
  truncated: boolean;
  /** The selection the "selected range" scope refers to, or null. */
  scopeRange: ViewRange | null;
  /** Result of the last Replace / Replace all, shown once. */
  replaced: { occurrences: number; cells: number } | null;
}

const KEY_STRIDE = 16_384; // columns never exceed this, so row * stride + col is unique

const DEFAULTS: FindSettings = { query: '', replacement: '', matchCase: false, wholeCell: false, inFormulas: false, ignoreAccents: false, scope: 'sheet' };

/**
 * State of the Find / Replace panel: the settings, the matches in reading order, which one is current, and the
 * highlighting the grid draws. React only shows it (`subscribe`/`getSnapshot`); the work happens here.
 * While open it keeps the matches in step with edits, sorting and hiding.
 */
export class FindSession {
  private open = false;
  private replaceMode = false;
  private settings: FindSettings = { ...DEFAULTS };
  private matches: Array<{ row: number; col: number }> = [];
  private keys = new Set<number>();
  private index = -1;
  private truncated = false;
  private scopeRange: ViewRange | null = null;
  private replaced: FindSnapshot['replaced'] = null;
  private readonly listeners = new Set<() => void>();
  private cached: FindSnapshot | null = null;
  private stopWatching: (() => void) | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly sheet: Spreadsheet,
    private readonly host: FindHost,
  ) {}

  get isOpen(): boolean {
    return this.open;
  }

  /** Cells to highlight and which one is the current match, for the canvas overlay. */
  isMatch(viewRow: number, viewCol: number): boolean {
    return this.open && this.keys.has(viewRow * KEY_STRIDE + viewCol);
  }

  isCurrent(viewRow: number, viewCol: number): boolean {
    const m = this.matches[this.index];
    return this.open && m !== undefined && m.row === viewRow && m.col === viewCol;
  }

  get matchCount(): number {
    return this.keys.size;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): FindSnapshot => {
    this.cached ??= {
      open: this.open,
      replaceMode: this.replaceMode,
      settings: this.settings,
      count: this.matches.length,
      index: this.index,
      truncated: this.truncated,
      scopeRange: this.scopeRange,
      replaced: this.replaced,
    };
    return this.cached;
  };

  /** Opens the panel. A single selected cell with some text becomes the query, as in Sheets. */
  show(replaceMode: boolean): void {
    this.replaceMode = replaceMode || (this.open && this.replaceMode);
    if (!this.open) {
      this.open = true;
      this.stopWatching = this.sheet.subscribeChanges(() => this.scheduleRefresh());
    }
    const { selection } = this.sheet;
    if (selection.isSingleCell()) {
      const text = this.sheet.getDisplayText(selection.activeRow, selection.activeCol);
      if (text !== '' && text.length <= 100 && !/[\r\n]/.test(text)) this.settings = { ...this.settings, query: text };
    }
    const p = selection.primary;
    this.scopeRange = selection.isSingleCell() ? null : { ...p };
    if (this.scopeRange === null && this.settings.scope === 'selection') this.settings = { ...this.settings, scope: 'sheet' };
    this.replaced = null;
    this.search(true);
  }

  hide(): void {
    if (!this.open) return;
    this.open = false;
    this.stopWatching?.();
    this.stopWatching = null;
    clearTimeout(this.timer);
    this.matches = [];
    this.keys = new Set();
    this.index = -1;
    this.changed();
  }

  setReplaceMode(on: boolean): void {
    this.replaceMode = on;
    this.changed();
  }

  update(patch: Partial<FindSettings>): void {
    this.settings = { ...this.settings, ...patch };
    if (patch.scope === 'selection' && this.scopeRange === null) {
      const p = this.sheet.selection.primary;
      this.scopeRange = { ...p };
    }
    this.replaced = null;
    // Replacement text does not change what matches.
    const onlyReplacement = Object.keys(patch).every((k) => k === 'replacement');
    if (onlyReplacement) this.changed();
    else this.search(true);
  }

  next(): void {
    this.step(1);
  }

  previous(): void {
    this.step(-1);
  }

  /** Replaces in the current match's cell and moves on. */
  replaceCurrent(): void {
    if (this.settings.query === '') return;
    const current = this.matches[this.index];
    if (current === undefined) {
      this.next();
      return;
    }
    const result = this.sheet.replaceInCells(this.options(), this.settings.replacement, [current]);
    this.replaced = result.cells > 0 ? { occurrences: result.occurrences, cells: result.cells } : null;
    // Moves to the next match either way: a cell that matched only through its display has nothing to replace, so it is skipped.
    this.search(false, current);
    this.go();
    this.changed();
  }

  replaceAll(): void {
    if (this.settings.query === '') return;
    const result = this.sheet.replaceInCells(this.options(), this.settings.replacement, this.matches);
    this.replaced = { occurrences: result.occurrences, cells: result.cells };
    this.search(false);
  }

  private options(): FindOptions {
    const s = this.settings;
    return {
      query: s.query,
      matchCase: s.matchCase,
      wholeCell: s.wholeCell,
      inFormulas: s.inFormulas,
      ignoreAccents: s.ignoreAccents,
      range: s.scope === 'selection' ? this.scopeRange : null,
    };
  }

  /**
   * Recomputes the matches. `jump` selects the first match at or after the active cell (typing in the box moves
   * to it); otherwise the current position is kept near `after` (the cell just replaced) or where it was.
   */
  private search(jump: boolean, after?: { row: number; col: number }): void {
    const result = this.sheet.findCells(this.options());
    const previous = after ?? this.matches[this.index];
    this.matches = result.matches;
    this.truncated = result.truncated;
    this.keys = new Set(result.matches.map((m) => m.row * KEY_STRIDE + m.col));
    if (this.matches.length === 0) {
      this.index = -1;
    } else if (jump) {
      const { activeRow, activeCol } = this.sheet.selection;
      this.index = this.firstAtOrAfter(activeRow, activeCol, true);
      this.go();
    } else if (previous !== undefined) {
      // After a replace the replaced cell may still match; move strictly past it.
      this.index = this.firstAtOrAfter(previous.row, previous.col, after === undefined);
    } else {
      this.index = 0;
    }
    this.changed();
  }

  private firstAtOrAfter(row: number, col: number, inclusive: boolean): number {
    const i = this.matches.findIndex((m) => (inclusive ? m.row > row || (m.row === row && m.col >= col) : m.row > row || (m.row === row && m.col > col)));
    return i < 0 ? 0 : i;
  }

  private step(by: 1 | -1): void {
    const n = this.matches.length;
    if (n === 0) return;
    this.index = this.index < 0 ? (by === 1 ? 0 : n - 1) : (this.index + by + n) % n;
    this.replaced = null;
    this.go();
    this.changed();
  }

  private go(): void {
    const m = this.matches[this.index];
    if (m === undefined) return;
    this.sheet.selection.selectCell(m.row, m.col);
    this.host.scrollCellIntoView(m.row, m.col);
  }

  private scheduleRefresh(): void {
    clearTimeout(this.timer);
    // Edits come in bursts (typing, replace all); one recompute after they settle.
    this.timer = setTimeout(() => {
      if (this.open) this.search(false);
    }, 80);
  }

  private changed(): void {
    this.cached = null;
    this.host.invalidate();
    for (const listener of this.listeners) listener();
  }

  destroy(): void {
    this.hide();
    this.listeners.clear();
  }
}
