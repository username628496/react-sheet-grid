import type { SelectionModel } from './SelectionModel';

export type Direction = 'up' | 'down' | 'left' | 'right';

export interface NavContext {
  readonly rowCount: number;
  readonly colCount: number;
  isEmpty(viewRow: number, viewCol: number): boolean;
  /** Bottom-right view cell holding data, or null for an empty sheet. */
  usedEnd(): { row: number; col: number } | null;
}

const DELTA: Record<Direction, readonly [number, number]> = {
  up: [-1, 0],
  down: [1, 0],
  left: [0, -1],
  right: [0, 1],
};

/**
 * Ctrl+arrow, same rule as Google Sheets: from a filled cell followed by a
 * filled cell, run to the end of that block; otherwise stop at the next
 * filled cell, or at the edge when there is none.
 */
function jump(row: number, col: number, dir: Direction, ctx: NavContext): { row: number; col: number } {
  const [dr, dc] = DELTA[dir];
  const inside = (r: number, c: number): boolean => r >= 0 && c >= 0 && r < ctx.rowCount && c < ctx.colCount;
  let r = row + dr;
  let c = col + dc;
  if (!inside(r, c)) return { row, col };
  if (!ctx.isEmpty(row, col) && !ctx.isEmpty(r, c)) {
    while (inside(r + dr, c + dc) && !ctx.isEmpty(r + dr, c + dc)) {
      r += dr;
      c += dc;
    }
    return { row: r, col: c };
  }
  while (inside(r, c) && ctx.isEmpty(r, c)) {
    r += dr;
    c += dc;
  }
  if (!inside(r, c)) {
    return { row: dr === 0 ? row : dr > 0 ? ctx.rowCount - 1 : 0, col: dc === 0 ? col : dc > 0 ? ctx.colCount - 1 : 0 };
  }
  return { row: r, col: c };
}

export function moveByArrow(
  sel: SelectionModel,
  dir: Direction,
  opts: { extend: boolean; jump: boolean },
  ctx: NavContext,
): void {
  const fromRow = opts.extend ? sel.focusRow : sel.activeRow;
  const fromCol = opts.extend ? sel.focusCol : sel.activeCol;
  let target: { row: number; col: number };
  if (opts.jump) {
    target = jump(fromRow, fromCol, dir, ctx);
  } else {
    const [dr, dc] = DELTA[dir];
    target = { row: fromRow + dr, col: fromCol + dc };
  }
  if (opts.extend) sel.extendTo(target.row, target.col);
  else sel.selectCell(target.row, target.col);
}

export function moveByPage(sel: SelectionModel, dir: 'up' | 'down', pageRows: number, extend: boolean): void {
  const delta = dir === 'down' ? pageRows : -pageRows;
  if (extend) sel.extendTo(sel.focusRow + delta, sel.focusCol);
  else sel.selectCell(sel.activeRow + delta, sel.activeCol);
}

export function moveToEdge(
  sel: SelectionModel,
  edge: 'home' | 'end',
  opts: { ctrl: boolean; extend: boolean },
  ctx: NavContext,
): void {
  let row = opts.extend ? sel.focusRow : sel.activeRow;
  let col = edge === 'home' ? 0 : ctx.colCount - 1;
  if (opts.ctrl) {
    if (edge === 'home') {
      row = 0;
    } else {
      const end = ctx.usedEnd();
      row = end?.row ?? 0;
      col = end?.col ?? 0;
    }
  }
  if (opts.extend) sel.extendTo(row, col);
  else sel.selectCell(row, col);
}

/**
 * Tab/Enter. Inside a multi-cell range they cycle through the range (rows
 * first for Tab, columns first for Enter) without changing it; with a single
 * cell selected they just move one step.
 */
export function advanceActive(sel: SelectionModel, opts: { horizontal: boolean; backward: boolean }): void {
  const step = opts.backward ? -1 : 1;
  if (sel.isSingleCell()) {
    if (opts.horizontal) sel.selectCell(sel.activeRow, sel.activeCol + step);
    else sel.selectCell(sel.activeRow + step, sel.activeCol);
    return;
  }
  const p = sel.primary;
  let r = sel.activeRow;
  let c = sel.activeCol;
  if (opts.horizontal) {
    c += step;
    if (c > p.endCol) {
      c = p.startCol;
      r = r + 1 > p.endRow ? p.startRow : r + 1;
    } else if (c < p.startCol) {
      c = p.endCol;
      r = r - 1 < p.startRow ? p.endRow : r - 1;
    }
  } else {
    r += step;
    if (r > p.endRow) {
      r = p.startRow;
      c = c + 1 > p.endCol ? p.startCol : c + 1;
    } else if (r < p.startRow) {
      r = p.endRow;
      c = c - 1 < p.startCol ? p.endCol : c - 1;
    }
  }
  sel.setActive(r, c);
}
