import { describe, expect, it } from 'vitest';
import { parseFormula } from '../../../src/formula/parser';
import { printFormula } from '../../../src/formula/print';
import { deleteMap, IDENTITY_MAP, insertMap, rebaseFormula, remapFormula } from '../../../src/formula/transform';

// Formula at C5 (row 4, col 2). After the structural change it lives at (newRow, newCol).
function remap(text: string, rowMap = IDENTITY_MAP, colMap = IDENTITY_MAP, newPos: [number, number] = [4, 2]): string {
  const expr = parseFormula(text, 4, 2);
  return printFormula(remapFormula(expr, 4, 2, newPos[0], newPos[1], rowMap, colMap), newPos[0], newPos[1]);
}

describe('insert rows', () => {
  it('shifts references at or below the insertion point', () => {
    // insert 2 rows above row 3 (index 2): A1 stays, A3 -> A5, A10 -> A12
    expect(remap('=A1+A3+A10', insertMap(2, 2))).toBe('=A1+A5+A12');
  });

  it('expands a range that spans the insertion point, but not one just above it', () => {
    expect(remap('=SUM(A1:A5)', insertMap(2, 1))).toBe('=SUM(A1:A6)');
    expect(remap('=SUM(A1:A2)', insertMap(2, 1))).toBe('=SUM(A1:A2)');
    expect(remap('=SUM(A3:A5)', insertMap(2, 1))).toBe('=SUM(A4:A6)');
  });

  it('keeps absolute refs absolute but still moves them', () => {
    expect(remap('=$A$3', insertMap(0, 1))).toBe('=$A$4');
  });

  it('keeps the formula pointing at the same cell when the formula itself moves', () => {
    // formula moves from row 5 to row 6 because a row was inserted above it
    expect(remap('=A1', insertMap(0, 1), IDENTITY_MAP, [5, 2])).toBe('=A2');
  });

  it('leaves whole-column references whole', () => {
    expect(remap('=SUM(A:A)', insertMap(2, 3))).toBe('=SUM(A:A)');
  });
});

describe('delete rows', () => {
  it('shifts references below the deleted block up', () => {
    expect(remap('=A1+A10', deleteMap(2, 3))).toBe('=A1+A7');
  });

  it('turns a reference into a deleted cell into #REF!', () => {
    expect(remap('=A3+1', deleteMap(2, 1))).toBe('=#REF!+1');
    expect(remap('=A3', deleteMap(1, 3))).toBe('=#REF!');
  });

  it('shrinks ranges and errors when the whole range is gone', () => {
    expect(remap('=SUM(A1:A5)', deleteMap(1, 2))).toBe('=SUM(A1:A3)'); // rows 2-3 removed
    expect(remap('=SUM(A1:A5)', deleteMap(0, 2))).toBe('=SUM(A1:A3)'); // top removed
    expect(remap('=SUM(A1:A5)', deleteMap(3, 5))).toBe('=SUM(A1:A3)'); // bottom removed
    expect(remap('=SUM(A2:A3)', deleteMap(1, 2))).toBe('=SUM(#REF!)');
  });
});

describe('columns', () => {
  it('uses the column map independently of rows', () => {
    expect(remap('=A1+C1', IDENTITY_MAP, insertMap(1, 2))).toBe('=A1+E1');
    expect(remap('=A1+C1', IDENTITY_MAP, deleteMap(0, 1))).toBe('=#REF!+B1');
  });
});

describe('rebaseFormula (cut-paste)', () => {
  it('keeps pointing at the same cells from the new position', () => {
    const expr = parseFormula('=A1+$B$2', 4, 2);
    const moved = rebaseFormula(expr, 4, 2, 10, 5);
    expect(printFormula(moved, 10, 5)).toBe('=A1+$B$2');
  });

  it('differs from a plain copy, which shifts relative references', () => {
    const expr = parseFormula('=A1', 4, 2);
    expect(printFormula(expr, 10, 5)).toBe('=D7');
    expect(printFormula(rebaseFormula(expr, 4, 2, 10, 5), 10, 5)).toBe('=A1');
  });
});
