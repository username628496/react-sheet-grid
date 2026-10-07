import { describe, expect, it } from 'vitest';
import { type ConditionalRule, firstMatchingRule, matchesCondition, readConditionalRules } from '../../src/core/model/conditional';
import { deserializeSheet, serializeSheet } from '../../src/core/snapshot';
import { makeSheet } from './formula/helpers';

const red: ConditionalRule = { when: { kind: 'number', op: 'lt', a: 0 }, color: '#ff0000' };
const green: ConditionalRule = { when: { kind: 'number', op: 'gte', a: 100 }, background: '#00ff00' };

describe('matchesCondition', () => {
  it('numbers and dates compare numerically; text never matches a number rule', () => {
    expect(matchesCondition(red.when, -1)).toBe(true);
    expect(matchesCondition(red.when, 0)).toBe(false);
    expect(matchesCondition(red.when, 'x')).toBe(false);
    expect(matchesCondition(red.when, null)).toBe(false);
    expect(matchesCondition({ kind: 'number', op: 'between', a: 5, b: 1 }, 3)).toBe(true);
  });

  it('text conditions ignore case and look at the displayed text', () => {
    expect(matchesCondition({ kind: 'text', op: 'contains', text: 'ERR' }, 'an error')).toBe(true);
    expect(matchesCondition({ kind: 'text', op: 'notContains', text: 'err' }, 'fine')).toBe(true);
    expect(matchesCondition({ kind: 'text', op: 'startsWith', text: 'an' }, 'An error')).toBe(true);
    expect(matchesCondition({ kind: 'text', op: 'endsWith', text: 'or' }, 'error')).toBe(true);
    expect(matchesCondition({ kind: 'text', op: 'eq', text: 'TRUE' }, true)).toBe(true);
    expect(matchesCondition({ kind: 'text', op: 'eq', text: '12' }, 12)).toBe(true);
    expect(matchesCondition({ kind: 'text', op: 'notContains', text: 'a' }, null)).toBe(false); // blanks match no text rule
  });

  it('blank and not blank', () => {
    expect(matchesCondition({ kind: 'blank' }, null)).toBe(true);
    expect(matchesCondition({ kind: 'blank' }, '')).toBe(true);
    expect(matchesCondition({ kind: 'blank' }, 0)).toBe(false);
    expect(matchesCondition({ kind: 'notBlank' }, 0)).toBe(true);
  });

  it('the first matching rule wins', () => {
    expect(firstMatchingRule([red, green], -5)).toBe(red);
    expect(firstMatchingRule([red, green], 150)).toBe(green);
    expect(firstMatchingRule([red, green], 50)).toBeUndefined();
    expect(firstMatchingRule([{ when: { kind: 'notBlank' }, color: 'blue' }, red], -5)?.color).toBe('blue');
  });
});

describe('readConditionalRules', () => {
  it('drops malformed rules one by one and bad colors', () => {
    const rules = readConditionalRules([
      { when: { kind: 'blank' }, background: '#fff' },
      { when: { kind: 'number', op: 'between', a: 1 } },
      { when: { kind: 'text', op: 'contains', text: 'x' }, color: 'url(javascript:alert(1))', background: 'red' },
      null,
      5,
    ]);
    expect(rules).toEqual([{ when: { kind: 'blank' }, background: '#fff' }, { when: { kind: 'text', op: 'contains', text: 'x' }, background: 'red' }]);
    expect(readConditionalRules('nope')).toEqual([]);
  });

  it('keeps at most eight rules', () => {
    expect(readConditionalRules(Array.from({ length: 20 }, () => ({ when: { kind: 'blank' } })))).toHaveLength(8);
  });
});

describe('Spreadsheet conditional formatting', () => {
  it('applies to the selection in one undo step and survives a snapshot', () => {
    const s = makeSheet({ A1: -5, A2: 3 });
    s.selection.selectCell(0, 0);
    s.selection.extendTo(1, 0);
    s.setConditionalRules([red, green]);
    expect(s.styles.get(s.getCellByView(1, 0).styleId).conditional).toEqual([red, green]);
    const restored = deserializeSheet(JSON.parse(JSON.stringify(serializeSheet(s))));
    expect(restored.styles.get(restored.getCellByView(0, 0).styleId).conditional).toEqual([red, green]);
    s.undo();
    expect(s.styles.get(s.getCellByView(1, 0).styleId).conditional).toBeUndefined();
  });

  it('an empty list removes the rules; equal rules share one style', () => {
    const s = makeSheet({ A1: 1, A2: 2 });
    s.selection.selectCell(0, 0);
    s.selection.extendTo(1, 0);
    s.setConditionalRules([red]);
    expect(s.getCellByView(0, 0).styleId).toBe(s.getCellByView(1, 0).styleId);
    s.setConditionalRules([]);
    expect(s.styles.get(s.getCellByView(0, 0).styleId).conditional).toBeUndefined();
  });

  it('rules follow their cell through a sort', () => {
    const s = makeSheet({ A1: 9, A2: 1 });
    s.selection.selectCell(0, 0);
    s.setConditionalRules([green]); // only A1 (9)
    s.sortByColumn(0, true);
    expect(s.styles.get(s.getCellByView(1, 0).styleId).conditional).toEqual([green]);
    expect(s.styles.get(s.getCellByView(0, 0).styleId).conditional).toBeUndefined();
  });

  it('is refused on a read-only sheet', () => {
    const s = makeSheet({});
    s.readOnly = true;
    s.setConditionalRules([red]);
    expect(s.model.hasCell(0, 0)).toBe(false);
  });
});
