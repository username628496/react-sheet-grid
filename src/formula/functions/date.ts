import { daysInMonth, fromSerial, inDateRange, nowSerial, parseDateInput, timeOfDay, toSerial, weekdayOf } from '../../core/model/dates';
import { type Arg, err, type FnContext, type FunctionDef, isErr, scalar, toNumber, type Value } from './helpers';

/** A date argument: a serial number, or text that reads as a date (as Sheets accepts "2026-10-07" where a date is expected). */
function dateArg(args: Arg[], i: number, ctx: FnContext): number | Value {
  const v = scalar(args[i] as Arg, ctx);
  if (typeof v === 'string') {
    const parsed = parseDateInput(v);
    return parsed === null ? err('#VALUE!') : parsed.serial;
  }
  const n = toNumber(v);
  if (isErr(n)) return n;
  return inDateRange(n) || (n >= 0 && n < 1) ? n : err('#NUM!');
}

function intArg(args: Arg[], i: number, ctx: FnContext): number | Value {
  const n = toNumber(scalar(args[i] as Arg, ctx));
  return isErr(n) ? n : Math.trunc(n);
}

function part(pick: (serial: number) => number): (args: Arg[], ctx: FnContext) => Value {
  return (args, ctx) => {
    const d = dateArg(args, 0, ctx);
    return typeof d === 'number' ? pick(d) : d;
  };
}

function date(args: Arg[], ctx: FnContext): Value {
  const y = intArg(args, 0, ctx);
  const m = intArg(args, 1, ctx);
  const d = intArg(args, 2, ctx);
  if (typeof y !== 'number') return y;
  if (typeof m !== 'number') return m;
  if (typeof d !== 'number') return d;
  // Like Sheets, 0..99 mean 1900..1999.
  const serial = toSerial(y >= 0 && y <= 99 ? 1900 + y : y, m, d);
  return inDateRange(serial) ? serial : err('#NUM!');
}

function weekday(args: Arg[], ctx: FnContext): Value {
  const d = dateArg(args, 0, ctx);
  if (typeof d !== 'number') return d;
  const type = args.length > 1 ? intArg(args, 1, ctx) : 1;
  if (typeof type !== 'number') return type;
  const sunday0 = weekdayOf(d);
  if (type === 1) return sunday0 + 1;
  if (type === 2) return ((sunday0 + 6) % 7) + 1;
  if (type === 3) return (sunday0 + 6) % 7;
  return err('#NUM!');
}

/** Same day of the month `months` later, clamped to the month's last day (31 Jan + 1 month = 28/29 Feb). */
function edate(args: Arg[], ctx: FnContext): Value {
  const d = dateArg(args, 0, ctx);
  const months = intArg(args, 1, ctx);
  if (typeof d !== 'number') return d;
  if (typeof months !== 'number') return months;
  const { year, month, day } = fromSerial(d);
  const total = year * 12 + (month - 1) + months;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  const serial = toSerial(y, m, Math.min(day, daysInMonth(y, m)));
  return inDateRange(serial) ? serial : err('#NUM!');
}

function eomonth(args: Arg[], ctx: FnContext): Value {
  const d = dateArg(args, 0, ctx);
  const months = intArg(args, 1, ctx);
  if (typeof d !== 'number') return d;
  if (typeof months !== 'number') return months;
  const { year, month } = fromSerial(d);
  const total = year * 12 + (month - 1) + months;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  const serial = toSerial(y, m, daysInMonth(y, m));
  return inDateRange(serial) ? serial : err('#NUM!');
}

function days(args: Arg[], ctx: FnContext): Value {
  const end = dateArg(args, 0, ctx);
  const start = dateArg(args, 1, ctx);
  if (typeof end !== 'number') return end;
  if (typeof start !== 'number') return start;
  return Math.floor(end) - Math.floor(start);
}

function datevalue(args: Arg[], ctx: FnContext): Value {
  const v = scalar(args[0] as Arg, ctx);
  if (typeof v !== 'string') return isErr(v) ? v : err('#VALUE!');
  const parsed = parseDateInput(v);
  return parsed === null ? err('#VALUE!') : Math.floor(parsed.serial);
}

// TODAY and NOW read the clock when evaluated: they refresh on edits and on load, not by themselves while the sheet sits open.
export const DATE_FUNCTIONS: Record<string, FunctionDef> = {
  TODAY: { min: 0, max: 0, fn: () => Math.floor(nowSerial()) },
  NOW: { min: 0, max: 0, fn: () => nowSerial() },
  DATE: { min: 3, max: 3, fn: date },
  DATEVALUE: { min: 1, max: 1, fn: datevalue },
  YEAR: { min: 1, max: 1, fn: part((d) => fromSerial(d).year) },
  MONTH: { min: 1, max: 1, fn: part((d) => fromSerial(d).month) },
  DAY: { min: 1, max: 1, fn: part((d) => fromSerial(d).day) },
  HOUR: { min: 1, max: 1, fn: part((d) => timeOfDay(d).hour) },
  MINUTE: { min: 1, max: 1, fn: part((d) => timeOfDay(d).minute) },
  SECOND: { min: 1, max: 1, fn: part((d) => timeOfDay(d).second) },
  WEEKDAY: { min: 1, max: 2, fn: weekday },
  EDATE: { min: 2, max: 2, fn: edate },
  EOMONTH: { min: 2, max: 2, fn: eomonth },
  DAYS: { min: 2, max: 2, fn: days },
};
