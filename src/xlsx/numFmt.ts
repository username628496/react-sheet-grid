import { isDateFormat } from '../core/model/dates';
import { buildNumberFormat, parseNumberFormat } from '../core/model/format';

/** Excel's built-in number format ids that this grid can show, as this grid's own patterns. */
const BUILTIN: Readonly<Record<number, string>> = {
  1: '0',
  2: '0.00',
  3: '#,##0',
  4: '#,##0.00',
  9: '0%',
  10: '0.00%',
  14: 'mm/dd/yyyy',
  15: 'd-mmm-yy',
  16: 'd-mmm',
  17: 'mmm-yy',
  18: 'h:mm AM/PM',
  19: 'h:mm:ss AM/PM',
  20: 'hh:mm',
  21: 'hh:mm:ss',
  22: 'mm/dd/yyyy hh:mm',
  37: '#,##0',
  38: '#,##0',
  39: '#,##0.00',
  40: '#,##0.00',
  45: 'mm:ss',
};

const quote = (text: string): string => (text === '' || text === '$' ? text : `"${text}"`);

/** This grid's pattern as an Excel format code, or null when it has no Excel spelling (the cell is then "General"). */
export function toExcelFormat(format: string | undefined): string | null {
  if (format === undefined) return null;
  if (isDateFormat(format)) return format;
  const p = parseNumberFormat(format);
  if (p === null || p.prefix.includes('"') || p.suffix.includes('"')) return null;
  return `${quote(p.prefix)}${p.grouping ? '#,##0' : '0'}${p.decimals > 0 ? `.${'0'.repeat(p.decimals)}` : ''}${p.suffix === '%' ? '%' : quote(p.suffix)}`;
}

/**
 * An Excel format (a built-in id, or custom code) as one of this grid's patterns, or undefined for General and for
 * anything this grid cannot show (thousands scaling, [h] elapsed time, fractions, several conditions...). Only the
 * first section of a multi-section format is read, which is the positive one.
 */
export function fromExcelFormat(id: number, code: string | undefined): string | undefined {
  if (code === undefined) return BUILTIN[id];
  let section = '';
  let inQuote = false;
  for (let i = 0; i < code.length; i++) {
    const ch = code[i] as string;
    if (ch === '"') inQuote = !inQuote;
    if (ch === '\\') {
      section += code.slice(i, i + 2);
      i++;
      continue;
    }
    if (ch === ';' && !inQuote) break;
    section += ch;
  }
  // Elapsed time ([h]:mm) and conditional sections ([>100]) mean something this grid cannot show.
  if (/\[(?:h+|m+|s+)\]/i.test(section) || /\[[<>=]/.test(section)) return undefined;
  // Tags in brackets: [Red], [$-409] and the like are dropped; [$€-407] is a currency sign.
  section = section.replace(/\[\$([^\]-]*)[^\]]*\]/g, (_m, sign: string) => (sign === '' ? '' : `"${sign}"`)).replace(/\[[^\]]*\]/g, '');
  if (/\[|\]/.test(section)) return undefined;
  // Padding (_x) and repeat (*x) codes only affect alignment.
  section = section.replace(/_./g, '').replace(/\*./g, '');
  // Quoted text and escaped characters become literal text.
  let literal = '';
  let quoted = false;
  for (let i = 0; i < section.length; i++) {
    const ch = section[i] as string;
    if (ch === '"') quoted = !quoted;
    else if (ch === '\\' && !quoted) {
      literal += section[i + 1] ?? '';
      i++;
    } else literal += ch;
  }
  if (literal === '' || /^general$/i.test(literal) || literal === '@') return undefined;
  // Date patterns are written in lower case here (AM/PM aside).
  const dated = literal.replace(/AM\/PM/gi, '\u0000').toLowerCase().replace('\u0000', 'AM/PM');
  if (isDateFormat(dated)) return dated;
  const p = parseNumberFormat(literal);
  return p === null ? undefined : buildNumberFormat(p);
}
