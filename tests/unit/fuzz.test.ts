import { describe, expect, it } from 'vitest';
import { ResizeCommand } from '../../src/core/commands/ResizeCommand';
import type { Cell } from '../../src/core/model/Cell';
import { cellAddress } from '../../src/core/model/address';
import { Spreadsheet } from '../../src/core/Spreadsheet';

class Rng {
  constructor(private s: number) {}
  next(): number {
    this.s = (Math.imul(this.s, 1664525) + 1013904223) >>> 0;
    return this.s / 4294967296;
  }
  int(n: number): number {
    return Math.floor(this.next() * n);
  }
  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)] as T;
  }
}

const ROWS = 40;
const COLS = 8;

function newSheet(): Spreadsheet {
  const s = new Spreadsheet({ rowCount: ROWS, colCount: COLS });
  s.headerRows = 1;
  return s;
}

// Everything that undo must restore, serialized deterministically.
function snapshot(s: Spreadsheet): string {
  const cells: string[] = [];
  s.model.forEachCell((r, c, cell) => cells.push(`${r},${c}:${JSON.stringify(cell)}`));
  const order = s.mapping.getOrder();
  return JSON.stringify({
    cells: cells.sort(),
    rows: s.rows.snapshot(),
    cols: s.cols.snapshot(),
    rowCount: s.rowCount,
    colCount: s.colCount,
    order: order === null ? null : [...order],
    sort: s.viewState.sort,
    filters: [...s.viewState.filters].map(([c, set]) => [c, [...set].sort()]),
  });
}

// Formula results kept up to date incrementally must equal a from-scratch recalculation.
function assertConsistent(s: Spreadsheet, label: string): void {
  expect(s.rows.count, label).toBe(s.rowCount);
  expect(s.cols.count, label).toBe(s.colCount);
  expect(s.selection.activeRow, label).toBeLessThan(s.rowCount);
  expect(s.selection.activeCol, label).toBeLessThan(s.colCount);
  const used = s.model.getUsedRange();
  if (used !== null) {
    expect(used.endRow, label).toBeLessThan(s.mapping.dataRowCount);
    expect(used.endCol, label).toBeLessThan(s.colCount);
  }
  const order = s.mapping.getOrder();
  if (order !== null) {
    expect(new Set(order).size, `${label}: order has duplicates`).toBe(order.length);
    for (const r of order) expect(r).toBeLessThan(s.mapping.dataRowCount);
  }
  const fresh = new Spreadsheet({ rowCount: s.mapping.dataRowCount, colCount: s.colCount });
  s.model.forEachCell((r, c, cell: Cell) => {
    fresh.model.setCell(r, c, cell.formula === undefined ? cell : { ...cell, value: null });
  });
  fresh.recalculateAll();
  s.model.forEachCell((r, c, cell) => {
    if (cell.formula !== undefined) {
      expect(cell.value, `${label}: stale value at ${cellAddress(r, c)}`).toEqual(fresh.model.getCell(r, c).value);
    }
  });
}

function randomRef(rng: Rng, s: Spreadsheet): string {
  return cellAddress(rng.int(Math.min(s.mapping.dataRowCount, ROWS)), rng.int(Math.min(s.colCount, COLS)));
}

function randomRange(rng: Rng, s: Spreadsheet): string {
  const r1 = rng.int(Math.min(s.mapping.dataRowCount, ROWS));
  const c1 = rng.int(Math.min(s.colCount, COLS));
  const r2 = Math.min(s.mapping.dataRowCount - 1, r1 + rng.int(6));
  const c2 = Math.min(s.colCount - 1, c1 + rng.int(3));
  return `${cellAddress(r1, c1)}:${cellAddress(r2, c2)}`;
}

function randomInput(rng: Rng, s: Spreadsheet): string {
  switch (rng.int(12)) {
    case 0:
      return '';
    case 1:
      return rng.pick(['apple', 'Banana', 'cherry', 'Item 1', 'x']);
    case 2:
      return `=SUM(${randomRange(rng, s)})`;
    case 3:
      return `=${randomRef(rng, s)}+${randomRef(rng, s)}`;
    case 4:
      return `=COUNTIF(${randomRange(rng, s)},">2")`;
    case 5:
      return `=IF(${randomRef(rng, s)}>3,${randomRef(rng, s)},"n")`;
    case 6:
      return `=$A$2*${randomRef(rng, s)}`;
    case 7:
      return `=VLOOKUP(${randomRef(rng, s)},${randomRange(rng, s)},2,FALSE)`;
    case 8:
      return `=${randomRef(rng, s)}`; // chains and cycles happen naturally
    default:
      return String(rng.int(10));
  }
}

function randomRange2(rng: Rng, s: Spreadsheet) {
  const r1 = rng.int(s.rowCount);
  const c1 = rng.int(s.colCount);
  return {
    startRow: r1,
    startCol: c1,
    endRow: Math.min(s.rowCount - 1, r1 + rng.int(4)),
    endCol: Math.min(s.colCount - 1, c1 + rng.int(3)),
  };
}

function step(rng: Rng, s: Spreadsheet): void {
  const op = rng.int(22);
  if (op < 6) {
    s.setCellInput(rng.int(s.rowCount), rng.int(s.colCount), randomInput(rng, s));
  } else if (op === 6) {
    s.insertRows(rng.int(s.rowCount + 1), 1 + rng.int(3));
  } else if (op === 7) {
    s.deleteRows(rng.int(s.rowCount), 1 + rng.int(3));
  } else if (op === 8) {
    s.insertCols(rng.int(s.colCount + 1), 1 + rng.int(2));
  } else if (op === 9) {
    s.deleteCols(rng.int(s.colCount), 1 + rng.int(2));
  } else if (op === 10) {
    s.sortByColumn(rng.int(s.colCount), rng.next() < 0.5);
  } else if (op === 11) {
    const col = rng.int(s.colCount);
    const { values } = s.getDistinctValues(col);
    if (values.length > 0) s.setColumnFilter(col, new Set(values.filter(() => rng.next() < 0.6).map((v) => v.text)));
  } else if (op === 12) {
    if (rng.next() < 0.5) s.clearSort();
    else s.clearFilters();
  } else if (op === 13) {
    s.selection.selectCell(rng.int(s.rowCount), rng.int(s.colCount));
    s.pasteText([[randomInput(rng, s), randomInput(rng, s)], [randomInput(rng, s), '']]);
  } else if (op === 14) {
    const src = randomRange2(rng, s);
    const { rows, cols, cells } = s.readCells(src);
    s.selection.selectCell(rng.int(s.rowCount), rng.int(s.colCount));
    s.pasteMatrix(rows, cols, (i, j) => cells[i]?.[j] as Cell);
  } else if (op === 15) {
    s.fillRange(randomRange2(rng, s), rng.pick(['down', 'up', 'left', 'right'] as const), 1 + rng.int(4));
  } else if (op === 16) {
    const axis = rng.pick(['row', 'col'] as const);
    const n = axis === 'row' ? s.rowCount : s.colCount;
    s.execute(new ResizeCommand(axis, [rng.int(n)], 10 + rng.int(100)));
  } else if (op === 17) {
    const r = randomRange2(rng, s);
    s.selection.selectCell(r.startRow, r.startCol);
    s.selection.extendTo(r.endRow, r.endCol);
    if (rng.next() < 0.5) s.toggleStyle(rng.pick(['bold', 'italic'] as const));
    else s.formatSelection({ align: rng.pick(['left', 'center', 'right'] as const) });
  } else if (op === 18) {
    const r = randomRange2(rng, s);
    s.selection.selectCell(r.startRow, r.startCol);
    s.selection.extendTo(r.endRow, r.endCol);
    s.clearSelection();
  } else if (op <= 20) {
    s.undo();
  } else {
    s.redo();
  }
}

describe('fuzz: random operation sequences', () => {
  const SEEDS = 80;
  const STEPS = 120;

  it.each(Array.from({ length: SEEDS }, (_, i) => i + 1))('seed %i keeps the model valid and undo/redo exact', (seed) => {
    const rng = new Rng(seed * 7919);
    const s = newSheet();
    // Seed through the model, then forget the history: this is the state undo must return to.
    for (let i = 0; i < 40; i++) {
      s.model.setCell(rng.int(ROWS), rng.int(COLS), { value: rng.int(10), styleId: 0 });
    }
    s.recalculateAll();
    s.history.clear();
    const initial = snapshot(s);

    for (let i = 0; i < STEPS; i++) {
      step(rng, s);
      assertConsistent(s, `seed ${seed} step ${i}`);
    }

    // Commands undone during the walk are still pending in the redo stack; replay them so
    // "final" is the state with every recorded command applied, which is what redo-all must reach.
    let guard = 0;
    while (s.redo() && guard++ < 1000);
    const final = snapshot(s);
    guard = 0;
    while (s.undo() && guard++ < 1000);
    assertConsistent(s, `seed ${seed} after undo-all`);
    expect(snapshot(s), `seed ${seed}: undo-all must restore the initial state`).toBe(initial);

    guard = 0;
    while (s.redo() && guard++ < 1000);
    assertConsistent(s, `seed ${seed} after redo-all`);
    expect(snapshot(s), `seed ${seed}: redo-all must restore the final state`).toBe(final);
  });
});

// Independent oracle: where a tracked cell ends up after row/column inserts and deletes,
// computed with plain arithmetic rather than the code under test.
describe('fuzz: formulas keep pointing at the same cells through insert/delete', () => {
  interface Tracked {
    id: number;
    marker: { row: number; col: number } | null;
    pointer: { row: number; col: number } | null;
  }

  function move(pos: { row: number; col: number } | null, axis: 'row' | 'col', kind: 'insert' | 'delete', at: number, n: number) {
    if (pos === null) return null;
    const v = pos[axis];
    let nv = v;
    if (kind === 'insert') nv = v >= at ? v + n : v;
    else if (v >= at && v < at + n) return null;
    else if (v >= at + n) nv = v - n;
    return { ...pos, [axis]: nv };
  }

  it.each(Array.from({ length: 60 }, (_, i) => i + 1))('seed %i', (seed) => {
    const rng = new Rng(seed * 104729);
    const s = new Spreadsheet({ rowCount: 60, colCount: 12 });
    const tracked: Tracked[] = [];
    const used = new Set<string>();
    const free = (): { row: number; col: number } => {
      for (;;) {
        const p = { row: 1 + rng.int(40), col: 1 + rng.int(8) };
        if (!used.has(`${p.row},${p.col}`)) {
          used.add(`${p.row},${p.col}`);
          return p;
        }
      }
    };
    for (let id = 0; id < 8; id++) {
      const marker = free();
      const pointer = free();
      s.setCellInput(marker.row, marker.col, `M${id}`);
      // Mix single refs, absolute refs and one-cell ranges so every reference kind is exercised.
      const target = cellAddress(marker.row, marker.col);
      const abs = `$${target.replace(/\d+/, '')}$${marker.row + 1}`;
      const text = rng.pick([`=${target}`, `=${abs}`, `=IF(TRUE,${target},0)`, `=CONCAT(${target},"")`]);
      s.setCellInput(pointer.row, pointer.col, text);
      tracked.push({ id, marker, pointer });
    }
    const ops: string[] = [];

    for (let i = 0; i < 25; i++) {
      const axis = rng.pick(['row', 'col'] as const);
      const kind = rng.pick(['insert', 'delete'] as const);
      const size = axis === 'row' ? s.rowCount : s.colCount;
      const at = rng.int(Math.max(1, size - 2));
      const n = 1 + rng.int(2);
      let ok: boolean;
      if (axis === 'row') ok = kind === 'insert' ? s.insertRows(at, n) : s.deleteRows(at, n);
      else ok = kind === 'insert' ? s.insertCols(at, n) : s.deleteCols(at, n);
      if (!ok) continue;
      ops.push(`${kind} ${axis} ${at} x${n}`);
      for (const t of tracked) {
        t.marker = move(t.marker, axis, kind, at, n);
        t.pointer = move(t.pointer, axis, kind, at, n);
      }
      for (const t of tracked) {
        if (t.pointer === null) continue; // the formula itself was deleted
        const cell = s.model.getCell(t.pointer.row, t.pointer.col);
        const history = ops.join('; ');
        expect(cell.formula, `pointer ${t.id} lost its formula after: ${history}`).toBeDefined();
        if (t.marker === null) {
          expect(cell.value, `pointer ${t.id} should be #REF! after: ${history}`).toEqual({ error: '#REF!' });
        } else {
          expect(cell.value, `pointer ${t.id} follows its marker after: ${history}`).toBe(`M${t.id}`);
          expect(s.model.getCell(t.marker.row, t.marker.col).value).toBe(`M${t.id}`);
        }
      }
      assertConsistent(s, `after ${ops.join('; ')}`);
    }
    // Seeding went through commands, so undoing everything must leave an empty sheet of the original size.
    while (s.undo());
    expect(s.model.cellCount).toBe(0);
    expect([s.rowCount, s.colCount]).toEqual([60, 12]);
    expect(s.rows.snapshot().index).toEqual([]);
  });
});
