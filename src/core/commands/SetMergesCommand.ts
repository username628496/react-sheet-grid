import type { MergeRegion } from '../model/MergeTable';
import type { Spreadsheet } from '../Spreadsheet';
import type { Command } from './Command';

/** Replaces the whole set of merged blocks (merge, unmerge). Cell contents change through their own commands. */
export class SetMergesCommand implements Command {
  readonly label = 'Merge cells';
  private before: MergeRegion[] = [];

  constructor(private readonly next: readonly MergeRegion[]) {}

  apply(sheet: Spreadsheet): void {
    this.before = sheet.merges.snapshot();
    sheet.merges.set(this.next);
    sheet.selection.refit(false);
  }

  invert(sheet: Spreadsheet): void {
    sheet.merges.set(this.before);
    sheet.selection.refit(false);
  }
}
