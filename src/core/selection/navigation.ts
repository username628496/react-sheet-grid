import type { SelectionModel } from './SelectionModel';

export type Direction = 'up' | 'down' | 'left' | 'right';

export interface NavContext {
  readonly rowCount: number;
  readonly colCount: number;
  isEmpty(viewRow: number, viewCol: number): boolean;
  /** Bottom-right view cell holding data, or null for an empty sheet. */
  usedEnd(): { row: number; col: number } | null;
  /** Hidden rows/columns (size 0) are skipped by every move. Omitted means nothing is hidden. */
  rowHidden?(viewRow: number): boolean;
  colHidden?(viewCol: number): boolean;
}

type Hidden = ((index: number) => boolean) | undefined;

/** The next visible index from `from` in direction `step` (±1), or null when the edge is reached first. */
function visibleStep(from: number, step: 1 | -1, count: number, hidden: Hidden): number | null {
  let i = from + step;
  while (i >= 0 && i < count && hidden?.(i) === true) i += step;
  return i >= 0 && i < count ? i : null;
}

/** `index` itself if visible, else the closest visible one looking in `step` direction first, then the other way. */
function nearestVisible(index: number, step: 1 | -1, count: number, hidden: Hidden): number {
  const at = Math.max(0, Math.min(count - 1, index));
  if (hidden?.(at) !== true) return at;
  return visibleStep(at, step, count, hidden) ?? visibleStep(at, step === 1 ? -1 : 1, count, hidden) ?? at;
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
  let fromRow = opts.extend ? sel.focusRow : sel.activeRow;
  let fromCol = opts.extend ? sel.focusCol : sel.activeCol;
  // Leaving a merged block downwards or to the right starts from its far edge, so one step lands outside it.
  const block = sel.regionAt(fromRow, fromCol);
  if (block !== undefined) {
    if (dir === 'down') fromRow = block.row + block.rowSpan - 1;
    else if (dir === 'right') fromCol = block.col + block.colSpan - 1;
    else if (dir === 'up') fromRow = block.row;
    else fromCol = block.col;
  }
  let target: { row: number; col: number };
  const [dr, dc] = DELTA[dir];
  if (opts.jump) {
    target = jump(fromRow, fromCol, dir, ctx);
    // The scan treats hidden lines like any other; land on a visible one.
    target = {
      row: nearestVisible(target.row, dr === 0 ? 1 : (dr as 1 | -1), ctx.rowCount, ctx.rowHidden),
      col: nearestVisible(target.col, dc === 0 ? 1 : (dc as 1 | -1), ctx.colCount, ctx.colHidden),
    };
  } else {
    // Out of range stays put (the selection clamps), hidden lines are stepped over.
    // Nothing visible beyond (the edge, or only hidden lines left) means no move at all.
    target = {
      row: dr === 0 ? fromRow : (visibleStep(fromRow, dr as 1 | -1, ctx.rowCount, ctx.rowHidden) ?? fromRow),
      col: dc === 0 ? fromCol : (visibleStep(fromCol, dc as 1 | -1, ctx.colCount, ctx.colHidden) ?? fromCol),
    };
  }
  if (opts.extend) sel.extendTo(target.row, target.col);
  else sel.selectCell(target.row, target.col);
}

export function moveByPage(sel: SelectionModel, dir: 'up' | 'down', pageRows: number, extend: boolean, ctx?: NavContext): void {
  const delta = dir === 'down' ? pageRows : -pageRows;
  const step = dir === 'down' ? 1 : -1;
  const land = (row: number): number => (ctx === undefined ? row : nearestVisible(row, step, ctx.rowCount, ctx.rowHidden));
  if (extend) sel.extendTo(land(sel.focusRow + delta), sel.focusCol);
  else sel.selectCell(land(sel.activeRow + delta), sel.activeCol);
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
  row = nearestVisible(row, edge === 'home' ? 1 : -1, ctx.rowCount, ctx.rowHidden);
  col = nearestVisible(col, edge === 'home' ? 1 : -1, ctx.colCount, ctx.colHidden);
  if (opts.extend) sel.extendTo(row, col);
  else sel.selectCell(row, col);
}

/**
 * Tab/Enter. Inside a multi-cell range they cycle through the range (rows
 * first for Tab, columns first for Enter) without changing it; with a single
 * cell selected they just move one step.
 */
export function advanceActive(sel: SelectionModel, opts: { horizontal: boolean; backward: boolean }, ctx?: NavContext): void {
  const step = opts.backward ? -1 : 1;
  if (sel.isSingleCell()) {
    let { activeRow: row, activeCol: col } = sel;
    const block = sel.regionAt(row, col);
    if (block !== undefined) {
      if (opts.horizontal) col = step > 0 ? block.col + block.colSpan - 1 : block.col;
      else row = step > 0 ? block.row + block.rowSpan - 1 : block.row;
    }
    // Without a context the selection clamps at the edge itself; with one, "nothing visible ahead" means stay.
    if (opts.horizontal) sel.selectCell(row, ctx === undefined ? col + step : (visibleStep(col, step, ctx.colCount, ctx.colHidden) ?? col));
    else sel.selectCell(ctx === undefined ? row + step : (visibleStep(row, step, ctx.rowCount, ctx.rowHidden) ?? row), col);
    return;
  }
  const p = sel.primary;
  let r = sel.activeRow;
  let c = sel.activeCol;
  const hidden = (): boolean => ctx?.rowHidden?.(r) === true || ctx?.colHidden?.(c) === true;
  const advance = (): void => {
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
  };
  advance();
  // Hidden cells are skipped; the bound keeps a fully hidden range from looping forever.
  for (let guard = (p.endRow - p.startRow + 1) * (p.endCol - p.startCol + 1); guard > 0 && hidden(); guard--) advance();
  sel.setActive(r, c);
}
