import { BatchCommand } from './commands/BatchCommand';
import type { Command } from './commands/Command';
import { type CellChange, SetCellsCommand } from './commands/SetCellsCommand';
import { FormulaEngine } from '../formula/engine';
import { parseFormulaSafe } from '../formula/parser';
import {
  deleteMap,
  deleteSetMap,
  IDENTITY_MAP,
  insertMap,
  moveReferences,
  moveReferencesWith,
  remapFormula,
  type Shift,
} from '../formula/transform';
import { printFormula } from '../formula/print';
import { refToText } from '../formula/refText';
import {
  DeleteColsCommand,
  DeleteRowsCommand,
  InsertColsCommand,
  InsertRowsCommand,
  type Axis,
} from './commands/StructureCommand';
import { ResizeCommand } from './commands/ResizeCommand';
import { ViewStateCommand } from './commands/ViewStateCommand';
import { type CsvDelimiter, neutralizeFormula, parseCsv, toCsv } from './csv';
import { fillCells, type FillDirection } from './fill';
import { History } from './history/History';
import { AxisLayout } from './layout/AxisLayout';
import { ViewMapping } from './mapping/ViewMapping';
import type { Cell, CellValue } from './model/Cell';
import { formatValue, shiftDecimals } from './model/format';
import { parseInput } from './model/parseInput';
import { cellKey, MAX_COLS, MAX_ROWS, SheetModel } from './model/SheetModel';
import { type Style, StyleTable } from './model/StyleTable';
import { SelectionModel, type ViewRange } from './selection/SelectionModel';
import {
  cellDisplayText,
  compareForSort,
  EMPTY_VIEW_STATE,
  isDefaultView,
  type ViewState,
} from './viewState';

export interface SelectionStats {
  /** How many numeric cells are selected. */
  count: number;
  sum: number;
  average: number;
  min: number;
  max: number;
}

export interface SpreadsheetOptions {
  rowCount?: number;
  colCount?: number;
  defaultRowHeight?: number;
  defaultColWidth?: number;
}

type Listener = () => void;

const FORMAT_FILL_LIMIT = 50_000;
const MAX_SCATTERED_MOVE = 200_000; // cut-paste cells followed one by one in a sorted/filtered view
const MAX_RANGE_CHECK = 10_000; // largest range inspected cell by cell for the same move
const MAX_TILED_CELLS = 1_000_000;
/** One paste is one undo step holding every cell, so an absurdly large one would freeze the tab and eat memory. */
export const MAX_PASTE_CELLS = 1_000_000;
/** A CSV of this many fields is already hundreds of megabytes of text; beyond it the export is refused. */
export const MAX_EXPORT_CELLS = 10_000_000;
const MAX_READ_CELLS = 100_000;

/**
 * Headless spreadsheet: model, styles, view mapping, layout, selection and
 * history in one place. Pure TypeScript with no DOM, so it runs in Node and
 * in a Web Worker. UI code reads from here and mutates only via `execute`.
 */
/** Something the user should be told about but that is not an error of the host app. Localised by the UI layer. */
export type SheetNotice = { code: 'pasteTooLarge'; cells: number; limit: number } | { code: 'exportTooLarge'; cells: number; limit: number };

export interface SizeChange {
  /** Row or column count after the change. */
  count: number;
  /** Filled cells that were in the rows/columns removed (0 when growing). */
  removedCells: number;
}

export class Spreadsheet {
  readonly model = new SheetModel();
  readonly styles = new StyleTable();
  readonly mapping: ViewMapping;
  readonly rows: AxisLayout;
  readonly cols: AxisLayout;
  readonly engine: FormulaEngine;
  readonly history = new History();
  readonly selection: SelectionModel;
  private readonly listeners = new Set<Listener>();
  private readonly noticeListeners = new Set<(notice: SheetNotice) => void>();
  private state: ViewState = EMPTY_VIEW_STATE;
  /** Rows and columns kept in view while scrolling. Frozen rows are the header: sorting and filtering never touch them. */
  frozenRows = 0;
  frozenCols = 0;
  /** Data keys written since the last recalculation. Only tracked while formulas exist (or one is being added). */
  private readonly dirty = new Set<number>();
  private readOnlyFlag = false;
  /** Commands applied so far inside `transaction`, or null outside one. */
  private batch: Command[] | null = null;
  /** Document changes that do not go through the history (frozen panes). */
  private looseEdits = 0;

  constructor(options: SpreadsheetOptions = {}) {
    const rowCount = options.rowCount ?? 1000;
    const colCount = options.colCount ?? 26;
    this.mapping = new ViewMapping(rowCount, colCount);
    this.rows = new AxisLayout(rowCount, options.defaultRowHeight ?? 21);
    this.cols = new AxisLayout(colCount, options.defaultColWidth ?? 100);
    this.selection = new SelectionModel(this, () => this.notify());
    this.engine = new FormulaEngine(this.model);
    this.model.onCellChange = (dataRow, dataCol, cell) => {
      if (cell.formula !== undefined || this.engine.hasFormulas) this.dirty.add(cellKey(dataRow, dataCol));
    };
  }

  /** Recomputes formulas affected by writes since the last call. Commands run this after apply and invert. */
  private flushFormulas(): void {
    if (this.dirty.size === 0) return;
    this.engine.recalc(this.dirty);
    this.dirty.clear();
  }

  /** Recomputes every formula; call after loading data straight into the model. */
  recalculateAll(): void {
    this.dirty.clear();
    this.engine.rebuildAll();
    this.notify();
  }

  /** Rows at the top that sorting and filtering leave alone (same as the frozen rows). */
  get headerRows(): number {
    return this.frozenRows;
  }

  set headerRows(count: number) {
    this.frozenRows = count;
  }

  /** Freezes the first `rows` rows and `cols` columns (clamped so something stays scrollable). Not an undo step. */
  setFrozen(rows: number, cols: number): void {
    const clamp = (n: number, count: number): number => Math.max(0, Math.min(count - 1, Number.isFinite(n) ? Math.trunc(n) : 0));
    const nextRows = clamp(rows, this.rowCount);
    const nextCols = clamp(cols, this.colCount);
    if (nextRows === this.frozenRows && nextCols === this.frozenCols) return;
    this.frozenRows = nextRows;
    this.frozenCols = nextCols;
    this.looseEdits++;
    this.notify();
  }

  get rowCount(): number {
    return this.mapping.viewRowCount;
  }

  get colCount(): number {
    return this.mapping.colCount;
  }

  /** Messages for the user about something the sheet refused to do (the toolbar shows them). */
  subscribeNotices(listener: (notice: SheetNotice) => void): () => void {
    this.noticeListeners.add(listener);
    return () => this.noticeListeners.delete(listener);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify(): void {
    for (const listener of this.listeners) listener();
  }

  getCellByView(viewRow: number, viewCol: number): Cell {
    return this.model.getCell(this.mapping.toDataRow(viewRow), this.mapping.toDataCol(viewCol));
  }

  getDisplayText(viewRow: number, viewCol: number): string {
    const cell = this.getCellByView(viewRow, viewCol);
    return formatValue(cell.value, this.styles.get(cell.styleId).numberFormat);
  }

  /** What the editor should show when editing starts. */
  getEditText(viewRow: number, viewCol: number): string {
    const cell = this.getCellByView(viewRow, viewCol);
    if (cell.formula !== undefined) {
      return printFormula(cell.formula, this.mapping.toDataRow(viewRow), this.mapping.toDataCol(viewCol));
    }
    const { value } = cell;
    if (value === null) return '';
    if (typeof value === 'string') {
      // Text that would parse as something else needs the apostrophe to survive a round trip.
      return parseInput(value) === value ? value : `'${value}`;
    }
    return formatValue(value);
  }

  /**
   * While true, nothing that changes the document runs: cell edits, formatting, pasting, inserting and deleting
   * rows/columns, resizing the sheet, undo and redo. Changing how the sheet is *viewed* still works (sorting, filtering,
   * column/row sizes, hiding, freezing), as in a shared Sheets file you can only view.
   */
  get readOnly(): boolean {
    return this.readOnlyFlag;
  }

  set readOnly(value: boolean) {
    if (value === this.readOnlyFlag) return;
    this.readOnlyFlag = value;
    this.notify();
  }

  /**
   * A number that changes whenever the document does (edits, undo, redo, freezing) and never for selection or scroll.
   * Compare it to the last value you saved to know whether there is anything to save.
   */
  get revision(): number {
    return this.history.version + this.looseEdits;
  }

  /** Like `subscribe`, but only called when the document changed (see `revision`), not on selection moves. */
  subscribeChanges(listener: () => void): () => void {
    let seen = this.revision;
    return this.subscribe(() => {
      const now = this.revision;
      if (now === seen) return;
      seen = now;
      listener();
    });
  }

  execute(command: Command): void {
    if (this.readOnlyFlag && !(command instanceof ResizeCommand || command instanceof ViewStateCommand)) return;
    if (this.batch !== null) {
      // Inside a transaction the command is applied now but only the finished batch becomes an undo step.
      command.apply(this);
      this.batch.push(command);
      this.flushFormulas();
      this.notify();
      return;
    }
    this.history.execute(command, this);
    this.flushFormulas();
    this.notify();
  }

  /**
   * Runs `work` and makes everything it executes ONE undo step. Nested calls join the outer one. If `work` throws, what
   * was already applied stays applied and is still undoable as one step.
   */
  transaction(label: string, work: () => void): void {
    if (this.batch !== null) {
      work();
      return;
    }
    this.batch = [];
    try {
      work();
    } finally {
      const done = this.batch;
      this.batch = null;
      if (done.length === 1) this.history.record(done[0] as Command);
      else if (done.length > 1) this.history.record(new BatchCommand(label, done));
    }
  }

  undo(): boolean {
    if (this.readOnlyFlag) return false;
    const done = this.history.undo(this);
    if (done) {
      this.flushFormulas();
      this.moveSelectionOffHidden();
      this.notify();
    }
    return done;
  }

  redo(): boolean {
    if (this.readOnlyFlag) return false;
    const done = this.history.redo(this);
    if (done) {
      this.flushFormulas();
      this.moveSelectionOffHidden();
      this.notify();
    }
    return done;
  }

  /** Turns what the user typed into a cell: `=...` becomes a formula (stored relative to its position), anything else a value. */
  cellFromInput(text: string, dataRow: number, dataCol: number, styleId: number): Cell {
    if (text.length > 1 && text.startsWith('=')) {
      return { value: null, styleId, formula: parseFormulaSafe(text, dataRow, dataCol) };
    }
    return { value: parseInput(text), styleId };
  }

  /** Visits stored cells inside a view range, giving data coordinates. Cost scales with stored cells, never with range area. */
  forEachStoredCellInViewRange(
    range: ViewRange,
    visit: (dataRow: number, dataCol: number, cell: Cell) => void,
  ): void {
    if (this.mapping.isIdentity) {
      this.model.forEachCellInRange(
        { startRow: range.startRow, startCol: range.startCol, endRow: range.endRow, endCol: range.endCol },
        visit,
      );
      return;
    }
    this.model.forEachCell((dataRow, dataCol, cell) => {
      const viewRow = this.mapping.toViewRow(dataRow);
      const viewCol = this.mapping.toViewCol(dataCol);
      if (viewRow >= range.startRow && viewRow <= range.endRow && viewCol >= range.startCol && viewCol <= range.endCol) {
        visit(dataRow, dataCol, cell);
      }
    });
  }

  /** Types `text` into a cell the way the editor does. */
  setCellInput(viewRow: number, viewCol: number, text: string): void {
    const dataRow = this.mapping.toDataRow(viewRow);
    const dataCol = this.mapping.toDataCol(viewCol);
    const old = this.model.getCell(dataRow, dataCol);
    const change: CellChange = { dataRow, dataCol, cell: this.cellFromInput(text, dataRow, dataCol, old.styleId) };
    this.execute(new SetCellsCommand('Edit cell', [change]));
  }

  /**
   * Cells a format change applies to. Small ranges include empty cells so
   * formatting a blank block works; huge ranges (whole columns, select-all)
   * only touch stored cells, otherwise one click would allocate millions of cells.
   */
  private formatTargets(): Array<{ dataRow: number; dataCol: number; cell: Cell }> {
    const targets: Array<{ dataRow: number; dataCol: number; cell: Cell }> = [];
    for (const range of this.selection.allRanges) {
      const area = (range.endRow - range.startRow + 1) * (range.endCol - range.startCol + 1);
      if (area > FORMAT_FILL_LIMIT) {
        this.forEachStoredCellInViewRange(range, (dataRow, dataCol, cell) => targets.push({ dataRow, dataCol, cell }));
        continue;
      }
      for (let r = range.startRow; r <= range.endRow; r++) {
        const dataRow = this.mapping.toDataRow(r);
        for (let c = range.startCol; c <= range.endCol; c++) {
          const dataCol = this.mapping.toDataCol(c);
          targets.push({ dataRow, dataCol, cell: this.model.getCell(dataRow, dataCol) });
        }
      }
    }
    return targets;
  }

  /** Ctrl+B / Ctrl+I: if every selected cell already has the style it is removed, otherwise it is applied to all. */
  toggleStyle(key: 'bold' | 'italic' | 'underline' | 'strike'): void {
    const targets = this.formatTargets();
    const allOn = targets.length > 0 && targets.every((t) => this.styles.get(t.cell.styleId)[key] === true);
    const labels = { bold: 'Bold', italic: 'Italic', underline: 'Underline', strike: 'Strikethrough' };
    this.applyStyle(targets, { [key]: allOn ? undefined : true }, labels[key]);
  }

  /**
   * How many rows a double-click on the fill handle should fill downwards: as many as the neighbouring column
   * (left first, then right) has data in, continuing from the last row of `source`. 0 when no neighbour guides it.
   */
  autoFillExtent(source: ViewRange): number {
    for (const col of [source.startCol - 1, source.endCol + 1]) {
      if (col < 0 || col >= this.colCount) continue;
      // The guide column must have data next to the source's last row, otherwise it says nothing about this block.
      if (this.getCellByView(source.endRow, col).value === null) continue;
      let n = 0;
      for (let r = source.endRow + 1; r < this.rowCount && this.getCellByView(r, col).value !== null; r++) n++;
      return n;
    }
    return 0;
  }

  /**
   * Hides the rows/columns `first..last` (view indices) as one undo step. Navigation skips hidden lines, and at least
   * one line always stays visible. Returns how many were hidden.
   */
  hideLines(axis: Axis, first: number, last: number): number {
    const layout = axis === 'row' ? this.rows : this.cols;
    const from = Math.max(0, Math.min(first, last));
    const to = Math.min(layout.count - 1, Math.max(first, last));
    const already = new Set(layout.hiddenIn(from, to));
    const targets: number[] = [];
    for (let i = from; i <= to; i++) if (!already.has(i)) targets.push(i);
    if (targets.length === 0 || layout.count - layout.hiddenCount - targets.length < 1) return 0;
    this.execute(new ResizeCommand(axis, targets, 0));
    this.moveSelectionOffHidden();
    return targets.length;
  }

  /** Shows the hidden rows/columns inside `first..last` again, at the default size. Returns how many came back. */
  showLines(axis: Axis, first: number, last: number): number {
    const layout = axis === 'row' ? this.rows : this.cols;
    const hidden = layout.hiddenIn(Math.max(0, Math.min(first, last)), Math.min(layout.count - 1, Math.max(first, last)));
    if (hidden.length === 0) return 0;
    this.execute(new ResizeCommand(axis, hidden, layout.defaultSize));
    return hidden.length;
  }

  // The active cell must never sit in a hidden line: move it to the next visible one, or the previous when none follow.
  private moveSelectionOffHidden(): void {
    const { activeRow, activeCol } = this.selection;
    const nearest = (layout: AxisLayout, at: number): number => {
      for (let i = at; i < layout.count; i++) if (layout.getSize(i) > 0) return i;
      for (let i = at - 1; i >= 0; i--) if (layout.getSize(i) > 0) return i;
      return at;
    };
    const row = nearest(this.rows, activeRow);
    const col = nearest(this.cols, activeCol);
    if (row !== activeRow || col !== activeCol) this.selection.selectCell(row, col);
  }

  /**
   * The sheet (or `range`, in view coordinates) as CSV text. By default it covers everything from A1 to the last used
   * cell and writes what the cells display, like Google Sheets' "Download as CSV". Returns null when the area is
   * too large (a notice is sent). Text cells that start with `= + - @` are prefixed with an apostrophe so a spreadsheet
   * program opening the file does not run them as formulas; turn that off with `neutralize: false`.
   */
  exportCsv(
    options: {
      range?: ViewRange;
      delimiter?: CsvDelimiter;
      /** 'displayed' (default): as shown, e.g. "$1,234.50"; 'raw': plain values; 'formulas': formulas as typed. */
      content?: 'displayed' | 'raw' | 'formulas';
      neutralize?: boolean;
    } = {},
  ): string | null {
    const bounds = this.getUsedViewBounds();
    const range = options.range ?? (bounds === null ? null : { startRow: 0, startCol: 0, endRow: bounds.row, endCol: bounds.col });
    if (range === null) return '';
    const rows = range.endRow - range.startRow + 1;
    const cols = range.endCol - range.startCol + 1;
    if (rows * cols > MAX_EXPORT_CELLS) {
      for (const listener of this.noticeListeners) listener({ code: 'exportTooLarge', cells: rows * cols, limit: MAX_EXPORT_CELLS });
      return null;
    }
    const content = options.content ?? 'displayed';
    const neutralize = options.neutralize ?? true;
    const out: string[][] = [];
    for (let r = range.startRow; r <= range.endRow; r++) {
      const line: string[] = [];
      for (let c = range.startCol; c <= range.endCol; c++) {
        const cell = this.getCellByView(r, c);
        let text: string;
        if (cell.value === null && cell.formula === undefined) text = '';
        else if (content === 'formulas') text = cell.formula !== undefined ? this.getEditText(r, c) : this.getDisplayText(r, c);
        else if (content === 'raw') text = typeof cell.value === 'number' ? String(Number(cell.value.toPrecision(15))) : formatValue(cell.value);
        else text = this.getDisplayText(r, c);
        if (neutralize && cell.formula === undefined && typeof cell.value === 'string') text = neutralizeFormula(text);
        line.push(text);
      }
      out.push(line);
    }
    return toCsv(out, options.delimiter ?? ',');
  }

  /**
   * Reads CSV text into the sheet starting at the active cell, as one undo step, growing the sheet when the data does not
   * fit. Values are interpreted as if typed (numbers, TRUE/FALSE, formulas starting with "="). Returns the size
   * read, or null when nothing was imported (empty text, read-only, or too large: a notice is sent).
   */
  importCsv(text: string, options: { delimiter?: CsvDelimiter } = {}): { rows: number; cols: number } | null {
    if (this.readOnlyFlag) return null;
    const matrix = parseCsv(text, options.delimiter);
    const rows = matrix.length;
    const cols = matrix.reduce((w, r) => Math.max(w, r.length), 0);
    if (rows === 0 || cols === 0) return null;
    if (rows * cols > MAX_PASTE_CELLS) {
      for (const listener of this.noticeListeners) listener({ code: 'pasteTooLarge', cells: rows * cols, limit: MAX_PASTE_CELLS });
      return null;
    }
    const { startRow, startCol } = this.selection.primary;
    this.transaction('Import CSV', () => {
      if (startRow + rows > this.rowCount) this.setRowCount(startRow + rows);
      if (startCol + cols > this.colCount) this.setColCount(startCol + cols);
      this.selection.selectCell(startRow, startCol);
      this.pasteText(matrix);
    });
    return { rows, cols };
  }

  /** "Increase/decrease decimal places": the active cell decides the new pattern, the whole selection gets it. */
  shiftSelectionDecimals(delta: 1 | -1): void {
    const { activeRow, activeCol } = this.selection;
    const active = this.getCellByView(activeRow, activeCol);
    const sample = typeof active.value === 'number' ? active.value : null;
    const format = shiftDecimals(this.styles.get(active.styleId).numberFormat, delta, sample);
    this.formatSelection({ numberFormat: format }, 'Number format');
  }

  /**
   * The toolbar's Σ: writes `=NAME(range)` below the selected numbers (one formula per column), or to the right of a
   * selected row. With a single cell it sums the numbers right above (else right to the left) into that cell, which
   * is what Excel's AutoSum does. Not offered while the view is sorted or filtered, where a view range is not a
   * data range. Returns false when nothing was written.
   */
  insertFunction(name: 'SUM' | 'AVERAGE' | 'COUNT' | 'MIN' | 'MAX'): boolean {
    if (!this.mapping.isIdentity) return false;
    const p = this.selection.primary;
    const changes: CellChange[] = [];
    const put = (row: number, col: number, from: [number, number], to: [number, number]): void => {
      const old = this.model.getCell(row, col);
      changes.push({ dataRow: row, dataCol: col, cell: this.cellFromInput(`=${name}(${refToText(from[0], from[1], to[0], to[1])})`, row, col, old.styleId) });
    };
    const isNumber = (r: number, c: number): boolean => typeof this.model.getCell(r, c).value === 'number';
    let target: { row: number; col: number };

    if (p.startRow === p.endRow && p.startCol === p.endCol) {
      const { startRow: r, startCol: c } = p;
      let top = r;
      while (top > 0 && isNumber(top - 1, c)) top--;
      let left = c;
      while (left > 0 && isNumber(r, left - 1)) left--;
      if (top < r) put(r, c, [top, c], [r - 1, c]);
      else if (left < c) put(r, c, [r, left], [r, c - 1]);
      else put(r, c, [r, c], [r, c]); // nothing to sum: leave a formula the user can adjust
      target = { row: r, col: c };
    } else if (p.startRow === p.endRow) {
      if (p.endCol + 1 >= this.colCount) return false;
      put(p.startRow, p.endCol + 1, [p.startRow, p.startCol], [p.endRow, p.endCol]);
      target = { row: p.startRow, col: p.endCol + 1 };
    } else {
      if (p.endRow + 1 >= this.rowCount) return false;
      for (let c = p.startCol; c <= p.endCol; c++) put(p.endRow + 1, c, [p.startRow, c], [p.endRow, c]);
      target = { row: p.endRow + 1, col: p.startCol };
    }
    this.execute(new SetCellsCommand(name, changes));
    this.selection.selectCell(target.row, target.col);
    return true;
  }

  /** Mod+\: back to the default look; values and formulas stay. */
  clearFormatting(): void {
    const targets = this.formatTargets().filter((t) => t.cell.styleId !== 0);
    if (targets.length === 0) return;
    this.execute(new SetCellsCommand('Clear formatting', targets.map((t) => ({ dataRow: t.dataRow, dataCol: t.dataCol, cell: { ...t.cell, styleId: 0 } }))));
  }

  /**
   * Mod+D / Mod+R: copies the first row (or column) of the selection over the rest, as a plain copy
   * (formulas adapt through their relative references, no series). With a single row/column selected it
   * copies from the neighbour above/left, like Sheets. Returns false when there is nothing to do.
   */
  fillFromEdge(direction: 'down' | 'right'): boolean {
    const p = this.selection.primary;
    const down = direction === 'down';
    const lines = down ? p.endRow - p.startRow + 1 : p.endCol - p.startCol + 1;
    const lanes = down ? p.endCol - p.startCol + 1 : p.endRow - p.startRow + 1;
    const fromNeighbour = lines === 1;
    const sourceIndex = (down ? p.startRow : p.startCol) - (fromNeighbour ? 1 : 0);
    if (sourceIndex < 0 || lines * lanes > MAX_TILED_CELLS) return false;
    const changes: CellChange[] = [];
    for (let lane = 0; lane < lanes; lane++) {
      const sr = down ? sourceIndex : p.startRow + lane;
      const sc = down ? p.startCol + lane : sourceIndex;
      const source = this.getCellByView(sr, sc);
      for (let k = fromNeighbour ? 0 : 1; k < lines; k++) {
        const r = down ? p.startRow + k : sr;
        const c = down ? sc : p.startCol + k;
        changes.push({ dataRow: this.mapping.toDataRow(r), dataCol: this.mapping.toDataCol(c), cell: source });
      }
    }
    if (changes.length === 0) return false;
    this.execute(new SetCellsCommand(down ? 'Fill down' : 'Fill right', changes));
    return true;
  }

  /** Mod+Enter while editing: enters the same text in every selected cell (formulas adapt per cell). */
  fillSelectionWithInput(text: string): boolean {
    const p = this.selection.primary;
    if ((p.endRow - p.startRow + 1) * (p.endCol - p.startCol + 1) > MAX_TILED_CELLS) return false;
    // Parsed once at the active cell: the relative references are then shared, so every cell adapts as if filled.
    const base = this.cellFromInput(text, this.mapping.toDataRow(this.selection.activeRow), this.mapping.toDataCol(this.selection.activeCol), 0);
    const changes: CellChange[] = [];
    for (let r = p.startRow; r <= p.endRow; r++) {
      const dataRow = this.mapping.toDataRow(r);
      for (let c = p.startCol; c <= p.endCol; c++) {
        const dataCol = this.mapping.toDataCol(c);
        const styleId = this.model.getCell(dataRow, dataCol).styleId;
        changes.push({ dataRow, dataCol, cell: { ...base, styleId } });
      }
    }
    this.execute(new SetCellsCommand('Fill selection', changes));
    return true;
  }

  /** Applies a style patch (color, background, align, numberFormat...) to the selection. */
  formatSelection(patch: Partial<Style>, label = 'Format'): void {
    this.applyStyle(this.formatTargets(), patch, label);
  }

  private applyStyle(
    targets: ReadonlyArray<{ dataRow: number; dataCol: number; cell: Cell }>,
    patch: Partial<Style>,
    label: string,
  ): void {
    if (targets.length === 0) return;
    const changes: CellChange[] = targets.map((t) => ({
      dataRow: t.dataRow,
      dataCol: t.dataCol,
      cell: { ...t.cell, styleId: this.styles.derive(t.cell.styleId, patch) },
    }));
    this.execute(new SetCellsCommand(label, changes));
  }

  get viewState(): ViewState {
    return this.state;
  }

  /** Called by ViewStateCommand to put a state back without recomputing anything. */
  restoreViewState(state: ViewState): void {
    this.state = state;
    this.selection.clamp();
  }

  /** Installs a new view state and the row order derived from it. */
  setView(state: ViewState, order: Int32Array | null): void {
    this.state = state;
    this.mapping.setOrder(order);
    this.rows.setCount(this.mapping.viewRowCount);
    this.selection.clamp();
  }

  /**
   * Builds viewRow -> dataRow for a state: header rows, then the data rows that
   * pass every filter (sorted if asked), then the untouched empty rows below the
   * data so the user can still type there. Null means identity.
   */
  computeViewOrder(state: ViewState): Int32Array | null {
    if (isDefaultView(state)) return null;
    const total = this.mapping.dataRowCount;
    const header = Math.min(this.headerRows, total);
    const used = this.model.getUsedRange();
    const tableEnd = Math.max(used === null ? -1 : used.endRow, header - 1);

    let rows: number[] = [];
    const filters = [...state.filters];
    for (let r = header; r <= tableEnd; r++) {
      let visible = true;
      for (const [dataCol, allowed] of filters) {
        if (!allowed.has(cellDisplayText(this.model.getCell(r, dataCol), this.styles))) {
          visible = false;
          break;
        }
      }
      if (visible) rows.push(r);
    }
    if (state.sort !== null) {
      const { col, asc } = state.sort;
      // Keys are read once up front; Array.sort is stable, so equal values keep their original order.
      const keys = new Map<number, CellValue | null>();
      for (const r of rows) keys.set(r, this.model.getCell(r, col).value);
      rows = rows.sort((a, b) => compareForSort(keys.get(a) ?? null, keys.get(b) ?? null, asc));
    }
    const order = new Int32Array(header + rows.length + (total - 1 - tableEnd));
    let k = 0;
    for (let r = 0; r < header; r++) order[k++] = r;
    for (const r of rows) order[k++] = r;
    for (let r = tableEnd + 1; r < total; r++) order[k++] = r;
    return order;
  }

  private changeView(next: ViewState, label: string): void {
    this.execute(new ViewStateCommand(label, next));
  }

  sortByColumn(viewCol: number, asc: boolean): void {
    this.changeView({ ...this.state, sort: { col: this.mapping.toDataCol(viewCol), asc } }, 'Sort');
  }

  clearSort(): void {
    if (this.state.sort !== null) this.changeView({ ...this.state, sort: null }, 'Clear sort');
  }

  /** `allowed` null removes the filter on that column. */
  setColumnFilter(viewCol: number, allowed: ReadonlySet<string> | null): void {
    const dataCol = this.mapping.toDataCol(viewCol);
    const filters = new Map(this.state.filters);
    if (allowed === null) filters.delete(dataCol);
    else filters.set(dataCol, new Set(allowed));
    this.changeView({ ...this.state, filters }, 'Filter');
  }

  clearFilters(): void {
    if (this.state.filters.size > 0) this.changeView({ ...this.state, filters: new Map() }, 'Clear filters');
  }

  isColumnFiltered(viewCol: number): boolean {
    return this.state.filters.has(this.mapping.toDataCol(viewCol));
  }

  /** Sort direction of a column, or null when the view is not sorted by it. */
  sortDirection(viewCol: number): 'asc' | 'desc' | null {
    const s = this.state.sort;
    if (s === null || s.col !== this.mapping.toDataCol(viewCol)) return null;
    return s.asc ? 'asc' : 'desc';
  }

  /**
   * Distinct display texts of a column across the whole data range (ignoring the
   * column's own filter, so the user can widen it again), for the filter popup.
   */
  getDistinctValues(viewCol: number, limit = 1000): { values: Array<{ text: string; count: number }>; truncated: boolean } {
    const dataCol = this.mapping.toDataCol(viewCol);
    const counts = new Map<string, number>();
    const header = this.headerRows;
    const used = this.model.getUsedRange();
    const end = used === null ? -1 : used.endRow;
    // Other columns' filters still apply: only offer values that exist among rows that can be shown.
    const others = [...this.state.filters].filter(([c]) => c !== dataCol);
    this.model.forEachCellInRange({ startRow: header, startCol: dataCol, endRow: Math.max(end, header), endCol: dataCol }, (row, _c, cell) => {
      for (const [c, allowed] of others) {
        if (!allowed.has(cellDisplayText(this.model.getCell(row, c), this.styles))) return;
      }
      if (cell.value === null && cell.formula === undefined) return;
      const text = cellDisplayText(cell, this.styles);
      counts.set(text, (counts.get(text) ?? 0) + 1);
    });
    // Rows with an empty cell in this column are part of the data too.
    let rowsInTable = 0;
    for (let r = header; r <= end; r++) {
      let ok = true;
      for (const [c, allowed] of others) {
        if (!allowed.has(cellDisplayText(this.model.getCell(r, c), this.styles))) {
          ok = false;
          break;
        }
      }
      if (ok) rowsInTable++;
    }
    const nonBlank = [...counts.values()].reduce((a, b) => a + b, 0);
    if (rowsInTable > nonBlank) counts.set('', (counts.get('') ?? 0) + rowsInTable - nonBlank);

    const sorted = [...counts].map(([text, count]) => ({ text, count }));
    sorted.sort((a, b) => {
      const va = a.text === '' ? null : (Number.isNaN(Number(a.text)) ? a.text : Number(a.text));
      const vb = b.text === '' ? null : (Number.isNaN(Number(b.text)) ? b.text : Number(b.text));
      return compareForSort(va, vb, true);
    });
    return { values: sorted.slice(0, limit), truncated: sorted.length > limit };
  }

  /**
   * Inserts `count` blank rows before `viewRow` (in a sorted or filtered view the blank rows appear exactly there).
   * Returns false when refused (bad position, or the sheet would exceed the maximum size).
   */
  insertRows(viewRow: number, count: number): boolean {
    if (count < 1 || viewRow < 0 || viewRow > this.rowCount) return false;
    if (this.mapping.dataRowCount + count > MAX_ROWS) return false;
    this.execute(new InsertRowsCommand(viewRow, count));
    return true;
  }

  insertCols(viewCol: number, count: number): boolean {
    if (count < 1 || viewCol < 0 || viewCol > this.colCount) return false;
    if (this.colCount + count > MAX_COLS) return false;
    this.execute(new InsertColsCommand(viewCol, count));
    return true;
  }

  /** Deletes `count` visible rows from `viewRow`; the last remaining row can never be deleted. */
  deleteRows(viewRow: number, count: number): boolean {
    const n = Math.min(count, this.rowCount - viewRow);
    if (n < 1 || viewRow < 0 || n >= this.rowCount) return false;
    this.execute(new DeleteRowsCommand(viewRow, n));
    return true;
  }

  deleteCols(viewCol: number, count: number): boolean {
    const n = Math.min(count, this.colCount - viewCol);
    if (n < 1 || viewCol < 0 || n >= this.colCount) return false;
    this.execute(new DeleteColsCommand(viewCol, n));
    return true;
  }

  /**
   * Makes the sheet `count` rows tall by adding or removing rows at the bottom, as one undoable step. The count is
   * clamped to [1, maximum]. Shrinking removes whatever is in the rows cut off; formulas pointing there become #REF!
   * like after any row deletion, so `removedCells` reports how many filled cells went (the host can warn; undo restores).
   */
  setRowCount(count: number): SizeChange {
    return this.resize('row', count);
  }

  setColCount(count: number): SizeChange {
    return this.resize('col', count);
  }

  private resize(axis: Axis, requested: number): SizeChange {
    const current = axis === 'row' ? this.rowCount : this.colCount;
    if (this.readOnlyFlag) return { count: current, removedCells: 0 };
    const limit = axis === 'row' ? MAX_ROWS - (this.mapping.dataRowCount - this.rowCount) : MAX_COLS;
    const target = Math.max(1, Math.min(limit, Math.trunc(Number.isFinite(requested) ? requested : current)));
    if (target === current) return { count: current, removedCells: 0 };
    const { activeRow, activeCol, primary } = this.selection;
    if (target > current) {
      this.execute(axis === 'row' ? new InsertRowsCommand(current, target - current) : new InsertColsCommand(current, target - current));
      // Inserting selects the new lines; resizing should not move the user's selection.
      this.selection.selectCell(primary.startRow, primary.startCol);
      this.selection.extendTo(primary.endRow, primary.endCol);
      this.selection.setActive(activeRow, activeCol);
      return { count: target, removedCells: 0 };
    }
    let removedCells = 0;
    this.model.forEachCell((dataRow, dataCol, cell) => {
      if (cell.value === null && cell.formula === undefined) return;
      const line = axis === 'row' ? this.mapping.toViewRow(dataRow) : this.mapping.toViewCol(dataCol);
      if (line >= target) removedCells++;
    });
    const removed = current - target;
    this.execute(axis === 'row' ? new DeleteRowsCommand(target, removed) : new DeleteColsCommand(target, removed));
    return { count: target, removedCells };
  }

  /**
   * Does the work of a StructureCommand. `at` is a view index. Cells, formulas and the row/column order all move
   * together. In a sorted or filtered view the data rows touched are not contiguous: inserted rows get fresh data
   * indices placed at `at` in the order, and deleted rows are exactly the visible ones (hidden rows survive).
   */
  applyStructure(axis: Axis, kind: 'insert' | 'delete', at: number, count: number): void {
    let rowMap = IDENTITY_MAP;
    let colMap = IDENTITY_MAP;
    const order = this.mapping.getOrder();
    let nextOrder: Int32Array | null = order;
    if (axis === 'col') {
      colMap = kind === 'insert' ? insertMap(at, count) : deleteMap(at, count);
    } else if (order === null) {
      rowMap = kind === 'insert' ? insertMap(at, count) : deleteMap(at, count);
    } else if (kind === 'insert') {
      const dataAt = at < order.length ? (order[at] as number) : this.mapping.dataRowCount;
      rowMap = insertMap(dataAt, count);
      nextOrder = new Int32Array(order.length + count);
      let k = 0;
      const shifted = (e: number): number => (e >= dataAt ? e + count : e);
      for (let i = 0; i < at; i++) nextOrder[k++] = shifted(order[i] as number);
      for (let j = 0; j < count; j++) nextOrder[k++] = dataAt + j;
      for (let i = at; i < order.length; i++) nextOrder[k++] = shifted(order[i] as number);
    } else {
      const deleted = Array.from(order.subarray(at, at + count)).sort((a, b) => a - b);
      rowMap = deleteSetMap(deleted);
      nextOrder = new Int32Array(order.length - count);
      let k = 0;
      for (let i = 0; i < order.length; i++) {
        if (i >= at && i < at + count) continue;
        const e = order[i] as number;
        nextOrder[k++] = rowMap.point(e) as number;
      }
    }

    this.model.remapCells((row, col, cell) => {
      const nr = rowMap.point(row);
      const nc = colMap.point(col);
      if (nr === null || nc === null) return null; // inside a deleted block
      if (cell.formula === undefined) return { row: nr, col: nc, cell };
      // The formula's own position changes too, so relative references are re-expressed from the new position.
      return { row: nr, col: nc, cell: { ...cell, formula: remapFormula(cell.formula, row, col, nr, nc, rowMap, colMap) } };
    });
    const layout = axis === 'row' ? this.rows : this.cols;
    if (kind === 'insert') layout.insertAt(at, count);
    else layout.deleteAt(at, count);
    const delta = kind === 'insert' ? count : -count;
    this.mapping.reshape(
      this.mapping.dataRowCount + (axis === 'row' ? delta : 0),
      this.colCount + (axis === 'col' ? delta : 0),
      nextOrder,
    );
    this.dirty.clear();
    this.engine.rebuildAll();
    if (kind === 'insert') {
      // Sheets selects what was just added.
      if (axis === 'row') {
        this.selection.selectRow(at);
        this.selection.selectRow(at + count - 1, true);
      } else {
        this.selection.selectCol(at);
        this.selection.selectCol(at + count - 1, true);
      }
    } else {
      this.selection.clamp();
    }
  }

  /**
   * Sum/average/count of the numeric cells in the selection (overlapping ranges are not double counted),
   * or null when there are none. Cost scales with stored cells, not with the area selected.
   */
  getSelectionStats(): SelectionStats | null {
    let count = 0;
    let sum = 0;
    let min = Infinity;
    let max = -Infinity;
    const ranges = this.selection.allRanges;
    const seen = ranges.length > 1 ? new Set<number>() : null;
    for (const range of ranges) {
      this.forEachStoredCellInViewRange(range, (dataRow, dataCol, cell) => {
        if (typeof cell.value !== 'number') return;
        if (seen !== null) {
          const key = cellKey(dataRow, dataCol);
          if (seen.has(key)) return;
          seen.add(key);
        }
        count++;
        sum += cell.value;
        if (cell.value < min) min = cell.value;
        if (cell.value > max) max = cell.value;
      });
    }
    return count === 0 ? null : { count, sum, average: sum / count, min, max };
  }

  /** Bottom-right of the data in view coordinates, or null for an empty sheet. */
  getUsedViewBounds(): { row: number; col: number } | null {
    const used = this.model.getUsedRange();
    if (used === null) return null;
    if (this.mapping.isIdentity) return { row: used.endRow, col: used.endCol };
    let row = -1;
    this.model.forEachCell((dataRow) => {
      const v = this.mapping.toViewRow(dataRow);
      if (v > row) row = v;
    });
    return row < 0 ? null : { row, col: used.endCol };
  }

  /**
   * Reads the cells of a view range as a matrix (rows x cols). Ranges up to
   * MAX_READ_CELLS are read exactly (trailing blanks are part of a copy); bigger ones,
   * like a whole column, are cut at the used area so we never build a 1M-row matrix.
   */
  readCells(range: ViewRange): { rows: number; cols: number; cells: Cell[][] } {
    let { endRow, endCol } = range;
    const area = (range.endRow - range.startRow + 1) * (range.endCol - range.startCol + 1);
    if (area > MAX_READ_CELLS) {
      const bounds = this.getUsedViewBounds();
      endRow = bounds === null ? range.startRow : Math.min(range.endRow, Math.max(bounds.row, range.startRow));
      endCol = bounds === null ? range.startCol : Math.min(range.endCol, Math.max(bounds.col, range.startCol));
    }
    const cells: Cell[][] = [];
    for (let r = range.startRow; r <= endRow; r++) {
      const line: Cell[] = [];
      for (let c = range.startCol; c <= endCol; c++) line.push(this.getCellByView(r, c));
      cells.push(line);
    }
    return { rows: cells.length, cols: cells[0]?.length ?? 0, cells };
  }

  /**
   * Pastes a matrix as one undoable step. `make` produces the new cell for
   * matrix position (i, j) given the cell currently there. When the selection
   * is an exact multiple of the matrix the matrix is tiled, as in Sheets.
   * `cutFrom` is cleared in the same step (cut + paste is a move).
   */
  pasteMatrix(
    rows: number,
    cols: number,
    make: (i: number, j: number, existing: Cell, dataRow: number, dataCol: number) => Cell,
    cutFrom: ViewRange | null = null,
  ): ViewRange | null {
    if (rows === 0 || cols === 0 || this.readOnlyFlag) return null;
    if (rows * cols > MAX_PASTE_CELLS) {
      for (const listener of this.noticeListeners) listener({ code: 'pasteTooLarge', cells: rows * cols, limit: MAX_PASTE_CELLS });
      return null;
    }
    const target = this.selection.primary;
    const th = target.endRow - target.startRow + 1;
    const tw = target.endCol - target.startCol + 1;
    // The cap stops one paste into a whole-column selection from allocating millions of cells.
    // Tiling means repeating the block, so the selection must be strictly larger than it.
    const tiled = (th > rows || tw > cols) && th >= rows && tw >= cols && th % rows === 0 && tw % cols === 0 && th * tw <= MAX_TILED_CELLS;
    const height = tiled ? th : rows;
    const width = tiled ? tw : cols;
    const startRow = target.startRow;
    const startCol = target.startCol;
    const endRow = Math.min(this.rowCount - 1, startRow + height - 1);
    const endCol = Math.min(this.colCount - 1, startCol + width - 1);

    const changes: CellChange[] = [];
    if (cutFrom !== null) {
      this.forEachStoredCellInViewRange(cutFrom, (dataRow, dataCol) => {
        changes.push({ dataRow, dataCol, cell: { value: null, styleId: 0 } });
      });
    }
    for (let r = startRow; r <= endRow; r++) {
      const dataRow = this.mapping.toDataRow(r);
      for (let c = startCol; c <= endCol; c++) {
        const dataCol = this.mapping.toDataCol(c);
        const cell = make((r - startRow) % rows, (c - startCol) % cols, this.model.getCell(dataRow, dataCol), dataRow, dataCol);
        changes.push({ dataRow, dataCol, cell });
      }
    }
    if (cutFrom !== null && !tiled) {
      if (this.mapping.isIdentity) this.followMovedCells(changes, cutFrom, startRow, startCol, endRow, endCol);
      else this.followMovedCellsScattered(changes, cutFrom, startRow, startCol, endRow, endCol);
    }
    this.execute(new SetCellsCommand('Paste', changes));
    this.selection.selectCell(startRow, startCol);
    this.selection.extendTo(endRow, endCol);
    return this.selection.primary;
  }

  /**
   * Fill handle: extends `source` along one axis by `count` rows/columns in one
   * undoable step and selects source plus the new area. Returns the new selection.
   */
  fillRange(source: ViewRange, direction: FillDirection, count: number): ViewRange | null {
    if (count <= 0) return null;
    const vertical = direction === 'down' || direction === 'up';
    const forward = direction === 'down' || direction === 'right';
    const limit = vertical ? this.rowCount : this.colCount;
    const edge = vertical ? (forward ? source.endRow : source.startRow) : forward ? source.endCol : source.startCol;
    const available = forward ? limit - 1 - edge : edge;
    const lines = Math.min(count, available);
    if (lines <= 0) return null;

    const area = (source.endRow - source.startRow + 1) * (source.endCol - source.startCol + 1);
    if (area > MAX_TILED_CELLS || area * lines > 4 * MAX_TILED_CELLS) return null;
    const read = this.readCells(source).cells;
    const filled = fillCells(read, direction, lines);

    const changes: CellChange[] = [];
    for (let k = 0; k < lines; k++) {
      const line = filled[k] as Cell[];
      for (let lane = 0; lane < line.length; lane++) {
        const step = forward ? k + 1 : -(k + 1);
        const viewRow = vertical ? (forward ? source.endRow : source.startRow) + step : source.startRow + lane;
        const viewCol = vertical ? source.startCol + lane : (forward ? source.endCol : source.startCol) + step;
        changes.push({
          dataRow: this.mapping.toDataRow(viewRow),
          dataCol: this.mapping.toDataCol(viewCol),
          cell: line[lane] as Cell,
        });
      }
    }
    this.execute(new SetCellsCommand('Fill', changes));
    const result: ViewRange = {
      startRow: vertical && !forward ? source.startRow - lines : source.startRow,
      endRow: vertical && forward ? source.endRow + lines : source.endRow,
      startCol: !vertical && !forward ? source.startCol - lines : source.startCol,
      endCol: !vertical && forward ? source.endCol + lines : source.endCol,
    };
    this.selection.selectCell(result.startRow, result.startCol);
    this.selection.extendTo(result.endRow, result.endCol);
    return result;
  }

  /**
   * Cut-paste moves cells, so formulas that pointed at them must follow (formulas inside the block as well as
   * the ones elsewhere). Only for the natural row order, where view and data coordinates coincide.
   */
  private followMovedCells(
    changes: CellChange[],
    from: ViewRange,
    toRow: number,
    toCol: number,
    toEndRow: number,
    toEndCol: number,
  ): void {
    const dr = toRow - from.startRow;
    const dc = toCol - from.startCol;
    if (dr === 0 && dc === 0) return;
    const rect = { r1: from.startRow, c1: from.startCol, r2: from.endRow, c2: from.endCol };
    const written = new Set(changes.map((c) => cellKey(c.dataRow, c.dataCol)));
    for (let i = 0; i < changes.length; i++) {
      const change = changes[i] as CellChange;
      const f = change.cell.formula;
      const insideTarget =
        change.dataRow >= toRow && change.dataRow <= toEndRow && change.dataCol >= toCol && change.dataCol <= toEndCol;
      if (f === undefined || !insideTarget) continue;
      const moved = moveReferences(f, change.dataRow, change.dataCol, rect, dr, dc);
      if (moved !== f) changes[i] = { ...change, cell: { ...change.cell, formula: moved } };
    }
    this.model.forEachCell((row, col, cell) => {
      if (cell.formula === undefined || written.has(cellKey(row, col))) return;
      const moved = moveReferences(cell.formula, row, col, rect, dr, dc);
      if (moved !== cell.formula) changes.push({ dataRow: row, dataCol: col, cell: { ...cell, formula: moved } });
    });
  }

  /**
   * Same as followMovedCells for a sorted or filtered view, where a block of view cells is scattered in data
   * coordinates, so the move is described cell by cell. A range follows only if every cell in it moved by the same
   * amount (and it is small enough to check); otherwise it stays, as a partially moved range does.
   */
  private followMovedCellsScattered(
    changes: CellChange[],
    from: ViewRange,
    toRow: number,
    toCol: number,
    toEndRow: number,
    toEndCol: number,
  ): void {
    const height = Math.min(from.endRow - from.startRow, toEndRow - toRow) + 1;
    const width = Math.min(from.endCol - from.startCol, toEndCol - toCol) + 1;
    if (height * width > MAX_SCATTERED_MOVE) return;
    const shifts = new Map<number, Shift>();
    const targets = new Set<number>();
    for (let i = 0; i < height; i++) {
      const sourceRow = this.mapping.toDataRow(from.startRow + i);
      const targetRow = this.mapping.toDataRow(toRow + i);
      for (let j = 0; j < width; j++) {
        const sourceCol = this.mapping.toDataCol(from.startCol + j);
        const targetCol = this.mapping.toDataCol(toCol + j);
        targets.add(cellKey(targetRow, targetCol));
        if (sourceRow !== targetRow || sourceCol !== targetCol) {
          shifts.set(cellKey(sourceRow, sourceCol), [targetRow - sourceRow, targetCol - sourceCol]);
        }
      }
    }
    if (shifts.size === 0) return;
    const cellShift = (r: number, c: number): Shift | null => shifts.get(cellKey(r, c)) ?? null;
    const rangeShift = (r1: number, c1: number, r2: number, c2: number): Shift | null => {
      if ((r2 - r1 + 1) * (c2 - c1 + 1) > MAX_RANGE_CHECK) return null;
      const first = cellShift(r1, c1);
      if (first === null) return null;
      for (let r = r1; r <= r2; r++) {
        for (let c = c1; c <= c2; c++) {
          const s = cellShift(r, c);
          if (s === null || s[0] !== first[0] || s[1] !== first[1]) return null;
        }
      }
      return first;
    };
    const written = new Set(changes.map((c) => cellKey(c.dataRow, c.dataCol)));
    for (let i = 0; i < changes.length; i++) {
      const change = changes[i] as CellChange;
      const f = change.cell.formula;
      if (f === undefined || !targets.has(cellKey(change.dataRow, change.dataCol))) continue;
      const moved = moveReferencesWith(f, change.dataRow, change.dataCol, cellShift, rangeShift);
      if (moved !== f) changes[i] = { ...change, cell: { ...change.cell, formula: moved } };
    }
    this.model.forEachCell((row, col, cell) => {
      if (cell.formula === undefined || written.has(cellKey(row, col))) return;
      const moved = moveReferencesWith(cell.formula, row, col, cellShift, rangeShift);
      if (moved !== cell.formula) changes.push({ dataRow: row, dataCol: col, cell: { ...cell, formula: moved } });
    });
  }

  /** Pastes plain values (text typed into each cell the way the editor would); existing formatting is kept. */
  pasteText(matrix: readonly (readonly string[])[]): ViewRange | null {
    const rows = matrix.length;
    const cols = matrix.reduce((w, r) => Math.max(w, r.length), 0);
    return this.pasteMatrix(rows, cols, (i, j, existing, dataRow, dataCol) =>
      this.cellFromInput(matrix[i]?.[j] ?? '', dataRow, dataCol, existing.styleId),
    );
  }

  /** Delete key: removes contents of every selected range but keeps formatting. */
  clearSelection(): void {
    const changes: CellChange[] = [];
    for (const range of this.selection.allRanges) {
      this.forEachStoredCellInViewRange(range, (dataRow, dataCol, cell) => {
        if (cell.value !== null || cell.formula !== undefined) {
          changes.push({ dataRow, dataCol, cell: { value: null, styleId: cell.styleId } });
        }
      });
    }
    if (changes.length > 0) this.execute(new SetCellsCommand('Clear', changes));
  }
}
