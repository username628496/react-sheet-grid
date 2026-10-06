import type { Cell } from '../model/Cell';
import type { Spreadsheet } from '../Spreadsheet';
import type { Command } from './Command';

export interface CellChange {
  readonly dataRow: number;
  readonly dataCol: number;
  readonly cell: Cell;
}

/** Writes many cells at once: typing, clear, paste, fill and formatting all reduce to this. */
export class SetCellsCommand implements Command {
  private before: Cell[] = [];

  constructor(
    readonly label: string,
    private readonly changes: readonly CellChange[],
  ) {}

  apply(sheet: Spreadsheet): void {
    const { model } = sheet;
    this.before = this.changes.map((c) => model.getCell(c.dataRow, c.dataCol));
    for (const c of this.changes) model.setCell(c.dataRow, c.dataCol, c.cell);
  }

  invert(sheet: Spreadsheet): void {
    const { model } = sheet;
    // Reverse order so a cell listed twice ends at its original value.
    for (let i = this.changes.length - 1; i >= 0; i--) {
      const c = this.changes[i] as CellChange;
      model.setCell(c.dataRow, c.dataCol, this.before[i] as Cell);
    }
  }
}
