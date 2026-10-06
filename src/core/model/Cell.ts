import type { Expr } from '../../formula/ast';
import { DEFAULT_STYLE_ID } from './StyleTable';

export type ErrorCode = '#DIV/0!' | '#VALUE!' | '#REF!' | '#N/A' | '#NAME?' | '#NUM!' | '#ERROR!';

export interface CellError {
  readonly error: ErrorCode;
}

export type CellValue = string | number | boolean | CellError;

export interface Cell {
  /** For formula cells this is the cached result, kept up to date by the formula engine. */
  readonly value: CellValue | null;
  readonly styleId: number;
  readonly formula?: Expr;
}

export function isCellError(value: unknown): value is CellError {
  return typeof value === 'object' && value !== null && 'error' in value;
}

export function isEmptyCell(cell: Cell): boolean {
  return cell.value === null && cell.styleId === DEFAULT_STYLE_ID && cell.formula === undefined;
}
