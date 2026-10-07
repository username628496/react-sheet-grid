import { describe, expect, it } from 'vitest';
import { toSerial } from '../../src/core/model/dates';
import { isValid, parseListItems, readValidation, type Validation } from '../../src/core/model/validation';
import { deserializeSheet, serializeSheet } from '../../src/core/snapshot';
import type { SheetNotice } from '../../src/core/Spreadsheet';
import { makeSheet, value } from './formula/helpers';

const list: Validation = { kind: 'list', items: ['Open', 'Done', '1'], strict: true };
const between: Validation = { kind: 'number', op: 'between', a: 1, b: 10, strict: true };

describe('isValid', () => {
  it('blank cells are always valid', () => {
    expect(isValid(list, null)).toBe(true);
    expect(isValid(list, '')).toBe(true);
    expect(isValid(between, null)).toBe(true);
  });

  it('lists match the displayed text exactly (case sensitive), numbers included', () => {
    expect(isValid(list, 'Open')).toBe(true);
    expect(isValid(list, 'open')).toBe(false);
    expect(isValid(list, 1)).toBe(true);
    expect(isValid(list, 2)).toBe(false);
    expect(isValid(list, { error: '#N/A' })).toBe(false);
  });

  it('number comparisons', () => {
    const cases: Array<[Validation, number, boolean]> = [
      [between, 1, true],
      [between, 10, true],
      [between, 10.5, false],
      [{ kind: 'number', op: 'between', a: 10, b: 1, strict: true }, 5, true], // bounds in either order
      [{ kind: 'number', op: 'notBetween', a: 1, b: 10, strict: true }, 5, false],
      [{ kind: 'number', op: 'notBetween', a: 1, b: 10, strict: true }, 11, true],
      [{ kind: 'number', op: 'eq', a: 3, strict: true }, 3, true],
      [{ kind: 'number', op: 'neq', a: 3, strict: true }, 3, false],
      [{ kind: 'number', op: 'gt', a: 3, strict: true }, 3, false],
      [{ kind: 'number', op: 'gte', a: 3, strict: true }, 3, true],
      [{ kind: 'number', op: 'lt', a: 3, strict: true }, 3, false],
      [{ kind: 'number', op: 'lte', a: 3, strict: true }, 3, true],
    ];
    for (const [rule, n, expected] of cases) expect(isValid(rule, n), JSON.stringify([rule, n])).toBe(expected);
  });

  it('numeric rules reject text and booleans', () => {
    expect(isValid(between, 'five')).toBe(false);
    expect(isValid(between, true)).toBe(false);
  });
});

describe('parseListItems / readValidation', () => {
  it('splits on commas and newlines, trims, drops blanks and duplicates', () => {
    expect(parseListItems(' a, b\nc ,, a ,\n')).toEqual(['a', 'b', 'c']);
  });

  it('reads valid rules and drops malformed ones', () => {
    expect(readValidation({ kind: 'list', items: ['a'], strict: true })).toEqual({ kind: 'list', items: ['a'], strict: true });
    expect(readValidation({ kind: 'number', op: 'gt', a: 1 })).toEqual({ kind: 'number', op: 'gt', a: 1, strict: false });
    expect(readValidation({ kind: 'date', op: 'between', a: 1, b: 2, strict: true })).toEqual({ kind: 'date', op: 'between', a: 1, b: 2, strict: true });
    for (const bad of [null, 5, {}, { kind: 'list', items: [1] }, { kind: 'number', op: 'between', a: 1 }, { kind: 'number', op: 'wat', a: 1 }, { kind: 'number', op: 'gt', a: NaN }, { kind: 'x' }]) {
      expect(readValidation(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe('Spreadsheet validation', () => {
  function sheetWithRule(rule: Validation) {
    const s = makeSheet({});
    s.selection.selectCell(0, 0);
    s.selection.extendTo(4, 0);
    s.setValidation(rule);
    return s;
  }

  it('applies to the selection, in one undo step', () => {
    const s = sheetWithRule(between);
    expect(s.styles.get(s.getCellByView(3, 0).styleId).validation).toEqual(between);
    s.undo();
    expect(s.model.hasCell(3, 0)).toBe(false);
  });

  it('a strict rule discards bad input, tells the host, and keeps the old value', () => {
    const s = sheetWithRule(between);
    const notices: SheetNotice[] = [];
    s.subscribeNotices((n) => notices.push(n));
    expect(s.setCellInput(0, 0, '5')).toBe(true);
    expect(s.setCellInput(0, 0, '50')).toBe(false);
    expect(s.setCellInput(0, 0, 'abc')).toBe(false);
    expect(value(s, 'A1')).toBe(5);
    expect(notices).toEqual([
      { code: 'validationRejected', rule: between },
      { code: 'validationRejected', rule: between },
    ]);
  });

  it('clearing a cell is always allowed', () => {
    const s = sheetWithRule(between);
    s.setCellInput(0, 0, '5');
    expect(s.setCellInput(0, 0, '')).toBe(true);
    expect(value(s, 'A1')).toBeNull();
  });

  it('a non-strict rule accepts the input and flags the cell', () => {
    const s = sheetWithRule({ ...between, strict: false });
    expect(s.setCellInput(0, 0, '50')).toBe(true);
    expect(value(s, 'A1')).toBe(50);
    expect(s.isInvalid(0, 0)).toBe(true);
    expect(s.isInvalid(1, 0)).toBe(false);
    s.setCellInput(0, 0, '5');
    expect(s.isInvalid(0, 0)).toBe(false);
  });

  it('formulas are not checked when typed', () => {
    const s = sheetWithRule(between);
    expect(s.setCellInput(0, 0, '=100+1')).toBe(true);
    expect(s.isInvalid(0, 0)).toBe(true);
  });

  it('list rules accept listed items typed as numbers', () => {
    const s = sheetWithRule(list);
    expect(s.setCellInput(0, 0, '1')).toBe(true);
    expect(s.setCellInput(0, 0, 'Done')).toBe(true);
    expect(s.setCellInput(0, 0, 'Nope')).toBe(false);
  });

  it('date rules compare serials', () => {
    const rule: Validation = { kind: 'date', op: 'gte', a: toSerial(2026, 1, 1), strict: true };
    const s = sheetWithRule(rule);
    expect(s.setCellInput(0, 0, '2026-05-01')).toBe(true);
    expect(s.setCellInput(0, 0, '2025-05-01')).toBe(false);
    expect(s.setCellInput(0, 0, 'tomorrow')).toBe(false);
  });

  it('removing the rule removes the restriction', () => {
    const s = sheetWithRule(between);
    s.setValidation(null);
    expect(s.setCellInput(0, 0, '500')).toBe(true);
    expect(s.isInvalid(0, 0)).toBe(false);
  });

  it('is refused on a read-only sheet', () => {
    const s = makeSheet({});
    s.readOnly = true;
    s.setValidation(between);
    expect(s.model.hasCell(0, 0)).toBe(false);
  });

  it('follows its cell through a sort', () => {
    const s = makeSheet({ A1: 'b', A2: 'a' });
    s.selection.selectCell(0, 0);
    s.setValidation(list); // only A1 (value 'b') has the rule
    s.sortByColumn(0, true);
    expect(s.isInvalid(1, 0)).toBe(true); // 'b' moved down with its rule and breaks it
    expect(s.isInvalid(0, 0)).toBe(false);
  });

  it('survives a snapshot round trip and refuses a damaged rule', () => {
    const s = sheetWithRule(list);
    const restored = deserializeSheet(JSON.parse(JSON.stringify(serializeSheet(s))));
    expect(restored.styles.get(restored.getCellByView(2, 0).styleId).validation).toEqual(list);
    const snap = JSON.parse(JSON.stringify(serializeSheet(s))) as { styles: Array<Record<string, unknown>> };
    for (const st of snap.styles) if (st.validation !== undefined) st.validation = { kind: 'list', items: [1, 2] };
    // The damaged rule is dropped, which leaves an empty style that duplicates the default one: a clear error.
    expect(() => deserializeSheet(snap)).toThrow(/duplicates an earlier style/);
  });
});
