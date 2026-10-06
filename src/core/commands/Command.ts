import type { Spreadsheet } from '../Spreadsheet';

/**
 * Every model change goes through a Command. One user action is one command,
 * so undo reverts it in a single step. `invert` must restore exactly the
 * state from before `apply`, even when `apply` runs again after a redo.
 */
export interface Command {
  readonly label: string;
  apply(sheet: Spreadsheet): void;
  invert(sheet: Spreadsheet): void;
}
