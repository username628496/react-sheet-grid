/**
 * Maps view coordinates (what the user sees) to data coordinates (where the
 * cell lives in SheetModel). Sort and filter only change this mapping; the
 * stored data never moves. Columns are identity for now.
 */
export class ViewMapping {
  readonly colCount: number;
  private order: Int32Array | null = null; // viewRow -> dataRow
  private inverse: Int32Array | null = null; // dataRow -> viewRow, -1 when hidden
  private readonly totalRows: number;

  constructor(rowCount: number, colCount: number) {
    this.totalRows = rowCount;
    this.colCount = colCount;
  }

  /** Number of rows in the underlying data. */
  get dataRowCount(): number {
    return this.totalRows;
  }

  /** Number of rows currently visible (after filtering). */
  get viewRowCount(): number {
    return this.order === null ? this.totalRows : this.order.length;
  }

  get isIdentity(): boolean {
    return this.order === null;
  }

  toDataRow(viewRow: number): number {
    return this.order === null ? viewRow : (this.order[viewRow] ?? -1);
  }

  toDataCol(viewCol: number): number {
    return viewCol;
  }

  /** Returns -1 when the data row is filtered out. */
  toViewRow(dataRow: number): number {
    if (this.order === null) return dataRow;
    if (this.inverse === null) {
      const inverse = new Int32Array(this.totalRows).fill(-1);
      for (let v = 0; v < this.order.length; v++) inverse[this.order[v] as number] = v;
      this.inverse = inverse;
    }
    return this.inverse[dataRow] ?? -1;
  }

  toViewCol(dataCol: number): number {
    return dataCol;
  }

  getOrder(): Int32Array | null {
    return this.order;
  }

  /** `null` restores the identity mapping. */
  setOrder(order: Int32Array | null): void {
    this.order = order;
    this.inverse = null;
  }
}
