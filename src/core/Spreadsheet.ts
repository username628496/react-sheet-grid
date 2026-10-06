import type { Command } from './commands/Command';
import { type CellChange, SetCellsCommand } from './commands/SetCellsCommand';
import { FormulaEngine } from '../formula/engine';
import { parseFormulaSafe } from '../formula/parser';
import { printFormula } from '../formula/print';
import { fillCells, type FillDirection } from './fill';
import { History } from './history/History';
import { AxisLayout } from './layout/AxisLayout';
import { ViewMapping } from './mapping/ViewMapping';
import type { Cell } from './model/Cell';
import { formatValue } from './model/format';
import { parseInput } from './model/parseInput';
import { cellKey, SheetModel } from './model/SheetModel';
import { type Style, StyleTable } from './model/StyleTable';
import { SelectionModel, type ViewRange } from './selection/SelectionModel';

export interface SpreadsheetOptions {
  rowCount?: number;
  colCount?: number;
  defaultRowHeight?: number;
  defaultColWidth?: number;
}

type Listener = () => void;

const FORMAT_FILL_LIMIT = 50_000;
const MAX_TILED_CELLS = 1_000_000;
const MAX_READ_CELLS = 100_000;

/**
 * Headless spreadsheet: model, styles, view mapping, layout, selection and
 * history in one place. Pure TypeScript with no DOM, so it runs in Node and
 * in a Web Worker. UI code reads from here and mutates only via `execute`.
 */
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
  /** Data keys written since the last recalculation. Only tracked while formulas exist (or one is being added). */
  private readonly dirty = new Set<number>();

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

  get rowCount(): number {
    return this.mapping.viewRowCount;
  }

  get colCount(): number {
    return this.mapping.colCount;
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

  execute(command: Command): void {
    this.history.execute(command, this);
    this.flushFormulas();
    this.notify();
  }

  undo(): boolean {
    const done = this.history.undo(this);
    if (done) {
      this.flushFormulas();
      this.notify();
    }
    return done;
  }

  redo(): boolean {
    const done = this.history.redo(this);
    if (done) {
      this.flushFormulas();
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
  toggleStyle(key: 'bold' | 'italic'): void {
    const targets = this.formatTargets();
    const allOn = targets.length > 0 && targets.every((t) => this.styles.get(t.cell.styleId)[key] === true);
    this.applyStyle(targets, { [key]: allOn ? undefined : true }, key === 'bold' ? 'Bold' : 'Italic');
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
    if (rows === 0 || cols === 0) return null;
    const target = this.selection.primary;
    const th = target.endRow - target.startRow + 1;
    const tw = target.endCol - target.startCol + 1;
    // The cap stops one paste into a whole-column selection from allocating millions of cells.
    const tiled = th >= rows && tw >= cols && th % rows === 0 && tw % cols === 0 && th * tw <= MAX_TILED_CELLS;
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
