import type { Cell } from './model/Cell';

export type FillDirection = 'down' | 'up' | 'left' | 'right';

const TRAILING_NUMBER = /^([\s\S]*?)(\d+)$/;

/** Removes binary noise such as 0.1 * 3 = 0.30000000000000004 from generated numbers. */
function clean(n: number): number {
  return Number(n.toPrecision(15));
}

/**
 * Linear model value(j) = base + step * j over source positions j = 0..n-1.
 * A constant difference gives an exact arithmetic series; anything else falls
 * back to a least-squares trend line, which is what Sheets does.
 */
function linearFit(values: readonly number[]): { base: number; step: number } {
  const n = values.length;
  const first = values[0] as number;
  const step = ((values[n - 1] as number) - first) / (n - 1);
  const exact = values.every((v, i) => Math.abs(v - (first + step * i)) < 1e-9 * Math.max(1, Math.abs(v)));
  if (exact) return { base: first, step };
  const meanX = (n - 1) / 2;
  const meanY = values.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  values.forEach((y, x) => {
    num += (x - meanX) * (y - meanY);
    den += (x - meanX) ** 2;
  });
  const slope = num / den;
  return { base: meanY - slope * meanX, step: slope };
}

/** A way to produce the cell at lane position j (j may be negative or >= n), or null to just repeat the cells. */
type Series = (j: number, style: number) => Cell | null;

function numberSeries(lane: readonly Cell[]): Series | null {
  if (lane.length < 2) return null; // one number is copied, like Sheets
  if (!lane.every((c) => c.formula === undefined && typeof c.value === 'number')) return null;
  const { base, step } = linearFit(lane.map((c) => c.value as number));
  return (j, styleId) => ({ value: clean(base + step * j), styleId });
}

// "Item 1", "Item 2" -> "Item 3". Even a single such cell is incremented, as in Sheets.
function textSeries(lane: readonly Cell[]): Series | null {
  const parts: Array<{ prefix: string; digits: string }> = [];
  for (const c of lane) {
    if (c.formula !== undefined || typeof c.value !== 'string') return null;
    const m = TRAILING_NUMBER.exec(c.value);
    if (m === null) return null;
    parts.push({ prefix: m[1] as string, digits: m[2] as string });
  }
  const prefix = (parts[0] as { prefix: string }).prefix;
  if (!parts.every((p) => p.prefix === prefix)) return null;
  const nums = parts.map((p) => Number(p.digits));
  const { base, step } = nums.length === 1 ? { base: nums[0] as number, step: 1 } : linearFit(nums);
  const width = (parts[parts.length - 1] as { digits: string }).digits.length;
  const padded = parts.some((p) => p.digits.length > 1 && p.digits.startsWith('0'));
  return (j, styleId) => {
    const n = Math.round(base + step * j);
    if (n < 0) return null;
    const digits = padded ? String(n).padStart(width, '0') : String(n);
    return { value: `${prefix}${digits}`, styleId };
  };
}

/**
 * Fills `count` more lines beyond `source` in `direction`.
 *
 * `source` is a matrix [row][col] of view-ordered cells. Result lines are
 * ordered away from the source edge (line 0 touches it), each line holding one
 * cell per lane (column for up/down, row for left/right). Each lane is filled
 * independently: number series, "text 1" series, or the cells repeated in a loop.
 * Formulas are copied as-is; because their references are relative they
 * adapt to the destination automatically.
 */
export function fillCells(source: readonly (readonly Cell[])[], direction: FillDirection, count: number): Cell[][] {
  const vertical = direction === 'down' || direction === 'up';
  const forward = direction === 'down' || direction === 'right';
  const lanes = vertical ? (source[0]?.length ?? 0) : source.length;
  const n = vertical ? source.length : (source[0]?.length ?? 0);
  const result: Cell[][] = Array.from({ length: count }, () => new Array<Cell>(lanes));

  for (let lane = 0; lane < lanes; lane++) {
    const cells: Cell[] = [];
    for (let i = 0; i < n; i++) cells.push((vertical ? source[i]?.[lane] : source[lane]?.[i]) as Cell);
    const series = numberSeries(cells) ?? textSeries(cells);
    for (let k = 0; k < count; k++) {
      // Position along the lane relative to the first source cell: after the end going forward, before the start going back.
      const j = forward ? n + k : -1 - k;
      const template = cells[((j % n) + n) % n] as Cell;
      const made = series?.(j, template.styleId) ?? null;
      (result[k] as Cell[])[lane] = made ?? template;
    }
  }
  return result;
}
