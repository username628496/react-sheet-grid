import { DEFAULT_STYLE_ID } from './StyleTable';

export type CellValue = string | number | boolean;

export interface Cell {
  readonly value: CellValue | null;
  readonly styleId: number;
}

export function isEmptyCell(cell: Cell): boolean {
  return cell.value === null && cell.styleId === DEFAULT_STYLE_ID;
}
