import type { Command } from '../commands/Command';
import type { Spreadsheet } from '../Spreadsheet';

const MAX_DEPTH = 500;

export class History {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  /** Bumps on every execute/undo/redo; lets UI state (copy marquee) notice that data changed. */
  version = 0;

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  execute(command: Command, sheet: Spreadsheet): void {
    command.apply(sheet);
    this.version++;
    this.undoStack.push(command);
    if (this.undoStack.length > MAX_DEPTH) this.undoStack.shift();
    this.redoStack = [];
  }

  /** Records a command that has already been applied (a finished transaction), as one undo step. */
  record(command: Command): void {
    this.version++;
    this.undoStack.push(command);
    if (this.undoStack.length > MAX_DEPTH) this.undoStack.shift();
    this.redoStack = [];
  }

  undo(sheet: Spreadsheet): boolean {
    const command = this.undoStack.pop();
    if (command === undefined) return false;
    command.invert(sheet);
    this.version++;
    this.redoStack.push(command);
    return true;
  }

  redo(sheet: Spreadsheet): boolean {
    const command = this.redoStack.pop();
    if (command === undefined) return false;
    command.apply(sheet);
    this.version++;
    this.undoStack.push(command);
    return true;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}
