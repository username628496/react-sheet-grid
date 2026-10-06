import { cellAddress, parseColumnLabel } from '../core/model/address';
import { MAX_COLS, MAX_ROWS } from '../core/model/SheetModel';

/** A cell or range reference found in formula text, with its absolute 0-based data coordinates. */
export interface RefMatch {
  readonly start: number;
  readonly end: number; // exclusive
  readonly text: string;
  readonly r1: number;
  readonly c1: number;
  readonly r2: number;
  readonly c2: number;
}

const REF_RE = /(\$?)([A-Za-z]{1,3})(\$?)(\d+)(?::(\$?)([A-Za-z]{1,3})(\$?)(\d+))?/g;
const IDENT_CHAR = /[A-Za-z0-9_.$]/;

/** Spans of `text` that are code, i.e. outside "string literals". Tolerates a string that is still open. */
function codeSegments(text: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let start = 0;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '"') continue;
    if (!inString) {
      out.push([start, i]);
      inString = true;
    } else if (text[i + 1] === '"') {
      i++; // doubled quote inside a string
    } else {
      inString = false;
      start = i + 1;
    }
  }
  if (!inString) out.push([start, text.length]);
  return out;
}

/** True when `caret` sits inside a string literal. */
function inStringAt(text: string, caret: number): boolean {
  const segments = codeSegments(text.slice(0, caret));
  const last = segments[segments.length - 1];
  return last === undefined || last[1] !== caret; // an open string leaves no segment reaching the caret
}

/**
 * Lenient scan for references while the user is typing: unlike the real parser it never throws on half-typed
 * input. Names such as LOG10( or ATAN2( are not references, and quoted text is skipped.
 */
export function findReferences(text: string): RefMatch[] {
  if (!text.startsWith('=')) return [];
  const found: RefMatch[] = [];
  for (const [from, to] of codeSegments(text)) {
    REF_RE.lastIndex = from;
    for (let m = REF_RE.exec(text); m !== null && m.index < to; m = REF_RE.exec(text)) {
      const start = m.index;
      const end = start + m[0].length;
      if (end > to) break;
      const before = start > 0 ? (text[start - 1] as string) : '';
      const after = text[end] ?? '';
      if ((before !== '' && IDENT_CHAR.test(before)) || /[A-Za-z0-9_(]/.test(after)) continue;
      const c1 = parseColumnLabel(m[2] as string);
      const r1 = Number(m[4]) - 1;
      const hasRange = m[6] !== undefined;
      const c2 = hasRange ? parseColumnLabel(m[6] as string) : c1;
      const r2 = hasRange ? Number(m[8]) - 1 : r1;
      if (c1 >= MAX_COLS || c2 >= MAX_COLS || r1 < 0 || r2 < 0 || r1 >= MAX_ROWS || r2 >= MAX_ROWS) continue;
      found.push({
        start,
        end,
        text: m[0],
        r1: Math.min(r1, r2),
        c1: Math.min(c1, c2),
        r2: Math.max(r1, r2),
        c2: Math.max(c1, c2),
      });
    }
  }
  return found;
}

/** Text of a reference to the cell or range between two corners, normalized (top-left first). */
export function refToText(r1: number, c1: number, r2: number, c2: number): string {
  const top = Math.min(r1, r2);
  const bottom = Math.max(r1, r2);
  const left = Math.min(c1, c2);
  const right = Math.max(c1, c2);
  return top === bottom && left === right ? cellAddress(top, left) : `${cellAddress(top, left)}:${cellAddress(bottom, right)}`;
}

const REF_OPENERS = new Set(['=', '(', ',', ';', '+', '-', '*', '/', '^', '&', '<', '>', ':']);

/**
 * Whether a cell reference may be inserted at `caret`: right after `=`, an operator, `(` or an argument
 * separator (ignoring spaces), and never inside a string. This is when arrows and clicks "point" at cells.
 */
export function canInsertReference(text: string, caret: number): boolean {
  if (!text.startsWith('=') || caret < 1) return false;
  if (inStringAt(text, caret)) return false;
  let i = caret - 1;
  while (i > 0 && text[i] === ' ') i--;
  return REF_OPENERS.has(text[i] as string);
}

// (colAbs, rowAbs) cycle used by F4 in Excel and Sheets: A1 -> $A$1 -> A$1 -> $A1 -> A1.
const NEXT_MODE: Record<string, readonly [boolean, boolean]> = {
  'false,false': [true, true],
  'true,true': [false, true],
  'false,true': [true, false],
  'true,false': [false, false],
};

/**
 * F4: cycles the reference under the caret between relative and absolute forms. For a range the mode is read
 * from its first cell and applied to the whole range. Returns null when the caret is not on a reference.
 */
export function cycleReference(text: string, caret: number): { text: string; start: number; end: number } | null {
  const refs = findReferences(text);
  const ref = refs.find((r) => caret > r.start && caret <= r.end) ?? refs.find((r) => caret === r.start);
  if (ref === undefined) return null;
  const parts = [...ref.text.matchAll(/(\$?)([A-Za-z]{1,3})(\$?)(\d+)/g)];
  const first = parts[0];
  if (first === undefined) return null;
  const [colAbs, rowAbs] = NEXT_MODE[`${first[1] === '$'},${first[3] === '$'}`] as readonly [boolean, boolean];
  const rewritten = parts
    .map((m) => `${colAbs ? '$' : ''}${(m[2] as string).toUpperCase()}${rowAbs ? '$' : ''}${m[4]}`)
    .join(':');
  const next = text.slice(0, ref.start) + rewritten + text.slice(ref.end);
  return { text: next, start: ref.start, end: ref.start + rewritten.length };
}

