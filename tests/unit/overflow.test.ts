import { describe, expect, it } from 'vitest';
import { computeOverflow, type Overflow } from '../../src/render/overflow';
import { Spreadsheet } from '../../src/core/Spreadsheet';

function sheet(): Spreadsheet {
  return new Spreadsheet({ rowCount: 10, colCount: 6, defaultColWidth: 100 });
}
const out = (): Overflow => ({ left: 9, right: 9 });

describe('computeOverflow', () => {
  it('needs nothing when the text fits', () => {
    expect(computeOverflow(sheet(), 0, 1, 'left', 80, 92, out())).toEqual({ left: 0, right: 0 });
  });

  it('left-aligned text spills right over empty cells, only as far as needed', () => {
    const s = sheet();
    // 250px of text in a 92px-wide area: needs 158px more, so two empty cells (200px) are enough.
    expect(computeOverflow(s, 0, 1, 'left', 250, 92, out())).toEqual({ left: 0, right: 200 });
  });

  it('stops at the first non-empty neighbour', () => {
    const s = sheet();
    s.model.setCell(0, 3, { value: 'x', styleId: 0 });
    expect(computeOverflow(s, 0, 1, 'left', 500, 92, out())).toEqual({ left: 0, right: 100 }); // only column C is free
    s.model.setCell(0, 2, { value: 1, styleId: 0 });
    expect(computeOverflow(s, 0, 1, 'left', 500, 92, out()).right).toBe(0);
  });

  it('right-aligned text spills left, centered text both ways', () => {
    const s = sheet();
    expect(computeOverflow(s, 0, 2, 'right', 250, 92, out())).toEqual({ left: 200, right: 0 });
    // centered: 158 extra, 79 each side, one empty neighbour each side covers it
    expect(computeOverflow(s, 0, 2, 'center', 250, 92, out())).toEqual({ left: 100, right: 100 });
  });

  it('stops at the edges of the sheet', () => {
    const s = sheet();
    expect(computeOverflow(s, 0, 5, 'left', 500, 92, out()).right).toBe(0);
    expect(computeOverflow(s, 0, 0, 'right', 500, 92, out()).left).toBe(0);
    expect(computeOverflow(s, 0, 4, 'left', 500, 92, out()).right).toBe(100);
  });

  it('treats empty-string results as empty and uses the real width of each neighbour', () => {
    const s = sheet();
    s.model.setCell(0, 2, { value: '', styleId: 0, formula: undefined });
    s.cols.setSize(2, 40);
    s.cols.setSize(3, 60);
    expect(computeOverflow(s, 0, 1, 'left', 300, 92, out()).right).toBe(40 + 60 + 100 + 100); // 208px needed: three cells give 200, so a fourth is taken
  });

  it('reads the data row, so it works through a sorted view', () => {
    const s = sheet();
    s.model.setCell(2, 2, { value: 'blocker', styleId: 0 });
    expect(computeOverflow(s, 2, 1, 'left', 300, 92, out()).right).toBe(0);
    expect(computeOverflow(s, 3, 1, 'left', 300, 92, out()).right).toBe(300);
  });
});
