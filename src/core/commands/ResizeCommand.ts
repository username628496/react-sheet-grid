import type { Spreadsheet } from '../Spreadsheet';
import type { Command } from './Command';

/** Resizes one row or column (or several at once, e.g. a multi-column selection). */
export class ResizeCommand implements Command {
  readonly label: string;
  private before: number[] = [];

  constructor(
    private readonly axis: 'row' | 'col',
    private readonly indices: readonly number[],
    private readonly size: number,
  ) {
    this.label = axis === 'row' ? 'Resize rows' : 'Resize columns';
  }

  apply(sheet: Spreadsheet): void {
    const layout = this.axis === 'row' ? sheet.rows : sheet.cols;
    this.before = this.indices.map((i) => layout.getSize(i));
    for (const i of this.indices) layout.setSize(i, this.size);
  }

  invert(sheet: Spreadsheet): void {
    const layout = this.axis === 'row' ? sheet.rows : sheet.cols;
    this.indices.forEach((index, k) => layout.setSize(index, this.before[k] as number));
  }
}
