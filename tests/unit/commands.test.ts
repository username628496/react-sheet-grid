import { describe, expect, it } from 'vitest';
import { ResizeCommand } from '../../src/core/commands/ResizeCommand';
import { SetCellsCommand } from '../../src/core/commands/SetCellsCommand';
import { Spreadsheet } from '../../src/core/Spreadsheet';

function snapshot(sheet: Spreadsheet): string {
  const cells: string[] = [];
  sheet.model.forEachCell((r, c, cell) => cells.push(`${r},${c}=${JSON.stringify(cell)}`));
  return cells.sort().join('|');
}

describe('SetCellsCommand', () => {
  it('apply then invert restores the exact previous state', () => {
    const sheet = new Spreadsheet();
    sheet.model.setCell(0, 0, { value: 'keep', styleId: 0 });
    sheet.model.setCell(1, 1, { value: 5, styleId: 2 });
    const before = snapshot(sheet);
    const cmd = new SetCellsCommand('t', [
      { dataRow: 0, dataCol: 0, cell: { value: 'changed', styleId: 0 } },
      { dataRow: 1, dataCol: 1, cell: { value: null, styleId: 0 } },
      { dataRow: 7, dataCol: 7, cell: { value: true, styleId: 0 } },
    ]);
    cmd.apply(sheet);
    expect(sheet.model.getCell(0, 0).value).toBe('changed');
    expect(sheet.model.hasCell(1, 1)).toBe(false);
    expect(sheet.model.getCell(7, 7).value).toBe(true);
    cmd.invert(sheet);
    expect(snapshot(sheet)).toBe(before);
  });

  it('survives apply -> invert -> apply -> invert', () => {
    const sheet = new Spreadsheet();
    const before = snapshot(sheet);
    const cmd = new SetCellsCommand('t', [{ dataRow: 2, dataCol: 2, cell: { value: 1, styleId: 0 } }]);
    cmd.apply(sheet);
    cmd.invert(sheet);
    cmd.apply(sheet);
    expect(sheet.model.getCell(2, 2).value).toBe(1);
    cmd.invert(sheet);
    expect(snapshot(sheet)).toBe(before);
  });

  it('restores correctly when the same cell is written twice in one command', () => {
    const sheet = new Spreadsheet();
    sheet.model.setCell(0, 0, { value: 'orig', styleId: 0 });
    const cmd = new SetCellsCommand('t', [
      { dataRow: 0, dataCol: 0, cell: { value: 'a', styleId: 0 } },
      { dataRow: 0, dataCol: 0, cell: { value: 'b', styleId: 0 } },
    ]);
    cmd.apply(sheet);
    cmd.invert(sheet);
    expect(sheet.model.getCell(0, 0).value).toBe('orig');
  });
});

describe('ResizeCommand', () => {
  it('apply then invert restores sizes', () => {
    const sheet = new Spreadsheet();
    sheet.cols.setSize(2, 150);
    const cmd = new ResizeCommand('col', [1, 2], 60);
    cmd.apply(sheet);
    expect(sheet.cols.getSize(1)).toBe(60);
    expect(sheet.cols.getSize(2)).toBe(60);
    cmd.invert(sheet);
    expect(sheet.cols.getSize(1)).toBe(100);
    expect(sheet.cols.getSize(2)).toBe(150);
  });
});

describe('Spreadsheet undo/redo', () => {
  it('undoes and redoes a typed value', () => {
    const sheet = new Spreadsheet();
    sheet.setCellInput(3, 4, '42');
    expect(sheet.getCellByView(3, 4).value).toBe(42);
    expect(sheet.undo()).toBe(true);
    expect(sheet.model.cellCount).toBe(0);
    expect(sheet.redo()).toBe(true);
    expect(sheet.getCellByView(3, 4).value).toBe(42);
    expect(sheet.redo()).toBe(false);
  });

  it('a new command clears the redo stack', () => {
    const sheet = new Spreadsheet();
    sheet.setCellInput(0, 0, 'a');
    sheet.undo();
    sheet.setCellInput(0, 0, 'b');
    expect(sheet.history.canRedo).toBe(false);
  });

  it('clearing a multi-cell selection is a single undo step and keeps formatting', () => {
    const sheet = new Spreadsheet();
    const bold = sheet.styles.intern({ bold: true });
    sheet.model.setCell(0, 0, { value: 1, styleId: bold });
    sheet.model.setCell(0, 1, { value: 2, styleId: 0 });
    sheet.model.setCell(5, 5, { value: 3, styleId: 0 });
    sheet.selection.selectCell(0, 0);
    sheet.selection.extendTo(1, 1);
    sheet.clearSelection();
    expect(sheet.getCellByView(0, 0)).toEqual({ value: null, styleId: bold });
    expect(sheet.getCellByView(0, 1).value).toBeNull();
    expect(sheet.getCellByView(5, 5).value).toBe(3);
    sheet.undo();
    expect(sheet.getCellByView(0, 0).value).toBe(1);
    expect(sheet.getCellByView(0, 1).value).toBe(2);
    expect(sheet.history.canUndo).toBe(false);
  });

  it('notifies subscribers on execute and undo', () => {
    const sheet = new Spreadsheet();
    let n = 0;
    sheet.subscribe(() => n++);
    sheet.setCellInput(0, 0, 'x');
    sheet.undo();
    expect(n).toBe(2);
  });

  it('edit text round-trips numbers-as-text with an apostrophe', () => {
    const sheet = new Spreadsheet();
    sheet.setCellInput(0, 0, "'007");
    expect(sheet.getCellByView(0, 0).value).toBe('007');
    expect(sheet.getEditText(0, 0)).toBe("'007");
    sheet.setCellInput(1, 0, 'plain');
    expect(sheet.getEditText(1, 0)).toBe('plain');
    sheet.setCellInput(2, 0, '12.5');
    expect(sheet.getEditText(2, 0)).toBe('12.5');
  });
});
