import type { AxisSnapshot } from '../layout/AxisLayout';
import type { Spreadsheet } from '../Spreadsheet';
import type { ViewState } from '../viewState';
import type { Command } from './Command';

/**
 * Sort and filter. Neither moves data: they replace the view mapping (and with
 * it the number of visible rows). `invert` restores the previous mapping
 * object, row sizes and state verbatim instead of recomputing them.
 */
export class ViewStateCommand implements Command {
  private before: { state: ViewState; order: Int32Array | null; rows: AxisSnapshot } | null = null;
  private computed: { order: Int32Array | null } | null = null;

  constructor(
    readonly label: string,
    private readonly next: ViewState,
  ) {}

  apply(sheet: Spreadsheet): void {
    this.before = { state: sheet.viewState, order: sheet.mapping.getOrder(), rows: sheet.rows.snapshot() };
    // Computed once: a redo happens against identical data, so the same order is valid again.
    this.computed ??= { order: sheet.computeViewOrder(this.next) };
    sheet.setView(this.next, this.computed.order);
  }

  invert(sheet: Spreadsheet): void {
    const before = this.before;
    if (before === null) return;
    sheet.mapping.setOrder(before.order);
    sheet.rows.restore(before.rows);
    sheet.restoreViewState(before.state);
  }
}
