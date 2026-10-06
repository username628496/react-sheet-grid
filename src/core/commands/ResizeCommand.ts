import type { Spreadsheet } from '../Spreadsheet';
import type { Command } from './Command';

/** Resizes one row or column, or several at once (the same size for all, or one size each, e.g. auto-fit). */
export class ResizeCommand implements Command {
  readonly label: string;
  private before: number[] = [];

  constructor(
    private readonly axis: 'row' | 'col',
    private readonly indices: readonly number[],
    private readonly size: number | readonly number[],
  ) {
    this.label = axis === 'row' ? 'Resize rows' : 'Resize columns';
  }

  apply(sheet: Spreadsheet): void {
    const layout = this.axis === 'row' ? sheet.rows : sheet.cols;
    this.before = this.indices.map((i) => layout.getSize(i));
    this.indices.forEach((index, k) => layout.setSize(index, typeof this.size === 'number' ? this.size : (this.size[k] as number)));
  }

  invert(sheet: Spreadsheet): void {
    const layout = this.axis === 'row' ? sheet.rows : sheet.cols;
    this.indices.forEach((index, k) => layout.setSize(index, this.before[k] as number));
  }
}
