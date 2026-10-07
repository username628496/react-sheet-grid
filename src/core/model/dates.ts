/**
 * Dates are plain numbers (days since 1899-12-30, the fraction being the time of day) displayed through a date
 * number format, exactly like Google Sheets and Excel. Keeping them numeric means sorting, filtering, comparison,
 * arithmetic and the fill series work on dates with no special cases. All math is UTC so the result never depends on
 * the machine's time zone or daylight saving.
 */

const MS_PER_DAY = 86_400_000;
const EPOCH = Date.UTC(1899, 11, 30);

export type DateOrder = 'dmy' | 'mdy';

export interface DateParts {
  year: number;
  month: number;
  day: number;
}

/** Valid serials: year 1000 to 9999, which also keeps `Date` well away from its own limits. */
export const MIN_SERIAL = Math.round((Date.UTC(1000, 0, 1) - EPOCH) / MS_PER_DAY);
export const MAX_SERIAL = Math.round((Date.UTC(9999, 11, 31) - EPOCH) / MS_PER_DAY);

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function isValidDate(year: number, month: number, day: number): boolean {
  return year >= 1000 && year <= 9999 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

/** Serial of a calendar date; month and day may overflow (month 13 is January next year), as in the DATE function. */
export function toSerial(year: number, month: number, day: number): number {
  const d = new Date(Date.UTC(2000, 0, 1));
  d.setUTCFullYear(year, month - 1, day);
  return Math.round((d.getTime() - EPOCH) / MS_PER_DAY);
}

export function fromSerial(serial: number): DateParts {
  const d = new Date(EPOCH + Math.floor(serial) * MS_PER_DAY);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** 0 = Sunday, like `Date`. */
export function weekdayOf(serial: number): number {
  return new Date(EPOCH + Math.floor(serial) * MS_PER_DAY).getUTCDay();
}

export function timeOfDay(serial: number): { hour: number; minute: number; second: number } {
  const seconds = Math.round((serial - Math.floor(serial)) * 86_400);
  return { hour: Math.floor(seconds / 3600) % 24, minute: Math.floor(seconds / 60) % 60, second: seconds % 60 };
}

export function inDateRange(serial: number): boolean {
  return Number.isFinite(serial) && serial >= MIN_SERIAL && serial < MAX_SERIAL + 1;
}

/** Overridable so tests (and hosts that want a fixed clock) are deterministic. */
let clock: () => number = () => Date.now();

export function setClock(next: (() => number) | null): void {
  clock = next ?? (() => Date.now());
}

/** The current local date and time as a serial (people expect TODAY() to be their own calendar day). */
export function nowSerial(): number {
  const now = new Date(clock());
  return (Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes(), now.getSeconds()) - EPOCH) / MS_PER_DAY;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Letters allowed in a date pattern: y (year), m (month, or minutes right after h or before s), d, h, s, and AM/PM. */
const DATE_PATTERN = /^(?:(?:y{2}|y{4}|m{1,4}|d{1,4}|h{1,2}|s{1,2}|AM\/PM)|[ /\-:.,])+$/i;
const TOKEN = /y{4}|y{2}|m{1,4}|d{1,4}|h{1,2}|s{1,2}|AM\/PM|[ /\-:.,]/gi;
const dateTokens = new Map<string, string[] | null>();

function tokensOf(format: string): string[] | null {
  const cached = dateTokens.get(format);
  if (cached !== undefined) return cached;
  // Number patterns hold 0 # % currency; none of them can be spelled with only these letters.
  const tokens = /[ymdhs]/i.test(format) && DATE_PATTERN.test(format) ? (format.match(TOKEN) ?? null) : null;
  dateTokens.set(format, tokens);
  return tokens;
}

export function isDateFormat(format: string | undefined): boolean {
  return format !== undefined && tokensOf(format) !== null;
}

const two = (n: number): string => (n < 10 ? `0${n}` : String(n));

/** Text of a serial under a date pattern; out of range serials show as a run of `#`, like Sheets. */
export function formatDate(serial: number, format: string): string {
  const tokens = tokensOf(format);
  if (tokens === null) return String(serial);
  if (!inDateRange(serial)) return '########';
  const { year, month, day } = fromSerial(serial);
  const { hour, minute, second } = timeOfDay(serial);
  const twelveHour = tokens.some((t) => t.toUpperCase() === 'AM/PM');
  let out = '';
  tokens.forEach((raw, i) => {
    const t = raw.toLowerCase();
    switch (t[0]) {
      case 'y':
        out += t.length === 4 ? String(year) : two(year % 100);
        break;
      case 'm': {
        // After an hour or before a second, `m` means minutes.
        const prev = tokens[i - 2]?.toLowerCase();
        const next = tokens[i + 2]?.toLowerCase();
        if (prev?.[0] === 'h' || next?.[0] === 's') out += t.length === 1 ? String(minute) : two(minute);
        else if (t.length === 1) out += String(month);
        else if (t.length === 2) out += two(month);
        else if (t.length === 3) out += (MONTHS[month - 1] as string).slice(0, 3);
        else out += MONTHS[month - 1] as string;
        break;
      }
      case 'd':
        if (t.length === 1) out += String(day);
        else if (t.length === 2) out += two(day);
        else if (t.length === 3) out += (WEEKDAYS[weekdayOf(serial)] as string).slice(0, 3);
        else out += WEEKDAYS[weekdayOf(serial)] as string;
        break;
      case 'h': {
        const h = twelveHour ? hour % 12 || 12 : hour;
        out += t.length === 1 ? String(h) : two(h);
        break;
      }
      case 's':
        out += t.length === 1 ? String(second) : two(second);
        break;
      case 'a':
        out += hour < 12 ? 'AM' : 'PM';
        break;
      default:
        out += raw;
    }
  });
  return out;
}

export const DATE_FORMAT = 'yyyy-mm-dd';
export const TIME_FORMAT = 'hh:mm:ss';
export const DATE_TIME_FORMAT = 'yyyy-mm-dd hh:mm:ss';

export interface ParsedDate {
  serial: number;
  /** The format a cell should get so the value reads as what was typed. */
  format: string;
}

const TIME_RE = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;
const ISO_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const SLASH_RE = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/;

function parseTime(text: string): number | null {
  const m = TIME_RE.exec(text);
  if (m === null) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  const s = m[3] === undefined ? 0 : Number(m[3]);
  if (h > 23 || min > 59 || s > 59) return null;
  return (h * 3600 + min * 60 + s) / 86_400;
}

/**
 * Recognizes typed dates: `2026-10-07`, `7/10/2026` (day first or month first by `order`; when one number is above 12
 * it can only be the day, so `25/12/2026` is read right either way), either followed by a time, or a bare time such as
 * `14:30`. Anything else, including impossible days such as 31/2, stays text.
 */
export function parseDateInput(text: string, order: DateOrder = 'dmy'): ParsedDate | null {
  const trimmed = text.trim();
  if (trimmed.length < 4 || trimmed.length > 30) return null;
  const clock = parseTime(trimmed);
  if (clock !== null) return { serial: clock, format: trimmed.split(':').length === 3 ? TIME_FORMAT : 'hh:mm' };
  const space = trimmed.indexOf(' ');
  const datePart = space < 0 ? trimmed : trimmed.slice(0, space);
  const timePart = space < 0 ? null : trimmed.slice(space + 1).trim();
  const fraction = timePart === null ? 0 : parseTime(timePart);
  if (fraction === null) return null;

  let year: number;
  let month: number;
  let day: number;
  let format: string;
  const iso = ISO_RE.exec(datePart);
  if (iso !== null) {
    [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
    format = DATE_FORMAT;
  } else {
    const m = SLASH_RE.exec(datePart);
    if (m === null) return null;
    const a = Number(m[1]);
    const b = Number(m[2]);
    year = Number(m[3]);
    const dayFirst = a > 12 ? true : b > 12 ? false : order === 'dmy';
    [day, month] = dayFirst ? [a, b] : [b, a];
    const sep = /[/.-]/.exec(datePart)?.[0] ?? '/';
    format = order === 'dmy' ? `dd${sep}mm${sep}yyyy` : `mm${sep}dd${sep}yyyy`;
  }
  if (!isValidDate(year, month, day)) return null;
  const hasTime = timePart !== null;
  if (hasTime && timePart.split(':').length === 2) format += ' hh:mm';
  else if (hasTime) format += ' hh:mm:ss';
  return { serial: toSerial(year, month, day) + fraction, format };
}

/** What the editor shows for a date cell: always a form `parseDateInput` reads back, whatever the display pattern. */
export function dateEditText(serial: number, format: string): string {
  if (!inDateRange(serial)) return String(serial);
  const timeOnly = serial < 1 && /[hs]/i.test(format) && !/[yd]/i.test(format);
  if (timeOnly) return formatDate(serial, TIME_FORMAT);
  return formatDate(serial, Number.isInteger(serial) ? DATE_FORMAT : DATE_TIME_FORMAT);
}
