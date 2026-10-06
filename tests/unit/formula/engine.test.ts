import { describe, expect, it } from 'vitest';
import type { Cell } from '../../../src/core/model/Cell';
import { DependencyGraph } from '../../../src/formula/dependency';
import { rebaseFormula } from '../../../src/formula/transform';
import { addr, e, makeSheet, set, value } from './helpers';

describe('recalculation', () => {
  it('updates a chain when the source changes', () => {
    const s = makeSheet({ A1: 1, B1: '=A1+1', C1: '=B1*10' });
    expect(value(s, 'C1')).toBe(20);
    set(s, 'A1', 5);
    expect(value(s, 'B1')).toBe(6);
    expect(value(s, 'C1')).toBe(60);
  });

  it('evaluates in dependency order even if the formulas were entered out of order', () => {
    const s = makeSheet({ C1: '=B1*10', B1: '=A1+1' }); // C1 entered before its precedent exists
    set(s, 'A1', 2);
    expect(value(s, 'C1')).toBe(30);
  });

  it('handles a diamond: each cell is computed after both of its inputs', () => {
    const s = makeSheet({ A1: 1, B1: '=A1+1', C1: '=A1+2', D1: '=B1+C1' });
    expect(value(s, 'D1')).toBe(5);
    set(s, 'A1', 2);
    expect(value(s, 'D1')).toBe(7);
  });

  it('range formulas react to changes inside the range and to newly filled cells', () => {
    const s = makeSheet({ A1: 1, A2: 2, B1: '=SUM(A1:A5)' });
    expect(value(s, 'B1')).toBe(3);
    set(s, 'A2', 10);
    expect(value(s, 'B1')).toBe(11);
    set(s, 'A5', 100); // was empty
    expect(value(s, 'B1')).toBe(111);
    set(s, 'A6', 1000); // outside the range
    expect(value(s, 'B1')).toBe(111);
  });

  it('whole-column ranges update too', () => {
    const s = makeSheet({ B1: '=SUM(A:A)' });
    set(s, 'A900', 7);
    expect(value(s, 'B1')).toBe(7);
  });

  it('a formula becomes a plain value and stops depending on its inputs', () => {
    const s = makeSheet({ A1: 1, B1: '=A1+1' });
    set(s, 'B1', 99);
    set(s, 'A1', 50);
    expect(value(s, 'B1')).toBe(99);
    expect(s.engine.formulaCount).toBe(0);
  });

  it('errors flow downstream and clear when fixed', () => {
    const s = makeSheet({ A1: 0, B1: '=1/A1', C1: '=B1+1' });
    expect(value(s, 'C1')).toEqual(e('#DIV/0!'));
    set(s, 'A1', 2);
    expect(value(s, 'C1')).toBe(1.5);
  });

  it('clearing a precedent makes dependents see an empty cell', () => {
    const s = makeSheet({ A1: 5, B1: '=A1+1' });
    s.selection.selectCell(0, 0);
    s.clearSelection();
    expect(value(s, 'B1')).toBe(1);
  });

  it('is not tracking anything when there are no formulas', () => {
    const s = makeSheet({ A1: 1 });
    expect(s.engine.hasFormulas).toBe(false);
  });
});

describe('circular references', () => {
  it('marks a two-cell cycle and a self reference as #REF!', () => {
    const s = makeSheet({ A1: '=B1', B1: '=A1', C1: '=C1' });
    expect(value(s, 'A1')).toEqual(e('#REF!'));
    expect(value(s, 'B1')).toEqual(e('#REF!'));
    expect(value(s, 'C1')).toEqual(e('#REF!'));
  });

  it('cells downstream of a cycle also error, and recover when the cycle is broken', () => {
    const s = makeSheet({ A1: '=B1', B1: '=A1', D1: '=A1+1', E1: 7 });
    expect(value(s, 'D1')).toEqual(e('#REF!'));
    expect(value(s, 'E1')).toBe(7);
    set(s, 'B1', 3);
    expect(value(s, 'A1')).toBe(3);
    expect(value(s, 'D1')).toBe(4);
  });

  it('only cells ON a cycle are circular; cells that merely read them evaluate normally', () => {
    const s = makeSheet({ A1: '=B1', B1: '=A1', C1: '=COUNTIF(A1:B1,">0")', D1: '=SUM(A1:B1)', E1: '=D1+1' });
    expect(value(s, 'A1')).toEqual(e('#REF!'));
    expect(value(s, 'C1')).toBe(0); // COUNTIF ignores error cells
    expect(value(s, 'D1')).toEqual(e('#REF!')); // SUM propagates them
    expect(value(s, 'E1')).toEqual(e('#REF!'));
  });

  it('gives the same result whether the dependent was entered before or after the cycle', () => {
    const before = makeSheet({ C1: '=COUNTIF(A1:B1,">0")', A1: '=B1', B1: '=A1' });
    const after = makeSheet({ A1: '=B1', B1: '=A1', C1: '=COUNTIF(A1:B1,">0")' });
    expect(value(before, 'C1')).toBe(value(after, 'C1'));
  });

  it('a long chain behind a cycle does not overflow the stack', () => {
    const s = new (makeSheet().constructor as new (o: { rowCount: number; colCount: number }) => ReturnType<typeof makeSheet>)({
      rowCount: 10_000,
      colCount: 3,
    });
    s.model.setCell(0, 0, { value: null, styleId: 0, formula: s.cellFromInput('=A2', 0, 0, 0).formula! });
    s.model.setCell(1, 0, { value: null, styleId: 0, formula: s.cellFromInput('=A1', 1, 0, 0).formula! });
    for (let r = 2; r < 8000; r++) {
      s.model.setCell(r, 0, { value: null, styleId: 0, formula: s.cellFromInput(`=A${r}+1`, r, 0, 0).formula! });
    }
    s.recalculateAll();
    expect(s.getCellByView(1, 0).value).toEqual(e('#REF!'));
    expect(s.getCellByView(7999, 0).value).toEqual(e('#REF!')); // error flows down the chain
  });

  it('a range that includes its own cell is circular', () => {
    const s = makeSheet({ A1: 1, A2: '=SUM(A1:A3)' });
    expect(value(s, 'A2')).toEqual(e('#REF!'));
  });
});

describe('undo and redo', () => {
  it('undo restores both the formula and what depends on it', () => {
    const s = makeSheet({ A1: 1, B1: '=A1+1' });
    set(s, 'A1', 10);
    expect(value(s, 'B1')).toBe(11);
    s.undo();
    expect(value(s, 'A1')).toBe(1);
    expect(value(s, 'B1')).toBe(2);
    s.redo();
    expect(value(s, 'B1')).toBe(11);
  });

  it('undoing the entry of a formula removes it cleanly', () => {
    const s = makeSheet({ A1: 1 });
    set(s, 'B1', '=A1+1');
    expect(value(s, 'B1')).toBe(2);
    s.undo();
    expect(s.model.hasCell(0, 1)).toBe(false);
    expect(s.engine.formulaCount).toBe(0);
    set(s, 'A1', 5); // must not resurrect B1
    expect(s.model.hasCell(0, 1)).toBe(false);
  });
});

describe('editing and copying formulas', () => {
  it('shows the formula in A1 notation when editing', () => {
    const s = makeSheet({ A1: 1, C3: '=SUM(A1:B2)+$A$1' });
    const [r, c] = addr('C3');
    expect(s.getEditText(r, c)).toBe('=SUM(A1:B2)+$A$1');
  });

  it('keeps the source of a broken formula', () => {
    const s = makeSheet({ A1: '=1+' });
    expect(value(s, 'A1')).toEqual(e('#ERROR!'));
    expect(s.getEditText(0, 0)).toBe('=1+');
  });

  it('a lone "=" or a quoted formula stays text', () => {
    const s = makeSheet({ A1: '=', A2: "'=1+1" });
    expect(value(s, 'A1')).toBe('=');
    expect(value(s, 'A2')).toBe('=1+1');
  });

  function copyPaste(s: ReturnType<typeof makeSheet>, from: string, to: string): void {
    const [fr, fc] = addr(from);
    const [tr, tc] = addr(to);
    const { rows, cols, cells } = s.readCells({ startRow: fr, startCol: fc, endRow: fr, endCol: fc });
    s.selection.selectCell(tr, tc);
    s.pasteMatrix(rows, cols, (i, j) => cells[i]?.[j] as Cell);
  }

  it('relative references shift when a formula is copied', () => {
    const s = makeSheet({ A1: 1, A2: 2, A3: 3, B1: 10, B2: 20, B3: 30, C1: '=A1+B1' });
    copyPaste(s, 'C1', 'C3');
    expect(s.getEditText(...addr('C3'))).toBe('=A3+B3');
    expect(value(s, 'C3')).toBe(33);
  });

  it('absolute references do not shift', () => {
    const s = makeSheet({ A1: 5, B1: '=$A$1*2' });
    copyPaste(s, 'B1', 'D4');
    expect(s.getEditText(...addr('D4'))).toBe('=$A$1*2');
    expect(value(s, 'D4')).toBe(10);
  });

  it('mixed references shift only their relative axis', () => {
    const s = makeSheet({ B1: '=A$1+$A1' });
    copyPaste(s, 'B1', 'D3');
    expect(s.getEditText(...addr('D3'))).toBe('=C$1+$A3');
  });

  it('a copy pushed past the top edge becomes #REF!', () => {
    const s = makeSheet({ B3: '=A1' });
    copyPaste(s, 'B3', 'B1');
    expect(value(s, 'B1')).toEqual(e('#REF!'));
  });

  it('pasting formula text from outside is parsed at the target position', () => {
    const s = makeSheet({ A1: 1, A2: 2 });
    s.selection.selectCell(...addr('B2'));
    s.pasteText([['=A2*2']]);
    expect(value(s, 'B2')).toBe(4);
    expect(s.getEditText(...addr('B2'))).toBe('=A2*2');
  });

  it('cut-paste moves a formula without changing what it points at', () => {
    const s = makeSheet({ A1: 1, B1: '=A1+1' });
    const [r, c] = addr('B1');
    const { rows, cols, cells } = s.readCells({ startRow: r, startCol: c, endRow: r, endCol: c });
    s.selection.selectCell(...addr('D5'));
    // Same logic as ClipboardController uses for a cut.
    s.pasteMatrix(
      rows,
      cols,
      (i, j, _existing, dataRow, dataCol) => {
        const cell = cells[i]?.[j] as Cell;
        return { ...cell, formula: rebaseFormula(cell.formula!, r, c, dataRow, dataCol) };
      },
      { startRow: r, startCol: c, endRow: r, endCol: c },
    );
    expect(s.getEditText(...addr('D5'))).toBe('=A1+1');
    expect(value(s, 'D5')).toBe(2);
    expect(s.model.hasCell(r, c)).toBe(false);
    s.undo();
    expect(s.getEditText(r, c)).toBe('=A1+1');
    expect(s.model.hasCell(...addr('D5'))).toBe(false);
  });
});

describe('DependencyGraph', () => {
  it('finds dependents through cells and ranges, and forgets removed formulas', () => {
    const g = new DependencyGraph();
    g.set(100, { cells: [1, 2], ranges: [] });
    g.set(200, { cells: [], ranges: [{ r1: 0, c1: 0, r2: 0, c2: 0 }] });
    expect([...g.dependentsOf(1)]).toEqual([100]);
    expect([...g.dependentsOf(0)]).toEqual([200]); // key 0 = (row 0, col 0)
    g.remove(100);
    expect([...g.dependentsOf(1)]).toEqual([]);
    g.set(200, { cells: [], ranges: [] });
    expect([...g.dependentsOf(0)]).toEqual([]);
    expect(g.size).toBe(1);
  });

  it('indexes narrow and wide ranges', () => {
    const g = new DependencyGraph();
    g.set(1, { cells: [], ranges: [{ r1: 0, c1: 0, r2: 10, c2: 100 }] }); // wide
    g.set(2, { cells: [], ranges: [{ r1: 5, c1: 2, r2: 6, c2: 3 }] });
    const key = (r: number, c: number): number => r * 16384 + c;
    expect([...g.dependentsOf(key(5, 2))].sort()).toEqual([1, 2]);
    expect([...g.dependentsOf(key(7, 2))]).toEqual([1]);
    expect([...g.dependentsOf(key(5, 50))]).toEqual([1]);
    expect([...g.dependentsOf(key(11, 2))]).toEqual([]);
  });
});

describe('rebuildAll', () => {
  it('computes formulas written straight into the model', () => {
    const s = makeSheet();
    const sheetFormula = makeSheet({ A1: 1, B1: '=A1+1' }).getCellByView(0, 1);
    s.model.setCell(0, 0, { value: 4, styleId: 0 });
    s.model.setCell(0, 1, { value: null, styleId: 0, formula: sheetFormula.formula! });
    s.recalculateAll();
    expect(value(s, 'B1')).toBe(5);
  });
});

describe('scale', () => {
  it('recalculates a 20,000 formula chain without recursion limits or quadratic cost', () => {
    const s = new (makeSheet().constructor as new (o: { rowCount: number; colCount: number }) => ReturnType<typeof makeSheet>)({
      rowCount: 50_000,
      colCount: 4,
    });
    s.setCellInput(0, 0, '1');
    const n = 20_000;
    for (let r = 1; r < n; r++) {
      s.model.setCell(r, 0, { value: null, styleId: 0, formula: s.cellFromInput(`=A${r}+1`, r, 0, 0).formula! });
    }
    s.recalculateAll();
    expect(s.getCellByView(n - 1, 0).value).toBe(n);
    const t0 = performance.now();
    s.setCellInput(0, 0, '101');
    expect(s.getCellByView(n - 1, 0).value).toBe(n + 100);
    expect(performance.now() - t0).toBeLessThan(1500);
  });

  it('thousands of SUMs over one column stay responsive when the column changes', () => {
    const s = makeSheet();
    for (let r = 0; r < 2000; r++) s.model.setCell(r, 0, { value: 1, styleId: 0 });
    for (let r = 0; r < 2000; r++) {
      s.model.setCell(r, 1, { value: null, styleId: 0, formula: s.cellFromInput('=SUM(A:A)', r, 1, 0).formula! });
    }
    s.recalculateAll();
    expect(s.getCellByView(1999, 1).value).toBe(2000);
    const t0 = performance.now();
    s.setCellInput(0, 0, '5');
    expect(s.getCellByView(0, 1).value).toBe(2004);
    expect(performance.now() - t0).toBeLessThan(1500);
  });
});

describe('cut-paste moves references with the cells', () => {
  function cutPaste(s: ReturnType<typeof makeSheet>, from: string, to: string): void {
    const [fr, fc] = from.split(':').map((a) => addr(a)) as [[number, number], [number, number]];
    const source = { startRow: fr[0], startCol: fr[1], endRow: (fc ?? fr)[0], endCol: (fc ?? fr)[1] };
    const { rows, cols, cells } = s.readCells(source);
    s.selection.selectCell(...addr(to));
    s.pasteMatrix(
      rows,
      cols,
      (i, j, _existing, dataRow, dataCol) => {
        const cell = cells[i]?.[j] as Cell;
        if (cell.formula === undefined) return cell;
        return { ...cell, formula: rebaseFormula(cell.formula, source.startRow + i, source.startCol + j, dataRow, dataCol) };
      },
      source,
    );
  }

  it('formulas elsewhere that pointed at the moved cells follow them', () => {
    const s = makeSheet({ A1: 1, A2: 2, B1: '=A1+A2', C1: '=SUM(A1:A2)' });
    cutPaste(s, 'A1:A2', 'D1');
    expect(s.getEditText(...addr('B1'))).toBe('=D1+D2');
    expect(s.getEditText(...addr('C1'))).toBe('=SUM(D1:D2)');
    expect(value(s, 'B1')).toBe(3);
    expect(value(s, 'C1')).toBe(3);
    expect(s.model.hasCell(...addr('A1'))).toBe(false);
  });

  it('a range only partly inside the block does not move', () => {
    const s = makeSheet({ A1: 1, A2: 2, A3: 3, B1: '=SUM(A1:A3)' });
    cutPaste(s, 'A1:A2', 'D1');
    expect(s.getEditText(...addr('B1'))).toBe('=SUM(A1:A3)');
  });

  it('absolute references follow too', () => {
    const s = makeSheet({ A1: 5, B1: '=$A$1*2' });
    cutPaste(s, 'A1', 'C3');
    expect(s.getEditText(...addr('B1'))).toBe('=$C$3*2');
    expect(value(s, 'B1')).toBe(10);
  });

  it('formulas inside the block keep pointing at what they pointed at, or at moved cells', () => {
    const s = makeSheet({ A1: 4, A2: '=A1*2', A3: '=Z1+1', Z1: 100 });
    cutPaste(s, 'A1:A3', 'D1');
    expect(s.getEditText(...addr('D2'))).toBe('=D1*2'); // pointed at a cell that moved along
    expect(s.getEditText(...addr('D3'))).toBe('=Z1+1'); // pointed outside the block: unchanged target
    expect(value(s, 'D2')).toBe(8);
    expect(value(s, 'D3')).toBe(101);
  });

  it('is one undo step that restores every formula', () => {
    const s = makeSheet({ A1: 1, B1: '=A1+1' });
    cutPaste(s, 'A1', 'D4');
    s.undo();
    expect(s.getEditText(...addr('B1'))).toBe('=A1+1');
    expect(value(s, 'B1')).toBe(2);
    expect(value(s, 'A1')).toBe(1);
    expect(s.model.hasCell(...addr('D4'))).toBe(false);
  });

  it('a plain copy-paste leaves other formulas alone', () => {
    const s = makeSheet({ A1: 1, B1: '=A1+1' });
    const { rows, cols, cells } = s.readCells({ startRow: 0, startCol: 0, endRow: 0, endCol: 0 });
    s.selection.selectCell(...addr('D1'));
    s.pasteMatrix(rows, cols, (i, j) => cells[i]?.[j] as Cell);
    expect(s.getEditText(...addr('B1'))).toBe('=A1+1');
  });
});
