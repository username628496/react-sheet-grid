import type { CellValue } from './Cell';

const NUMBER_RE = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

/** Turns what the user typed into a stored value (formulas are handled elsewhere). */
export function parseInput(text: string): CellValue | null {
  if (text === '') return null;
  // A leading apostrophe forces text, e.g. '007 keeps its zeros.
  if (text.startsWith("'")) return text.slice(1);
  const trimmed = text.trim();
  if (NUMBER_RE.test(trimmed)) return Number(trimmed);
  const upper = trimmed.toUpperCase();
  if (upper === 'TRUE') return true;
  if (upper === 'FALSE') return false;
  return text;
}
