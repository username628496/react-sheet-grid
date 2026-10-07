import { afterEach, describe, expect, it } from 'vitest';
import { dateEditText, fromSerial, formatDate, isDateFormat, parseDateInput, setClock, toSerial, weekdayOf } from '../../src/core/model/dates';
import { formatValue } from '../../src/core/model/format';
import { parseTypedInput } from '../../src/core/model/parseInput';
import { fillCells } from '../../src/core/fill';
import { Spreadsheet } from '../../src/core/Spreadsheet';
import { calc, e, makeSheet, set, value } from './formula/helpers';

afterEach(() => setClock(null));

describe('serial numbers', () => {
  it('matches the Sheets / Excel epoch', () => {
    expect(toSerial(1899, 12, 30)).toBe(0);
    expect(toSerial(1900, 1, 1)).toBe(2);
    expect(toSerial(2026, 10, 7)).toBe(46302);
    expect(fromSerial(46302)).toEqual({ year: 2026, month: 10, day: 7 });
  });

  it('round trips every day over a few centuries, including leap days', () => {
    for (let s = toSerial(1600, 1, 1); s <= toSerial(2400, 12, 31); s += 7) {
      const { year, month, day } = fromSerial(s);
      expect(toSerial(year, month, day)).toBe(s);
    }
    expect(fromSerial(toSerial(2024, 2, 29))).toEqual({ year: 2024, month: 2, day: 29 });
    expect(fromSerial(toSerial(2026, 14, 1))).toEqual({ year: 2027, month: 2, day: 1 });
  });

  it('knows the weekday', () => {
    expect(weekdayOf(toSerial(2026, 10, 7))).toBe(3); // Wednesday
  });
});

describe('formatDate', () => {
  const d = toSerial(2026, 3, 5);
  it('formats the usual patterns', () => {
    expect(formatDate(d, 'yyyy-mm-dd')).toBe('2026-03-05');
    expect(formatDate(d, 'dd/mm/yyyy')).toBe('05/03/2026');
    expect(formatDate(d, 'd/m/yy')).toBe('5/3/26');
    expect(formatDate(d, 'd mmm yyyy')).toBe('5 Mar 2026');
    expect(formatDate(d, 'dddd, mmmm d, yyyy')).toBe('Thursday, March 5, 2026');
  });

  it('reads m as minutes next to hours and seconds', () => {
    const t = d + (14 * 3600 + 5 * 60 + 9) / 86400;
    expect(formatDate(t, 'hh:mm:ss')).toBe('14:05:09');
    expect(formatDate(t, 'yyyy-mm-dd hh:mm')).toBe('2026-03-05 14:05');
    expect(formatDate(t, 'h:mm AM/PM')).toBe('2:05 PM');
    expect(formatDate(d + 0.0001, 'h:mm AM/PM')).toBe('12:00 AM');
  });

  it('shows out of range serials as hashes instead of throwing', () => {
    expect(formatDate(1e9, 'yyyy-mm-dd')).toBe('########');
    expect(formatDate(-1e9, 'yyyy-mm-dd')).toBe('########');
  });

  it('tells date patterns from number patterns', () => {
    expect(isDateFormat('yyyy-mm-dd')).toBe(true);
    expect(isDateFormat('hh:mm')).toBe(true);
    expect(isDateFormat('0.00')).toBe(false);
    expect(isDateFormat('#,##0 ₫')).toBe(false);
    expect(isDateFormat('$#,##0.00')).toBe(false);
    expect(isDateFormat('0%')).toBe(false);
    expect(isDateFormat('yyyyy')).toBe(false);
    expect(isDateFormat(undefined)).toBe(false);
  });

  it('formatValue applies it to numbers only', () => {
    expect(formatValue(46302, 'dd/mm/yyyy')).toBe('07/10/2026');
    expect(formatValue('text', 'dd/mm/yyyy')).toBe('text');
  });
});

describe('parseDateInput', () => {
  it('reads ISO dates', () => {
    expect(parseDateInput('2026-10-07')).toEqual({ serial: 46302, format: 'yyyy-mm-dd' });
    expect(parseDateInput('2026-1-5')?.serial).toBe(toSerial(2026, 1, 5));
  });

  it('reads slash dates day first by default and month first on request', () => {
    expect(parseDateInput('3/4/2026')).toEqual({ serial: toSerial(2026, 4, 3), format: 'dd/mm/yyyy' });
    expect(parseDateInput('3/4/2026', 'mdy')).toEqual({ serial: toSerial(2026, 3, 4), format: 'mm/dd/yyyy' });
  });

  it('lets an impossible month decide which number is the day', () => {
    expect(parseDateInput('25/12/2026', 'mdy')?.serial).toBe(toSerial(2026, 12, 25));
    expect(parseDateInput('12/25/2026', 'dmy')?.serial).toBe(toSerial(2026, 12, 25));
  });

  it('reads times and date-times', () => {
    expect(parseDateInput('14:30')).toEqual({ serial: (14 * 60 + 30) / 1440, format: 'hh:mm' });
    expect(parseDateInput('9:05:30')?.format).toBe('hh:mm:ss');
    const dt = parseDateInput('2026-10-07 14:30');
    expect(dt?.serial).toBeCloseTo(46302 + (14 * 60 + 30) / 1440, 9);
    expect(dt?.format).toBe('yyyy-mm-dd hh:mm');
  });

  it('keeps near misses as text', () => {
    for (const text of ['31/2/2026', '2026-13-01', '2026-02-30', '24:00', '12:60', '1/2/26', 'hello', '2026-10-07 xx', '12', '1.5', '0999-01-01', '2026/10/07']) {
      expect(parseDateInput(text), text).toBeNull();
    }
  });
});

describe('typing dates into cells', () => {
  it('stores a serial and gives the cell a date format', () => {
    const s = makeSheet({ A1: '2026-10-07' });
    expect(value(s, 'A1')).toBe(46302);
    expect(s.styles.get(s.getCellByView(0, 0).styleId).numberFormat).toBe('yyyy-mm-dd');
    expect(s.getDisplayText(0, 0)).toBe('2026-10-07');
  });

  it('respects dateOrder', () => {
    const s = new Spreadsheet({ rowCount: 10, colCount: 5 });
    s.dateOrder = 'mdy';
    s.setCellInput(0, 0, '3/4/2026');
    expect(s.getDisplayText(0, 0)).toBe('03/04/2026');
    expect(value(s, 'A1')).toBe(toSerial(2026, 3, 4));
  });

  it('keeps a format the user already chose', () => {
    const s = makeSheet({});
    s.selection.selectCell(0, 0);
    s.formatSelection({ numberFormat: 'd mmm yyyy' }, 'Number format');
    s.setCellInput(0, 0, '2026-10-07');
    expect(s.getDisplayText(0, 0)).toBe('7 Oct 2026');
  });

  it('the apostrophe keeps date-like text as text, and editing it shows the apostrophe again', () => {
    const s = makeSheet({ A1: "'2026-10-07" });
    expect(value(s, 'A1')).toBe('2026-10-07');
    expect(s.getEditText(0, 0)).toBe("'2026-10-07");
  });

  it('edits a date as a re-parsable text whatever the display pattern', () => {
    const s = makeSheet({ A1: '2026-10-07' });
    s.selection.selectCell(0, 0);
    s.formatSelection({ numberFormat: 'dddd d mmmm yyyy' }, 'Number format');
    expect(s.getEditText(0, 0)).toBe('2026-10-07');
    s.setCellInput(0, 0, s.getEditText(0, 0));
    expect(value(s, 'A1')).toBe(46302);
    expect(s.getDisplayText(0, 0)).toBe('Wednesday 7 October 2026');
    expect(dateEditText(0.5, 'hh:mm')).toBe('12:00:00');
    expect(dateEditText(46302.5, 'yyyy-mm-dd')).toBe('2026-10-07 12:00:00');
  });

  it('undo removes both the value and the format it brought', () => {
    const s = makeSheet({});
    s.setCellInput(0, 0, '2026-10-07');
    s.undo();
    expect(s.model.hasCell(0, 0)).toBe(false);
  });

  it('parseTypedInput leaves other input alone', () => {
    expect(parseTypedInput('42')).toEqual({ value: 42 });
    expect(parseTypedInput('abc')).toEqual({ value: 'abc' });
    expect(parseTypedInput('TRUE')).toEqual({ value: true });
  });

  it('sorts and compares dates as numbers', () => {
    const s = makeSheet({ A1: '2026-03-01', A2: '2025-12-31', A3: '2026-01-15' });
    s.selection.selectCell(0, 0);
    s.sortByColumn(0, true);
    expect([0, 1, 2].map((r) => s.getDisplayText(r, 0))).toEqual(['2025-12-31', '2026-01-15', '2026-03-01']);
  });

  it('the fill series continues a run of dates daily', () => {
    const s = makeSheet({ A1: '2026-02-27', A2: '2026-02-28' });
    const c0 = s.getCellByView(0, 0);
    const c1 = s.getCellByView(1, 0);
    const filled = fillCells([[c0], [c1]], 'down', 2);
    expect(filled.map((r) => r[0]?.value)).toEqual([toSerial(2026, 3, 1), toSerial(2026, 3, 2)]);
  });
});

describe('date functions', () => {
  it('DATE and the part extractors', () => {
    expect(calc('=DATE(2026,10,7)')).toBe(46302);
    expect(calc('=DATE(2026,14,1)')).toBe(toSerial(2027, 2, 1));
    expect(calc('=DATE(2026,1,0)')).toBe(toSerial(2025, 12, 31));
    expect(calc('=DATE(99,1,1)')).toBe(toSerial(1999, 1, 1));
    expect(calc('=YEAR(A1)', { A1: '2026-10-07' })).toBe(2026);
    expect(calc('=MONTH(A1)', { A1: '2026-10-07' })).toBe(10);
    expect(calc('=DAY(A1)', { A1: '2026-10-07' })).toBe(7);
    expect(calc('=HOUR(A1)', { A1: '2026-10-07 14:30:15' })).toBe(14);
    expect(calc('=MINUTE(A1)', { A1: '2026-10-07 14:30:15' })).toBe(30);
    expect(calc('=SECOND(A1)', { A1: '2026-10-07 14:30:15' })).toBe(15);
    expect(calc('=YEAR("2026-10-07")')).toBe(2026);
  });

  it('WEEKDAY types', () => {
    const a = { A1: '2026-10-07' }; // Wednesday
    expect(calc('=WEEKDAY(A1)', a)).toBe(4);
    expect(calc('=WEEKDAY(A1,2)', a)).toBe(3);
    expect(calc('=WEEKDAY(A1,3)', a)).toBe(2);
    expect(calc('=WEEKDAY(A1,9)', a)).toEqual(e('#NUM!'));
  });

  it('EDATE clamps to the end of a shorter month, EOMONTH finds the last day', () => {
    expect(calc('=EDATE(A1,1)', { A1: '2026-01-31' })).toBe(toSerial(2026, 2, 28));
    expect(calc('=EDATE(A1,1)', { A1: '2024-01-31' })).toBe(toSerial(2024, 2, 29));
    expect(calc('=EDATE(A1,-13)', { A1: '2026-03-15' })).toBe(toSerial(2025, 2, 15));
    expect(calc('=EOMONTH(A1,0)', { A1: '2024-02-10' })).toBe(toSerial(2024, 2, 29));
    expect(calc('=EOMONTH(A1,1)', { A1: '2026-12-10' })).toBe(toSerial(2027, 1, 31));
  });

  it('DAYS and date arithmetic', () => {
    expect(calc('=DAYS(A2,A1)', { A1: '2026-01-01', A2: '2026-03-01' })).toBe(59);
    expect(calc('=A2-A1', { A1: '2026-01-01', A2: '2026-03-01' })).toBe(59);
    expect(calc('=A1+30', { A1: '2026-01-01' })).toBe(toSerial(2026, 1, 31));
  });

  it('DATEVALUE', () => {
    expect(calc('=DATEVALUE("2026-10-07")')).toBe(46302);
    expect(calc('=DATEVALUE("nope")')).toEqual(e('#VALUE!'));
    expect(calc('=DATEVALUE(5)')).toEqual(e('#VALUE!'));
  });

  it('reports errors', () => {
    expect(calc('=YEAR("nope")')).toEqual(e('#VALUE!'));
    expect(calc('=DATE(20000,1,1)')).toEqual(e('#NUM!'));
    expect(calc('=DATE("x",1,1)')).toEqual(e('#VALUE!'));
    expect(calc('=MONTH(1/0)')).toEqual(e('#DIV/0!'));
    expect(calc('=EDATE(A1,1)')).toEqual(calc('=EDATE(0,1)'));
  });

  it('TODAY and NOW read the clock', () => {
    setClock(() => new Date(2026, 9, 7, 14, 30, 0).getTime());
    expect(calc('=TODAY()')).toBe(46302);
    expect(calc('=NOW()')).toBeCloseTo(46302 + (14 * 60 + 30) / 1440, 9);
    const s = makeSheet({});
    set(s, 'A1', '=TODAY()');
    expect(s.getDisplayText(0, 0)).toBe('2026-10-07');
    set(s, 'A2', '=NOW()');
    expect(s.getDisplayText(1, 0)).toBe('2026-10-07 14:30:00');
  });

  it('a date formula gets a date format unless the cell already has one', () => {
    const s = makeSheet({});
    set(s, 'A1', '=DATE(2026,10,7)');
    expect(s.getDisplayText(0, 0)).toBe('2026-10-07');
    set(s, 'B1', '=DATE(2026,10,7)+1');
    expect(s.getDisplayText(0, 1)).toBe('2026-10-08'); // a date plus days is still a date
    set(s, 'C1', '=1+DATE(2026,10,7)');
    expect(s.getDisplayText(0, 2)).toBe('46303'); // only a leading date function is recognized
  });
});

describe('dates in fill, criteria and arithmetic', () => {
  const isDate = (id: number): boolean => id === 1;
  const d = (y: number, m: number, day: number) => ({ value: toSerial(y, m, day), styleId: 1 });
  const col = (...cells: Array<{ value: number; styleId: number }>) => cells.map((c) => [c]);
  const values = (m: Array<Array<{ value: unknown }> | undefined>): unknown[] => m.map((r) => r?.[0]?.value);

  it('one date steps a day, going back as well', () => {
    expect(values(fillCells(col(d(2026, 2, 27)), 'down', 3, isDate))).toEqual([toSerial(2026, 2, 28), toSerial(2026, 3, 1), toSerial(2026, 3, 2)]);
    expect(values(fillCells(col(d(2026, 3, 1)), 'up', 2, isDate))).toEqual([toSerial(2026, 2, 28), toSerial(2026, 2, 27)]);
  });

  it('dates one month or one year apart continue by months and years', () => {
    // Different days of the month (31 and 28) are not a month series: the plain 28-day trend continues.
    expect(values(fillCells(col(d(2026, 1, 31), d(2026, 2, 28)), 'down', 2, isDate))).toEqual([toSerial(2026, 3, 28), toSerial(2026, 4, 25)]);
    expect(values(fillCells(col(d(2026, 1, 15), d(2026, 2, 15)), 'down', 3, isDate))).toEqual([toSerial(2026, 3, 15), toSerial(2026, 4, 15), toSerial(2026, 5, 15)]);
    expect(values(fillCells(col(d(2025, 6, 1), d(2026, 6, 1)), 'down', 2, isDate))).toEqual([toSerial(2027, 6, 1), toSerial(2028, 6, 1)]);
    expect(values(fillCells(col(d(2026, 1, 15), d(2026, 2, 15)), 'up', 2, isDate))).toEqual([toSerial(2025, 12, 15), toSerial(2025, 11, 15)]);
  });

  it('month series clamps to short months using the first date', () => {
    expect(values(fillCells(col(d(2026, 1, 31), d(2026, 2, 28)), 'down', 1, isDate))[0]).toBe(toSerial(2026, 3, 28));
    expect(values(fillCells(col(d(2026, 1, 31), d(2026, 3, 31)), 'down', 2, isDate))).toEqual([toSerial(2026, 5, 31), toSerial(2026, 7, 31)]);
  });

  it('other date runs keep the numeric trend; non-date numbers are untouched', () => {
    expect(values(fillCells(col(d(2026, 1, 1), d(2026, 1, 8)), 'down', 2, isDate))).toEqual([toSerial(2026, 1, 15), toSerial(2026, 1, 22)]);
    expect(values(fillCells([[{ value: 5, styleId: 0 }]], 'down', 2, isDate))).toEqual([5, 5]);
  });

  it('the fill handle path applies it', () => {
    const s = makeSheet({ A1: '2026-01-15', A2: '2026-02-15' });
    s.fillRange({ startRow: 0, endRow: 1, startCol: 0, endCol: 0 }, 'down', 2);
    expect([2, 3].map((r) => s.getDisplayText(r, 0))).toEqual(['2026-03-15', '2026-04-15']);
  });

  it('COUNTIF and SUMIF criteria understand dates', () => {
    const cells = { A1: '2026-01-01', A2: '2026-06-01', A3: '2026-12-01', B1: 1, B2: 2, B3: 4 };
    expect(calc('=COUNTIF(A1:A3,">2026-03-01")', cells)).toBe(2);
    expect(calc('=COUNTIF(A1:A3,"2026-06-01")', cells)).toBe(1);
    expect(calc('=SUMIF(A1:A3,"<=2026-06-01",B1:B3)', cells)).toBe(3);
  });

  it('text dates work in arithmetic', () => {
    expect(calc('="2026-01-01"+1')).toBe(toSerial(2026, 1, 2));
    expect(calc('=DAYS("2026-03-01","2026-01-01")')).toBe(59);
  });
});
