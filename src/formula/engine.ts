import { err } from './functions/helpers';
import { cellKey, keyCol, keyRow, type SheetModel } from '../core/model/SheetModel';
import { collectPrecedents, DependencyGraph } from './dependency';
import { Evaluator, type SheetEnvironment } from './evaluator';

/**
 * Keeps formula results in sync with the model. After a change it finds every
 * formula that (transitively) depends on the changed cells and re-evaluates
 * them in topological order (Kahn). Whatever is left unprocessed sits on, or
 * downstream of, a cycle and gets #REF! as Google Sheets does.
 */
export class FormulaEngine {
  private readonly graph = new DependencyGraph();
  private readonly formulaKeys = new Set<number>();
  private readonly evaluator: Evaluator;

  /** Formula cells that read other sheets, with the (lower-cased) names of the sheets they read. */
  private readonly externals = new Map<number, readonly string[]>();

  constructor(
    private readonly model: SheetModel,
    private readonly env: SheetEnvironment | null = null,
  ) {
    this.evaluator = new Evaluator(model, env);
  }

  /** Number of formulas that read another sheet. */
  get externalCount(): number {
    return this.externals.size;
  }

  /** Whether any formula reads the (lower-cased) sheet name. */
  readsSheet(lowerName: string): boolean {
    for (const names of this.externals.values()) if (names.includes(lowerName)) return true;
    return false;
  }

  /** Keys of the formulas that read the (lower-cased) sheet name. */
  keysReading(lowerName: string): number[] {
    const keys: number[] = [];
    for (const [key, names] of this.externals) if (names.includes(lowerName)) keys.push(key);
    return keys;
  }

  /** Recomputes every formula that reads any other sheet. */
  recalcAllReaders(): void {
    if (this.externals.size > 0) this.recalc([...this.externals.keys()]);
  }

  /** Recomputes the formulas that read `sheetName` (and whatever depends on them here). Returns whether any did. */
  recalcReaders(sheetName: string): boolean {
    const lower = sheetName.toLowerCase();
    const keys: number[] = [];
    for (const [key, names] of this.externals) if (names.includes(lower)) keys.push(key);
    if (keys.length === 0) return false;
    this.recalc(keys);
    return true;
  }

  get hasFormulas(): boolean {
    return this.formulaKeys.size > 0;
  }

  get formulaCount(): number {
    return this.formulaKeys.size;
  }

  /** Re-registers every formula in the model and recomputes all of them. Use after bulk loads and row/column edits. */
  rebuildAll(): void {
    this.graph.clear();
    this.formulaKeys.clear();
    this.externals.clear();
    const keys: number[] = [];
    this.model.forEachCell((row, col, cell) => {
      if (cell.formula !== undefined) keys.push(cellKey(row, col));
    });
    this.recalc(keys);
  }

  recalc(dirty: Iterable<number>): void {
    const seeds: number[] = [];
    for (const key of dirty) {
      seeds.push(key);
      const row = keyRow(key);
      const col = keyCol(key);
      const cell = this.model.getCell(row, col);
      if (cell.formula !== undefined) {
        const own = this.env?.ownName();
        const precedents = collectPrecedents(cell.formula, row, col, (s) => s === undefined || (own !== undefined && s.toLowerCase() === own.toLowerCase()));
        this.graph.set(key, precedents);
        this.formulaKeys.add(key);
        if (precedents.sheets.length > 0) this.externals.set(key, precedents.sheets);
        else this.externals.delete(key);
      } else if (this.formulaKeys.delete(key)) {
        this.graph.remove(key);
        this.externals.delete(key);
      }
    }
    if (this.formulaKeys.size === 0) return;

    // Breadth-first over dependents, recording precedence edges for the ordering step.
    const visited = new Set<number>(seeds);
    const successors = new Map<number, number[]>();
    const indegree = new Map<number, number>();
    const queue = [...seeds];
    for (let i = 0; i < queue.length; i++) {
      const from = queue[i] as number;
      for (const to of this.graph.dependentsOf(from)) {
        let list = successors.get(from);
        if (list === undefined) {
          list = [];
          successors.set(from, list);
        }
        list.push(to);
        indegree.set(to, (indegree.get(to) ?? 0) + 1);
        if (!visited.has(to)) {
          visited.add(to);
          queue.push(to);
        }
      }
    }

    const ready: number[] = [];
    for (const key of visited) if ((indegree.get(key) ?? 0) === 0) ready.push(key);
    let processed = 0;
    const release = (key: number): void => {
      for (const to of successors.get(key) ?? []) {
        const left = (indegree.get(to) as number) - 1;
        indegree.set(to, left);
        if (left === 0) ready.push(to);
      }
    };
    let next = 0;
    for (;;) {
      while (next < ready.length) {
        const key = ready[next++] as number;
        processed++;
        this.evaluateCell(key);
        release(key);
      }
      if (processed >= visited.size) break;

      // Out of ready cells but some remain: they are on a cycle or depend on one. Only cells ON a
      // cycle are circular (#REF!, like Sheets); cells merely reading them are evaluated normally,
      // so SUM propagates the error while COUNTIF just ignores it.
      const stuck = new Set<number>();
      for (const key of visited) if ((indegree.get(key) ?? 0) > 0) stuck.add(key);
      const cyclic = cyclicNodes(stuck, successors);
      if (cyclic.size === 0) {
        // Cannot happen for a consistent graph; fail loudly in the sheet rather than loop forever.
        for (const key of stuck) this.model.setComputedValue(keyRow(key), keyCol(key), err('#REF!'));
        break;
      }
      for (const c of cyclic) {
        processed++;
        indegree.set(c, 0);
        if (this.formulaKeys.has(c)) this.model.setComputedValue(keyRow(c), keyCol(c), err('#REF!'));
      }
      for (const c of cyclic) {
        for (const to of successors.get(c) ?? []) {
          if (cyclic.has(to)) continue;
          const left = (indegree.get(to) as number) - 1;
          indegree.set(to, left);
          if (left === 0) ready.push(to);
        }
      }
    }
  }

  private evaluateCell(key: number): void {
    if (!this.formulaKeys.has(key)) return;
    const row = keyRow(key);
    const col = keyCol(key);
    const formula = this.model.getCell(row, col).formula;
    if (formula === undefined) return;
    this.model.setComputedValue(row, col, this.evaluator.evaluate(formula, row, col));
  }
}

/**
 * Nodes of `nodes` that lie on a cycle (strongly connected components of size > 1, or a self loop),
 * using an iterative Tarjan so a 100k-long chain cannot overflow the call stack.
 */
function cyclicNodes(nodes: ReadonlySet<number>, successors: ReadonlyMap<number, readonly number[]>): Set<number> {
  const index = new Map<number, number>();
  const low = new Map<number, number>();
  const onStack = new Set<number>();
  const stack: number[] = [];
  const result = new Set<number>();
  let counter = 0;

  for (const root of nodes) {
    if (index.has(root)) continue;
    const work: Array<{ node: number; next: number }> = [{ node: root, next: 0 }];
    index.set(root, counter);
    low.set(root, counter++);
    stack.push(root);
    onStack.add(root);
    while (work.length > 0) {
      const frame = work[work.length - 1] as { node: number; next: number };
      const edges = successors.get(frame.node) ?? [];
      if (frame.next < edges.length) {
        const to = edges[frame.next++] as number;
        if (!nodes.has(to)) continue;
        if (to === frame.node) result.add(to); // self reference
        if (!index.has(to)) {
          index.set(to, counter);
          low.set(to, counter++);
          stack.push(to);
          onStack.add(to);
          work.push({ node: to, next: 0 });
        } else if (onStack.has(to)) {
          low.set(frame.node, Math.min(low.get(frame.node) as number, index.get(to) as number));
        }
        continue;
      }
      work.pop();
      const parent = work[work.length - 1];
      if (parent !== undefined) {
        low.set(parent.node, Math.min(low.get(parent.node) as number, low.get(frame.node) as number));
      }
      if (low.get(frame.node) === index.get(frame.node)) {
        const component: number[] = [];
        let member: number;
        do {
          member = stack.pop() as number;
          onStack.delete(member);
          component.push(member);
        } while (member !== frame.node);
        if (component.length > 1) for (const m of component) result.add(m);
      }
    }
  }
  return result;
}
