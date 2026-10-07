import type { CellValue } from './Cell';
import { type DateOrder, parseDateInput } from './dates';

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

export interface TypedInput {
  value: CellValue | null;
  /** Set when the text was a date or time: the number format that makes the stored serial read like the typed text. */
  format?: string;
}

/** `parseInput` plus date recognition (dates need the format too, which the plain value cannot carry). */
export function parseTypedInput(text: string, order: DateOrder = 'dmy'): TypedInput {
  const value = parseInput(text);
  if (typeof value !== 'string' || text.startsWith("'")) return { value };
  const date = parseDateInput(text, order);
  return date === null ? { value } : { value: date.serial, format: date.format };
}
