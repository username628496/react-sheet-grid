export interface TextSearchOptions {
  /** Distinguish upper and lower case (default: no). */
  matchCase?: boolean;
  /** The whole text must equal the query, not just contain it. */
  wholeCell?: boolean;
  /** Treat letters with accents as their plain letter, so "viet" finds "Việt" (default: no). */
  ignoreAccents?: boolean;
}

/** A found piece of text: [start, end) in UTF-16 units of the original string. */
export type TextRange = readonly [start: number, end: number];

interface Folded {
  text: string;
  /** For each folded character, where it came from in the original string. */
  from: number[];
  to: number[];
}

// Vietnamese đ/Đ is a letter of its own (not d plus a mark), so Unicode decomposition does not reduce it.
function foldCodePoint(char: string, options: TextSearchOptions): string {
  let out = char;
  if (options.ignoreAccents === true) {
    out = out.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');
  }
  if (options.matchCase !== true) out = out.toLowerCase();
  return out;
}

/** Folds case and accents while remembering where each resulting character came from, so matches map back exactly. */
function fold(text: string, options: TextSearchOptions): Folded {
  const folded: Folded = { text: '', from: [], to: [] };
  let at = 0;
  for (const char of text) {
    const next = at + char.length;
    for (const f of foldCodePoint(char, options)) {
      for (let k = 0; k < f.length; k++) {
        folded.text += f[k];
        folded.from.push(at);
        folded.to.push(next);
      }
    }
    at = next;
  }
  return folded;
}

/**
 * Searching visits every filled cell, so the common case (no accent folding, and lower-casing keeps the length) skips
 * the character-by-character mapping: positions in the folded and original strings are then the same.
 */
// eslint-disable-next-line no-control-regex -- the range is exactly "ASCII"
const ASCII = /^[\u0000-\u007f]*$/;

function findPlain(text: string, query: string, options: TextSearchOptions): TextRange[] | null {
  // Accent folding cannot change plain ASCII text, so only a non-ASCII text needs the mapping path.
  if (options.ignoreAccents === true && !ASCII.test(text)) return null;
  const hay = options.matchCase === true ? text : text.toLowerCase();
  const needle = fold(query, options).text; // short, and already folded the way the options say
  if (hay.length !== text.length) return null; // a rare letter changes length when lower-cased: use the exact path
  if (needle === '') return [];
  if (options.wholeCell === true) return hay === needle ? [[0, text.length]] : [];
  const found: TextRange[] = [];
  let from = 0;
  for (;;) {
    const at = hay.indexOf(needle, from);
    if (at < 0) return found;
    found.push([at, at + needle.length]);
    from = at + needle.length;
  }
}

/** Non-overlapping matches of `query` in `text`, left to right. An empty query matches nothing. */
export function findInText(text: string, query: string, options: TextSearchOptions = {}): TextRange[] {
  if (query === '') return [];
  const plain = findPlain(text, query, options);
  if (plain !== null) return plain;
  const needle = fold(query, options).text;
  if (needle === '') return []; // a query made only of accents, with accents ignored
  const hay = fold(text, options);
  if (options.wholeCell === true) {
    return hay.text === needle && hay.text.length > 0 ? [[0, text.length]] : [];
  }
  const found: TextRange[] = [];
  let from = 0;
  for (;;) {
    const at = hay.text.indexOf(needle, from);
    if (at < 0) break;
    const last = at + needle.length - 1;
    found.push([hay.from[at] as number, hay.to[last] as number]);
    from = at + needle.length;
  }
  return found;
}

/**
 * Replaces every match of `query` in `text`. With `wholeCell` the whole text is replaced. Returns the new text and how
 * many replacements were made (0 means the text is unchanged).
 */
export function replaceInText(
  text: string,
  query: string,
  replacement: string,
  options: TextSearchOptions = {},
): { text: string; count: number } {
  const ranges = findInText(text, query, options);
  if (ranges.length === 0) return { text, count: 0 };
  let out = '';
  let at = 0;
  for (const [start, end] of ranges) {
    out += text.slice(at, start) + replacement;
    at = end;
  }
  return { text: out + text.slice(at), count: ranges.length };
}
