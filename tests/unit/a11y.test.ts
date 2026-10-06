import { describe, expect, it } from 'vitest';
import { describeEditing, describeSelection } from '../../src/react/a11y';
import { MESSAGES } from '../../src/react/messages';
import { addr, makeSheet } from './formula/helpers';

describe('describeSelection', () => {
  const en = MESSAGES.en;
  const vi = MESSAGES.vi;

  it('names the cell and its displayed value', () => {
    const s = makeSheet({ B3: 'hello', C3: 1234.5 });
    s.selection.selectCell(...addr('B3'));
    expect(describeSelection(s, en)).toBe('B3, hello');
    s.selection.selectCell(...addr('C3'));
    s.formatSelection({ numberFormat: '#,##0.00' });
    expect(describeSelection(s, en)).toBe('C3, 1,234.50');
  });

  it('says when a cell is empty or holds a formula', () => {
    const s = makeSheet({ A1: 2, A2: '=A1*3' });
    s.selection.selectCell(5, 5);
    expect(describeSelection(s, en)).toBe('F6, empty');
    s.selection.selectCell(...addr('A2'));
    expect(describeSelection(s, en)).toBe('A2, 6, formula');
    expect(describeSelection(s, vi)).toBe('A2, 6, công thức');
  });

  it('describes a range with its extent and the active cell', () => {
    const s = makeSheet({ A1: 'x' });
    s.selection.selectCell(...addr('A1'));
    s.selection.extendTo(...addr('C3'));
    expect(describeSelection(s, en)).toBe('Selected A1 to C3, 9 cells. Active cell A1, x');
    expect(describeSelection(s, vi)).toBe('Đã chọn A1 đến C3, 9 ô. Ô đang chọn A1, x');
    s.selection.selectCell(0, 0);
    s.selection.extendTo(0, 1);
    expect(describeSelection(s, en)).toContain('2 cells');
  });

  it('reports errors by their text, and editing by the cell address', () => {
    const s = makeSheet({ A1: '=1/0' });
    s.selection.selectCell(...addr('A1'));
    expect(describeSelection(s, en)).toBe('A1, #DIV/0!, formula');
    s.selection.selectCell(...addr('D4'));
    expect(describeEditing(s, en)).toBe('Editing D4');
    expect(describeEditing(s, vi)).toBe('Đang sửa D4');
  });
});
