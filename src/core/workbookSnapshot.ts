import { deserializeSheet, SnapshotError, serializeSheet, type SheetSnapshot, SNAPSHOT_VERSION } from './snapshot';
import { MAX_SHEETS, sheetNameProblem, Workbook } from './Workbook';

/** Every sheet of a workbook (each a `SheetSnapshot` carrying its `name`) and which one was active. */
export interface WorkbookSnapshot {
  version: typeof SNAPSHOT_VERSION;
  sheets: SheetSnapshot[];
  active: number;
}

export function serializeWorkbook(workbook: Workbook): WorkbookSnapshot {
  return { version: SNAPSHOT_VERSION, sheets: workbook.sheets.map((s) => serializeSheet(s)), active: workbook.activeIndex };
}

export function isWorkbookSnapshot(data: unknown): data is WorkbookSnapshot {
  return typeof data === 'object' && data !== null && Array.isArray((data as { sheets?: unknown }).sheets);
}

/**
 * Builds a workbook from a snapshot: a `WorkbookSnapshot`, or a plain `SheetSnapshot` (an older save, which becomes a
 * workbook of one sheet). Throws SnapshotError for anything else, including sheets with missing or clashing names.
 */
export function deserializeWorkbook(data: unknown): Workbook {
  if (!isWorkbookSnapshot(data)) {
    const sheet = deserializeSheet(data);
    const workbook = new Workbook(sheet);
    workbook.recalculateAll();
    return workbook;
  }
  if (data.version !== SNAPSHOT_VERSION) throw new SnapshotError(`unsupported version ${String(data.version)}`);
  if (data.sheets.length < 1 || data.sheets.length > MAX_SHEETS) throw new SnapshotError(`a workbook needs between 1 and ${MAX_SHEETS} sheets`);
  const sheets = data.sheets.map((s) => deserializeSheet(s));
  const used = new Set<string>();
  sheets.forEach((sheet, i) => {
    const given = typeof (data.sheets[i] as { name?: unknown }).name === 'string';
    const name = given ? sheet.name.trim() : `Sheet${i + 1}`;
    if (sheetNameProblem(name) !== null || used.has(name.toLowerCase())) throw new SnapshotError(`sheet ${i + 1} has no usable, unique name`);
    used.add(name.toLowerCase());
    sheet.name = name;
  });
  const workbook = new Workbook(sheets[0]);
  for (const sheet of sheets.slice(1)) workbook.addSheet({ sheet, name: sheet.name });
  const active = typeof data.active === 'number' && Number.isInteger(data.active) && data.active >= 0 && data.active < sheets.length ? data.active : 0;
  workbook.setActive(active);
  workbook.recalculateAll();
  return workbook;
}
