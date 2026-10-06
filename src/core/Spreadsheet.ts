import type { Command } from './commands/Command';
import { type CellChange, SetCellsCommand } from './commands/SetCellsCommand';
import { History } from './history/History';
import { AxisLayout } from './layout/AxisLayout';
import { ViewMapping } from './mapping/ViewMapping';
import type { Cell } from './model/Cell';
import { formatValue } from './model/format';
import { parseInput } from './model/parseInput';
import { SheetModel } from './model/SheetModel';
import { StyleTable } from './model/StyleTable';
import { SelectionModel, type ViewRange } from './selection/SelectionModel';

export interface SpreadsheetOptions {
  rowCount?: number;
  colCount?: number;
  defaultRowHeight?: number;
  defaultColWidth?: number;
}

type Listener = () => void;

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
  readonly history = new History();
  readonly selection: SelectionModel;
  private readonly listeners = new Set<Listener>();

  constructor(options: SpreadsheetOptions = {}) {
    const rowCount = options.rowCount ?? 1000;
    const colCount = options.colCount ?? 26;
    this.mapping = new ViewMapping(rowCount, colCount);
    this.rows = new AxisLayout(rowCount, options.defaultRowHeight ?? 21);
    this.cols = new AxisLayout(colCount, options.defaultColWidth ?? 100);
    this.selection = new SelectionModel(this, () => this.notify());
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
    const { value } = this.getCellByView(viewRow, viewCol);
    if (value === null) return '';
    if (typeof value === 'string') {
      // Text that would parse as something else needs the apostrophe to survive a round trip.
      return parseInput(value) === value ? value : `'${value}`;
    }
    return formatValue(value);
  }

  execute(command: Command): void {
    this.history.execute(command, this);
    this.notify();
  }

  undo(): boolean {
    const done = this.history.undo(this);
    if (done) this.notify();
    return done;
  }

  redo(): boolean {
    const done = this.history.redo(this);
    if (done) this.notify();
    return done;
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
    const change: CellChange = { dataRow, dataCol, cell: { value: parseInput(text), styleId: old.styleId } };
    this.execute(new SetCellsCommand('Edit cell', [change]));
  }

  /** Delete key: removes contents of every selected range but keeps formatting. */
  clearSelection(): void {
    const changes: CellChange[] = [];
    for (const range of this.selection.allRanges) {
      this.forEachStoredCellInViewRange(range, (dataRow, dataCol, cell) => {
        if (cell.value !== null) changes.push({ dataRow, dataCol, cell: { value: null, styleId: cell.styleId } });
      });
    }
    if (changes.length > 0) this.execute(new SetCellsCommand('Clear', changes));
  }
}
