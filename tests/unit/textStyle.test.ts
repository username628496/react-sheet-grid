import { describe, expect, it } from 'vitest';
import { wrapLines } from '../../src/core/layout/wrap';
import { CELL_VERTICAL_PADDING, clampFontSize, DEFAULT_FONT_SIZE, fontString, lineHeightFor, stepFontSize } from '../../src/core/model/font';
import { deserializeSheet, serializeSheet } from '../../src/core/snapshot';
import { resolveKey } from '../../src/input/keymap';
import { addr, makeSheet } from './formula/helpers';

describe('font helpers', () => {
  it('a default-size line fits the default row exactly', () => {
    expect(lineHeightFor(DEFAULT_FONT_SIZE) + CELL_VERTICAL_PADDING).toBe(21);
    expect(lineHeightFor(24)).toBe(30);
  });

  it('builds the CSS font from a style, and scales it for DOM boxes', () => {
    expect(fontString({})).toBe('13px Arial, "Helvetica Neue", sans-serif');
    expect(fontString({ bold: true, italic: true, fontSize: 20 })).toBe('italic bold 20px Arial, "Helvetica Neue", sans-serif');
    expect(fontString({ fontSize: 10 }, 1.5)).toBe('15px Arial, "Helvetica Neue", sans-serif');
  });

  it('clamps and rounds sizes, and steps through the list', () => {
    expect([clampFontSize(2), clampFontSize(500), clampFontSize(10.6), clampFontSize(Number.NaN)]).toEqual([6, 96, 11, 13]);
    expect(stepFontSize(13, 1)).toBe(14);
    expect(stepFontSize(13, -1)).toBe(12);
    expect(stepFontSize(15, 1)).toBe(16); // between steps: the nearest in that direction
    expect(stepFontSize(15, -1)).toBe(14);
    expect(stepFontSize(96, 1)).toBe(96);
    expect(stepFontSize(6, -1)).toBe(6);
  });
});

describe('wrapLines', () => {
  const measure = (s: string): number => s.length * 10; // every character is 10 wide
  it.each([
    ['hello world', 200, ['hello world']],
    ['hello world', 100, ['hello', 'world']],
    ['one two three four', 90, ['one two', 'three', 'four']],
    ['a b c d e f', 50, ['a b c', 'd e f']],
    ['short', 1000, ['short']],
    ['', 100, ['']],
    ['line one\nline two', 1000, ['line one', 'line two']],
    ['a\n\nb', 1000, ['a', '', 'b']],
    ['abcdefghij', 40, ['abcd', 'efgh', 'ij']], // a word wider than the cell is cut between characters
    ['ab abcdefgh cd', 50, ['ab', 'abcde', 'fgh', 'cd']],
  ] as const)('%j at %i', (text, width, expected) => {
    expect(wrapLines(text, width, measure)).toEqual(expected);
  });

  it('never splits a surrogate pair when cutting a long word', () => {
    const lines = wrapLines('😀😀😀😀😀', 30, measure); // each emoji is two code units, so 20 wide
    expect(lines.join('')).toBe('😀😀😀😀😀');
    for (const line of lines) {
      expect(/[\ud800-\udbff]$/.test(line)).toBe(false);
      expect(/^[\udc00-\udfff]/.test(line)).toBe(false);
    }
  });

  it('never returns an empty list, and every line but one-character ones fits', () => {
    expect(wrapLines('', 10, measure)).toEqual(['']);
    let seed = 99;
    const rand = (n: number): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed % n;
    };
    for (let i = 0; i < 200; i++) {
      const text = Array.from({ length: rand(40) }, () => ['a', 'bb', ' ', '  ', 'ccc', '\n'][rand(6)]).join('');
      const width = 20 + rand(100);
      const lines = wrapLines(text, width, measure);
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) expect(measure(line)).toBeLessThanOrEqual(Math.max(width, 10)); // a single character may exceed a tiny width
      expect(lines.join('\n').replace(/[\n ]/g, '')).toBe(text.replace(/[\n ]/g, '')); // nothing lost or invented (spaces at breaks aside)
    }
  });
});

describe('formatting rows to their content', () => {
  it('a bigger font grows the row, in the same undo step as the format', () => {
    const s = makeSheet({ A1: 'big' });
    s.selection.selectCell(...addr('A1'));
    s.formatSelection({ fontSize: 24 });
    expect(s.rows.getSize(0)).toBe(lineHeightFor(24) + CELL_VERTICAL_PADDING); // 34
    expect(s.styles.get(s.getCellByView(0, 0).styleId).fontSize).toBe(24);
    s.undo();
    expect(s.rows.getSize(0)).toBe(21);
    expect(s.styles.get(s.getCellByView(0, 0).styleId).fontSize).toBeUndefined();
    s.redo();
    expect(s.rows.getSize(0)).toBe(34);
  });

  it('a smaller font shrinks it back, but never below the default height', () => {
    const s = makeSheet({ A1: 'x' });
    s.selection.selectCell(...addr('A1'));
    s.formatSelection({ fontSize: 40 });
    s.formatSelection({ fontSize: 8 });
    expect(s.rows.getSize(0)).toBe(21);
  });

  it('wrapping makes the row as tall as the wrapped lines, using the measurer the renderer installs', () => {
    const s = makeSheet({ A1: 'one two three four five six', B1: 'tiny' });
    s.measureText = (_font, text) => text.length * 10;
    s.cols.setSize(0, 100); // 92 usable: 9 characters per line
    s.selection.selectCell(...addr('A1'));
    s.formatSelection({ wrap: 'wrap' });
    // "one two" / "three" / "four five" / "six" -> 4 lines (a line holds up to 9 characters)
    expect(s.rows.getSize(0)).toBe(4 * lineHeightFor(13) + CELL_VERTICAL_PADDING);
    s.cols.setSize(0, 400);
    expect(s.fitRows([0])).toBe(1);
    expect(s.rows.getSize(0)).toBe(21); // fits on one line now
  });

  it('without a measurer wrapped cells count their explicit line breaks', () => {
    const s = makeSheet({ A1: 'a\nb\nc' });
    s.selection.selectCell(...addr('A1'));
    s.formatSelection({ wrap: 'wrap' });
    expect(s.rows.getSize(0)).toBe(3 * lineHeightFor(13) + CELL_VERTICAL_PADDING);
  });

  it('other formats leave row heights alone, and hidden rows stay hidden', () => {
    const s = makeSheet({ A1: 'x', A2: 'y' });
    s.rows.setSize(0, 60);
    s.selection.selectCell(...addr('A1'));
    s.toggleStyle('bold');
    s.formatSelection({ color: '#ff0000' });
    expect(s.rows.getSize(0)).toBe(60);
    s.hideLines('row', 1, 1);
    s.selection.selectCell(0, 0);
    s.selection.extendTo(1, 0);
    s.formatSelection({ fontSize: 30 });
    expect(s.rows.getSize(1)).toBe(0);
  });

  it('stepSelectionFontSize moves through the sizes from the active cell', () => {
    const s = makeSheet({ A1: 'x' });
    s.selection.selectCell(...addr('A1'));
    s.stepSelectionFontSize(1);
    expect(s.styles.get(s.getCellByView(0, 0).styleId).fontSize).toBe(14);
    s.stepSelectionFontSize(-1);
    s.stepSelectionFontSize(-1);
    expect(s.styles.get(s.getCellByView(0, 0).styleId).fontSize).toBe(12);
  });

  it('double-click auto-fit uses the same computation: tall content, then back to default', () => {
    const s = makeSheet({ A1: 'x' });
    s.selection.selectCell(...addr('A1'));
    s.formatSelection({ fontSize: 30 });
    s.rows.setSize(0, 200); // a manual height
    expect(s.fitRows([0])).toBe(1);
    expect(s.rows.getSize(0)).toBe(lineHeightFor(30) + CELL_VERTICAL_PADDING);
  });
});

describe('text styles in snapshots', () => {
  it('survive a round trip, and bad values are dropped or clamped', () => {
    const s = makeSheet({ A1: 'x' });
    s.selection.selectCell(...addr('A1'));
    s.formatSelection({ fontSize: 20, wrap: 'wrap', valign: 'top' });
    const t = deserializeSheet(JSON.parse(JSON.stringify(serializeSheet(s))));
    expect(t.styles.get(t.getCellByView(0, 0).styleId)).toEqual({ fontSize: 20, wrap: 'wrap', valign: 'top' });
    const snapshot = JSON.parse(JSON.stringify(serializeSheet(s))) as { styles: Array<Record<string, unknown>> };
    snapshot.styles[1] = { fontSize: 5000, wrap: 'bogus', valign: 'sideways', bold: true };
    const u = deserializeSheet(snapshot);
    expect(u.styles.get(1)).toEqual({ bold: true, fontSize: 96 });
  });
});

describe('keymap: font size', () => {
  const key = (code: string) => ({ key: code === 'Period' ? '>' : '<', code, shift: true, alt: false, mod: true, isComposing: false, keyCode: 0 });
  it('Mod+Shift+. and Mod+Shift+, step the font size', () => {
    expect(resolveKey('navigating', key('Period'))).toEqual({ type: 'fontSize', direction: 1 });
    expect(resolveKey('navigating', key('Comma'))).toEqual({ type: 'fontSize', direction: -1 });
  });
});
