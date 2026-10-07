import { sameSheetName } from '../formula/ast';
import { type AxisMap } from '../formula/transform';
import { remapFormula, renameSheetRefs } from '../formula/transform';
import type { Cell } from './model/Cell';
import { keyCol, keyRow } from './model/SheetModel';
import { deserializeSheet, serializeSheet } from './snapshot';
import { Spreadsheet, type SpreadsheetOptions } from './Spreadsheet';

export const MAX_SHEETS = 200;
export const MAX_SHEET_NAME = 50;

export type NameProblem = 'empty' | 'tooLong' | 'invalid' | 'duplicate';

// Characters Excel and Sheets also refuse; a leading or trailing apostrophe would collide with the quoting in formulas.
const INVALID_NAME = /[[\]:*?/\\]|^'|'$/;

/** The part of the name rules that does not depend on the other sheets. */
export function sheetNameProblem(name: string): Exclude<NameProblem, 'duplicate'> | null {
  const trimmed = name.trim();
  if (trimmed === '') return 'empty';
  if ([...trimmed].length > MAX_SHEET_NAME) return 'tooLong';
  if (INVALID_NAME.test(trimmed)) return 'invalid';
  return null;
}

/** Formulas of other sheets that read a sheet, saved before a structure change so undo can put them back. */
export interface ReaderSnapshot {
  readonly entries: ReadonlyArray<{ readonly sheet: Spreadsheet; readonly cells: ReadonlyMap<number, Cell> }>;
}

/**
 * Several sheets that can read each other (`=Sheet2!A1+1`). Every sheet is a complete `Spreadsheet` with its own
 * selection and undo history; the workbook owns their names and order, keeps cross-sheet formulas up to date and
 * remembers which sheet is active. Sheet-level actions (add, rename, delete, move) are not part of any undo history.
 */
export class Workbook {
  private list: Spreadsheet[] = [];
  private activeIndexValue = 0;
  private readonly listeners = new Set<() => void>();
  private propagating = false;
  private readOnlyFlag = false;
  /** Bumps on every change to the list of sheets, their names or the active sheet. */
  revision = 0;

  constructor(first?: Spreadsheet) {
    this.attach(first ?? new Spreadsheet({ rowCount: 50, colCount: 26 }), 0);
  }

  get sheets(): readonly Spreadsheet[] {
    return this.list;
  }

  get active(): Spreadsheet {
    return this.list[this.activeIndexValue] as Spreadsheet;
  }

  get activeIndex(): number {
    return this.activeIndexValue;
  }

  get readOnly(): boolean {
    return this.readOnlyFlag;
  }

  set readOnly(value: boolean) {
    this.readOnlyFlag = value;
    for (const sheet of this.list) sheet.readOnly = value;
    this.changed();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed(): void {
    this.revision++;
    for (const listener of this.listeners) listener();
  }

  sheetByName(name: string): Spreadsheet | undefined {
    return this.list.find((s) => sameSheetName(s.name, name));
  }

  indexOf(sheet: Spreadsheet): number {
    return this.list.indexOf(sheet);
  }

  /** What is wrong with `name` as the name of a sheet (ignoring `except`, the sheet being renamed), or null. */
  nameProblem(name: string, except?: Spreadsheet): NameProblem | null {
    const trimmed = name.trim();
    const own = sheetNameProblem(trimmed);
    if (own !== null) return own;
    const clash = this.list.find((s) => s !== except && sameSheetName(s.name, trimmed));
    return clash === undefined ? null : 'duplicate';
  }

  /** `Sheet2`, `Sheet3`...: the first of them that is free. */
  uniqueName(base = 'Sheet'): string {
    for (let n = this.list.length + 1; ; n++) {
      const candidate = `${base}${n}`;
      if (this.sheetByName(candidate) === undefined) return candidate;
    }
  }

  private attach(sheet: Spreadsheet, index: number): void {
    sheet.workbook = this;
    sheet.readOnly = this.readOnlyFlag;
    this.list.splice(index, 0, sheet);
  }

  /** Adds a sheet after the active one and makes it active. Returns null when the workbook is read-only or full. */
  addSheet(options: { name?: string; sheet?: Spreadsheet } & SpreadsheetOptions = {}): Spreadsheet | null {
    if (this.readOnlyFlag || this.list.length >= MAX_SHEETS) return null;
    const wanted = options.name?.trim();
    const name = wanted !== undefined && this.nameProblem(wanted) === null ? wanted : this.uniqueName();
    const sheet = options.sheet ?? new Spreadsheet({ rowCount: options.rowCount ?? this.active.mapping.dataRowCount, colCount: options.colCount ?? this.active.colCount });
    sheet.name = name;
    const index = this.activeIndexValue + 1;
    this.attach(sheet, index);
    this.activeIndexValue = index;
    // Formulas that already mention this name (a reference that was #REF!) start working.
    this.sheetChanged(sheet);
    this.changed();
    return sheet;
  }

  /** Renames a sheet and rewrites the formulas that mention it. False when the name is not allowed. */
  renameSheet(sheet: Spreadsheet, name: string): boolean {
    const trimmed = name.trim();
    if (this.readOnlyFlag || this.nameProblem(trimmed, sheet) !== null) return false;
    const old = sheet.name;
    if (old === trimmed) return true;
    // Only a change of letter case needs no rewriting of what they point at, but the text still changes.
    sheet.name = trimmed;
    this.rewriteReferences((expr) => renameSheetRefs(expr, old, trimmed), old);
    this.changed();
    return true;
  }

  /** Deletes a sheet (never the last one). Formulas that read it become #REF!. Not undoable. */
  deleteSheet(sheet: Spreadsheet): boolean {
    const index = this.list.indexOf(sheet);
    if (this.readOnlyFlag || index < 0 || this.list.length <= 1) return false;
    this.list.splice(index, 1);
    sheet.workbook = null;
    if (this.activeIndexValue > index || this.activeIndexValue >= this.list.length) this.activeIndexValue = Math.max(0, this.activeIndexValue - 1);
    this.rewriteReferences((expr) => renameSheetRefs(expr, sheet.name, null), sheet.name);
    this.changed();
    return true;
  }

  moveSheet(sheet: Spreadsheet, toIndex: number): boolean {
    const from = this.list.indexOf(sheet);
    const to = Math.max(0, Math.min(this.list.length - 1, Math.trunc(toIndex)));
    if (this.readOnlyFlag || from < 0 || from === to) return false;
    const active = this.active;
    this.list.splice(from, 1);
    this.list.splice(to, 0, sheet);
    this.activeIndexValue = this.list.indexOf(active);
    this.changed();
    return true;
  }

  /** A copy of the sheet (cells, formats, sizes, rules) right after it, named "Name (copy)". */
  duplicateSheet(sheet: Spreadsheet): Spreadsheet | null {
    const index = this.list.indexOf(sheet);
    if (this.readOnlyFlag || index < 0 || this.list.length >= MAX_SHEETS) return null;
    const copy = deserializeSheet(JSON.parse(JSON.stringify(serializeSheet(sheet))));
    let name = `${sheet.name} (copy)`;
    for (let n = 2; this.sheetByName(name) !== undefined; n++) name = `${sheet.name} (copy ${n})`;
    copy.name = name;
    this.attach(copy, index + 1);
    this.activeIndexValue = index + 1;
    copy.recalculateAll();
    this.sheetChanged(copy);
    this.changed();
    return copy;
  }

  setActive(target: Spreadsheet | number): void {
    const index = typeof target === 'number' ? target : this.list.indexOf(target);
    if (index < 0 || index >= this.list.length || index === this.activeIndexValue) return;
    this.activeIndexValue = index;
    this.changed();
  }

  /**
   * Rewrites every formula of every sheet with `rewrite`. `mentioned` is the sheet name being renamed or deleted: the
   * formulas of the sheets that read it are recomputed, and the undo history of those sheets is dropped (a restored
   * old formula would point at a name that no longer exists).
   */
  private rewriteReferences(rewrite: (expr: NonNullable<Cell['formula']>) => NonNullable<Cell['formula']>, mentioned: string): void {
    const lower = mentioned.toLowerCase();
    for (const sheet of this.list) {
      let touched = false;
      sheet.model.forEachCell((row, col, cell) => {
        if (cell.formula === undefined) return;
        const next = rewrite(cell.formula);
        if (next === cell.formula) return;
        sheet.model.setCell(row, col, { ...cell, formula: next });
        touched = true;
      });
      if (!touched && !sheet.engine.readsSheet(lower)) continue;
      sheet.history.clear();
      sheet.recalculateAll();
    }
    for (const sheet of this.list) sheet.externalRecalculated();
    this.recalculateAll();
  }

  /**
   * Called by a sheet whose cells changed: the sheets whose formulas read it recompute, and so on down the chain.
   * Not recursive and bounded, so a cycle through sheets settles on some values instead of looping.
   */
  sheetChanged(source: Spreadsheet): void {
    if (this.propagating || this.list.length < 2) return;
    this.propagating = true;
    try {
      const queue: Spreadsheet[] = [source];
      const limit = this.list.length * 4 + 4;
      for (let i = 0; i < queue.length && i < limit; i++) {
        const changed = queue[i] as Spreadsheet;
        for (const other of this.list) {
          if (other === changed) continue;
          if (other.engine.recalcReaders(changed.name)) {
            other.externalRecalculated();
            queue.push(other);
          }
        }
      }
    } finally {
      this.propagating = false;
    }
  }

  /** Recomputes everything, enough passes for formulas that chain through several sheets in any order. */
  recalculateAll(): void {
    for (const sheet of this.list) sheet.recalculateAll();
    for (let pass = 0; pass < this.list.length; pass++) {
      for (const sheet of this.list) sheet.engine.recalcAllReaders();
    }
    for (const sheet of this.list) sheet.externalRecalculated();
  }

  /** A row/column insert or delete in `target`: formulas elsewhere that point into it follow the cells. */
  structureChanged(target: Spreadsheet, rowMap: AxisMap, colMap: AxisMap): void {
    const lower = target.name.toLowerCase();
    for (const sheet of this.list) {
      if (sheet === target) continue;
      const keys = sheet.engine.keysReading(lower);
      if (keys.length === 0) continue;
      for (const key of keys) {
        const row = keyRow(key);
        const col = keyCol(key);
        const cell = sheet.model.getCell(row, col);
        if (cell.formula === undefined) continue;
        const formula = remapFormula(cell.formula, row, col, row, col, rowMap, colMap, (s) => s !== undefined && sameSheetName(s, target.name));
        sheet.model.setCell(row, col, { ...cell, formula });
      }
      sheet.recalculateAll();
    }
  }

  /** Remembers the formulas that read `target`, before a structure change rewrites them. */
  captureReaders(target: Spreadsheet): ReaderSnapshot {
    const lower = target.name.toLowerCase();
    const entries: Array<{ sheet: Spreadsheet; cells: Map<number, Cell> }> = [];
    for (const sheet of this.list) {
      if (sheet === target) continue;
      const keys = sheet.engine.keysReading(lower);
      if (keys.length === 0) continue;
      entries.push({ sheet, cells: new Map(keys.map((key): [number, Cell] => [key, sheet.model.getCell(keyRow(key), keyCol(key))])) });
    }
    return { entries };
  }

  restoreReaders(snapshot: ReaderSnapshot): void {
    for (const { sheet, cells } of snapshot.entries) {
      if (sheet.workbook !== this) continue;
      for (const [key, cell] of cells) sheet.model.setCell(keyRow(key), keyCol(key), cell);
      sheet.recalculateAll();
    }
  }
}
