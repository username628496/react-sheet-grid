import { err } from './functions/helpers';
import { cellKey, keyCol, keyRow, type SheetModel } from '../core/model/SheetModel';
import { collectPrecedents, DependencyGraph } from './dependency';
import { Evaluator } from './evaluator';

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

  constructor(private readonly model: SheetModel) {
    this.evaluator = new Evaluator(model);
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
        this.graph.set(key, collectPrecedents(cell.formula, row, col));
        this.formulaKeys.add(key);
      } else if (this.formulaKeys.delete(key)) {
        this.graph.remove(key);
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
    for (let i = 0; i < ready.length; i++) {
      const key = ready[i] as number;
      processed++;
      this.evaluateCell(key);
      for (const to of successors.get(key) ?? []) {
        const left = (indegree.get(to) as number) - 1;
        indegree.set(to, left);
        if (left === 0) ready.push(to);
      }
    }

    if (processed < visited.size) {
      for (const key of visited) {
        if ((indegree.get(key) ?? 0) > 0 && this.formulaKeys.has(key)) {
          this.model.setComputedValue(keyRow(key), keyCol(key), err('#REF!'));
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
