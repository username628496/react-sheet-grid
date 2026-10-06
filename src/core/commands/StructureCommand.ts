import type { Cell } from '../model/Cell';
import type { AxisSnapshot } from '../layout/AxisLayout';
import type { Spreadsheet } from '../Spreadsheet';
import type { Command } from './Command';

export type Axis = 'row' | 'col';

interface Before {
  cells: Map<number, Cell>;
  rows: AxisSnapshot;
  cols: AxisSnapshot;
  rowCount: number;
  colCount: number;
  order: Int32Array | null;
}

/**
 * Inserting or deleting rows/columns. Data, row/column sizes and formula
 * references all move; the undo state is a snapshot of everything that
 * changed, which is exact and independent of how the shift was computed.
 */
export class StructureCommand implements Command {
  readonly label: string;
  private before: Before | null = null;

  constructor(
    private readonly axis: Axis,
    private readonly kind: 'insert' | 'delete',
    private readonly at: number,
    private readonly count: number,
  ) {
    this.label = `${kind === 'insert' ? 'Insert' : 'Delete'} ${axis === 'row' ? 'rows' : 'columns'}`;
  }

  apply(sheet: Spreadsheet): void {
    this.before = {
      cells: sheet.model.snapshotCells(),
      rows: sheet.rows.snapshot(),
      cols: sheet.cols.snapshot(),
      rowCount: sheet.mapping.dataRowCount,
      colCount: sheet.mapping.colCount,
      order: sheet.mapping.getOrder(),
    };
    sheet.applyStructure(this.axis, this.kind, this.at, this.count);
  }

  invert(sheet: Spreadsheet): void {
    const b = this.before;
    if (b === null) return;
    sheet.model.restoreCells(b.cells);
    sheet.rows.restore(b.rows);
    sheet.cols.restore(b.cols);
    sheet.mapping.reshape(b.rowCount, b.colCount, b.order);
    sheet.selection.clamp();
    sheet.engine.rebuildAll();
  }
}

export class InsertRowsCommand extends StructureCommand {
  constructor(at: number, count: number) {
    super('row', 'insert', at, count);
  }
}

export class DeleteRowsCommand extends StructureCommand {
  constructor(at: number, count: number) {
    super('row', 'delete', at, count);
  }
}

export class InsertColsCommand extends StructureCommand {
  constructor(at: number, count: number) {
    super('col', 'insert', at, count);
  }
}

export class DeleteColsCommand extends StructureCommand {
  constructor(at: number, count: number) {
    super('col', 'delete', at, count);
  }
}
