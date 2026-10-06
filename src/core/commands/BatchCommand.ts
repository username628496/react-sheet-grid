import type { Spreadsheet } from '../Spreadsheet';
import type { Command } from './Command';

/**
 * Several commands that the user sees as one action (e.g. importing a file grows the sheet and fills it): undo and redo
 * move through all of them at once. Built by `Spreadsheet.transaction`, which has already applied them.
 */
export class BatchCommand implements Command {
  constructor(
    readonly label: string,
    private readonly commands: readonly Command[],
  ) {}

  apply(sheet: Spreadsheet): void {
    for (const command of this.commands) command.apply(sheet);
  }

  invert(sheet: Spreadsheet): void {
    for (let i = this.commands.length - 1; i >= 0; i--) (this.commands[i] as Command).invert(sheet);
  }
}
