import { type Cell, isCellError } from '../core/model/Cell';
import { columnLabel } from '../core/model/address';
import { type Condition, type ConditionalRule } from '../core/model/conditional';
import { DEFAULT_FONT_SIZE } from '../core/model/font';
import type { Border, Borders } from '../core/model/borders';
import { endColOf, endRowOf } from '../core/model/MergeTable';
import type { Style } from '../core/model/StyleTable';
import type { Validation } from '../core/model/validation';
import type { Spreadsheet } from '../core/Spreadsheet';
import { printFormula } from '../formula/print';
import { utf8, writeZip } from './zip';
import { toExcelFormat } from './numFmt';
import { OPERATOR_TO_EXCEL, PT_PER_PX, PX_PER_CHAR, toArgb, XLFN_FUNCTIONS } from './shared';
import { escapeXml } from './xml';

export interface ExportResult {
  /** The .xlsx file. */
  data: Uint8Array;
  /** Things that could not be carried over faithfully, in plain English. */
  warnings: string[];
}

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

const BUILTIN_IDS: Readonly<Record<string, number>> = { '0': 1, '0.00': 2, '#,##0': 3, '#,##0.00': 4, '0%': 9, '0.00%': 10 };

const px2pt = (px: number): number => Math.round(px * PT_PER_PX * 100) / 100;

const BORDER_STYLES: Readonly<Record<string, string>> = {
  '1 solid': 'thin',
  '2 solid': 'medium',
  '3 solid': 'thick',
  '1 dashed': 'dashed',
  '2 dashed': 'mediumDashed',
  '3 dashed': 'mediumDashed',
  '1 dotted': 'dotted',
  '2 dotted': 'dotted',
  '3 dotted': 'dotted',
};

function borderXml(side: string, b: Border | undefined): string {
  if (b === undefined) return `<${side}/>`;
  const color = toArgb(b.color) ?? 'FF000000';
  return `<${side} style="${BORDER_STYLES[`${b.width} ${b.style}`] ?? 'thin'}"><color rgb="${color}"/></${side}>`;
}

/** The workbook's styles.xml, built as sheets ask for the cell formats they use. */
class StyleBook {
  private readonly fonts: string[] = [`<font><sz val="${px2pt(DEFAULT_FONT_SIZE)}"/><name val="Arial"/></font>`];
  private readonly fills: string[] = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
  private readonly borders: string[] = ['<border><left/><right/><top/><bottom/><diagonal/></border>'];
  private readonly numFmts = new Map<string, number>();
  private readonly xfs: string[] = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
  private readonly xfByKey = new Map<string, number>();
  private readonly dxfs: string[] = [];
  private readonly dxfByKey = new Map<string, number>();

  private pooled(list: string[], xml: string): number {
    const at = list.indexOf(xml);
    if (at >= 0) return at;
    list.push(xml);
    return list.length - 1;
  }

  xf(style: Style): number {
    const parts: string[] = [];
    if (style.bold === true) parts.push('<b/>');
    if (style.italic === true) parts.push('<i/>');
    if (style.strike === true) parts.push('<strike/>');
    if (style.underline === true) parts.push('<u/>');
    const size = style.fontSize ?? DEFAULT_FONT_SIZE;
    parts.push(`<sz val="${px2pt(size)}"/>`);
    const color = style.color === undefined ? null : toArgb(style.color);
    if (color !== null) parts.push(`<color rgb="${color}"/>`);
    parts.push('<name val="Arial"/>');
    const fontId = this.pooled(this.fonts, `<font>${parts.join('')}</font>`);

    const bg = style.background === undefined ? null : toArgb(style.background);
    const fillId = bg === null ? 0 : this.pooled(this.fills, `<fill><patternFill patternType="solid"><fgColor rgb="${bg}"/><bgColor indexed="64"/></patternFill></fill>`);

    const b: Borders | undefined = style.borders;
    const borderId =
      b === undefined
        ? 0
        : this.pooled(this.borders, `<border>${borderXml('left', b.left)}${borderXml('right', b.right)}${borderXml('top', b.top)}${borderXml('bottom', b.bottom)}<diagonal/></border>`);

    const code = toExcelFormat(style.numberFormat);
    let numFmtId = 0;
    if (code !== null) {
      numFmtId = BUILTIN_IDS[style.numberFormat as string] ?? 0;
      if (numFmtId === 0) {
        let id = this.numFmts.get(code);
        if (id === undefined) {
          id = 164 + this.numFmts.size;
          this.numFmts.set(code, id);
        }
        numFmtId = id;
      }
    }

    const align: string[] = [];
    if (style.align !== undefined) align.push(`horizontal="${style.align}"`);
    if (style.valign !== undefined) align.push(`vertical="${style.valign === 'middle' ? 'center' : style.valign}"`);
    if (style.wrap === 'wrap') align.push('wrapText="1"');
    const alignment = align.length > 0 ? `<alignment ${align.join(' ')}/>` : '';
    const xf =
      `<xf numFmtId="${numFmtId}" fontId="${fontId}" fillId="${fillId}" borderId="${borderId}" xfId="0"` +
      `${numFmtId > 0 ? ' applyNumberFormat="1"' : ''}${fontId > 0 ? ' applyFont="1"' : ''}${fillId > 0 ? ' applyFill="1"' : ''}${borderId > 0 ? ' applyBorder="1"' : ''}` +
      (alignment === '' ? '/>' : ` applyAlignment="1">${alignment}</xf>`);
    const at = this.xfByKey.get(xf);
    if (at !== undefined) return at;
    this.xfs.push(xf);
    this.xfByKey.set(xf, this.xfs.length - 1);
    return this.xfs.length - 1;
  }

  /** A differential format (what a conditional formatting rule applies). */
  dxf(rule: ConditionalRule): number {
    const font = rule.color === undefined || toArgb(rule.color) === null ? '' : `<font><color rgb="${toArgb(rule.color)}"/></font>`;
    const bg = rule.background === undefined ? null : toArgb(rule.background);
    const fill = bg === null ? '' : `<fill><patternFill patternType="solid"><fgColor rgb="${bg}"/><bgColor rgb="${bg}"/></patternFill></fill>`;
    const xml = `<dxf>${font}${fill}</dxf>`;
    const at = this.dxfByKey.get(xml);
    if (at !== undefined) return at;
    this.dxfs.push(xml);
    this.dxfByKey.set(xml, this.dxfs.length - 1);
    return this.dxfs.length - 1;
  }

  toXml(): string {
    const numFmts =
      this.numFmts.size === 0
        ? ''
        : `<numFmts count="${this.numFmts.size}">${[...this.numFmts].map(([code, id]) => `<numFmt numFmtId="${id}" formatCode="${escapeXml(code)}"/>`).join('')}</numFmts>`;
    return (
      `${XML}<styleSheet xmlns="${NS}">${numFmts}` +
      `<fonts count="${this.fonts.length}">${this.fonts.join('')}</fonts>` +
      `<fills count="${this.fills.length}">${this.fills.join('')}</fills>` +
      `<borders count="${this.borders.length}">${this.borders.join('')}</borders>` +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      `<cellXfs count="${this.xfs.length}">${this.xfs.join('')}</cellXfs>` +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
      `<dxfs count="${this.dxfs.length}">${this.dxfs.join('')}</dxfs></styleSheet>`
    );
  }
}

class SharedStrings {
  private readonly index = new Map<string, number>();
  private readonly items: string[] = [];
  total = 0;

  add(text: string): number {
    this.total++;
    let at = this.index.get(text);
    if (at === undefined) {
      at = this.items.length;
      this.index.set(text, at);
      const preserve = text !== text.trim() || /[\n\t]/.test(text);
      this.items.push(`<si><t${preserve ? ' xml:space="preserve"' : ''}>${escapeXml(text)}</t></si>`);
    }
    return at;
  }

  toXml(): string {
    return `${XML}<sst xmlns="${NS}" count="${this.total}" uniqueCount="${this.items.length}">${this.items.join('')}</sst>`;
  }
}

/** Cells (row, col) as the smallest list of rectangles that covers them exactly: runs along rows, joined when stacked. */
function toRanges(cells: ReadonlyArray<readonly [number, number]>): string[] {
  const sorted = [...cells].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const runs: Array<{ row: number; c1: number; c2: number }> = [];
  for (const [row, col] of sorted) {
    const last = runs[runs.length - 1];
    if (last !== undefined && last.row === row && last.c2 === col - 1) last.c2 = col;
    else if (last === undefined || last.row !== row || last.c2 < col) runs.push({ row, c1: col, c2: col });
  }
  const rects: Array<{ r1: number; r2: number; c1: number; c2: number }> = [];
  const open = new Map<string, { r1: number; r2: number; c1: number; c2: number }>();
  for (const run of runs) {
    const key = `${run.c1}:${run.c2}`;
    const above = open.get(key);
    if (above !== undefined && above.r2 === run.row - 1) above.r2 = run.row;
    else {
      const rect = { r1: run.row, r2: run.row, c1: run.c1, c2: run.c2 };
      rects.push(rect);
      open.set(key, rect);
    }
  }
  const ref = (r: number, c: number): string => `${columnLabel(c)}${r + 1}`;
  return rects.map((r) => (r.r1 === r.r2 && r.c1 === r.c2 ? ref(r.r1, r.c1) : `${ref(r.r1, r.c1)}:${ref(r.r2, r.c2)}`));
}

function validationXml(rule: Validation, sqref: string): string | null {
  const strictAttrs = rule.strict ? ' showErrorMessage="1"' : ' errorStyle="warning" showErrorMessage="1"';
  if (rule.kind === 'list') {
    const joined = rule.items.join(',');
    if (rule.items.some((i) => i.includes(',') || i.includes('"')) || joined.length > 255) return null;
    return `<dataValidation type="list" allowBlank="1"${strictAttrs} sqref="${sqref}"><formula1>${escapeXml(`"${joined}"`)}</formula1></dataValidation>`;
  }
  const second = rule.b === undefined ? '' : `<formula2>${rule.b}</formula2>`;
  return `<dataValidation type="${rule.kind === 'date' ? 'date' : 'decimal'}" operator="${OPERATOR_TO_EXCEL[rule.op]}" allowBlank="1"${strictAttrs} sqref="${sqref}"><formula1>${rule.a}</formula1>${second}</dataValidation>`;
}

function cfRuleXml(when: Condition, dxfId: number, priority: number, anchor: string): string {
  const base = `dxfId="${dxfId}" priority="${priority}" stopIfTrue="1"`;
  const q = (t: string): string => `"${t.replace(/"/g, '""')}"`;
  switch (when.kind) {
    case 'number':
    case 'date': {
      const second = when.b === undefined ? '' : `<formula>${when.b}</formula>`;
      return `<cfRule type="cellIs" ${base} operator="${OPERATOR_TO_EXCEL[when.op]}"><formula>${when.a}</formula>${second}</cfRule>`;
    }
    case 'blank':
      return `<cfRule type="containsBlanks" ${base}><formula>LEN(TRIM(${anchor}))=0</formula></cfRule>`;
    case 'notBlank':
      return `<cfRule type="notContainsBlanks" ${base}><formula>LEN(TRIM(${anchor}))&gt;0</formula></cfRule>`;
    case 'text': {
      const t = escapeXml(q(when.text));
      switch (when.op) {
        case 'contains':
          return `<cfRule type="containsText" ${base} operator="containsText" text="${escapeXml(when.text)}"><formula>NOT(ISERROR(SEARCH(${t},${anchor})))</formula></cfRule>`;
        case 'notContains':
          return `<cfRule type="notContainsText" ${base} operator="notContains" text="${escapeXml(when.text)}"><formula>ISERROR(SEARCH(${t},${anchor}))</formula></cfRule>`;
        case 'startsWith':
          return `<cfRule type="beginsWith" ${base} operator="beginsWith" text="${escapeXml(when.text)}"><formula>LEFT(${anchor},LEN(${t}))=${t}</formula></cfRule>`;
        case 'endsWith':
          return `<cfRule type="endsWith" ${base} operator="endsWith" text="${escapeXml(when.text)}"><formula>RIGHT(${anchor},LEN(${t}))=${t}</formula></cfRule>`;
        case 'eq':
          return `<cfRule type="cellIs" ${base} operator="equal"><formula>${t}</formula></cfRule>`;
      }
    }
  }
}

function sheetXml(sheet: Spreadsheet, active: boolean, styles: StyleBook, strings: SharedStrings, warnings: string[]): string {
  const { mapping } = sheet;
  const identity = mapping.isIdentity;
  // Positions in the file are what the user sees. A sorted or filtered view reorders rows, which would break
  // formulas' relative references, so such a sheet is written with values instead of formulas.
  const placed: Array<{ row: number; col: number; cell: Cell; dataRow: number; dataCol: number }> = [];
  sheet.model.forEachCell((dataRow, dataCol, cell) => {
    const row = identity ? dataRow : mapping.toViewRow(dataRow);
    const col = identity ? dataCol : mapping.toViewCol(dataCol);
    if (row >= 0 && col >= 0) placed.push({ row, col, cell, dataRow, dataCol });
  });
  placed.sort((a, b) => a.row - b.row || a.col - b.col);
  if (!identity && placed.some((p) => p.cell.formula !== undefined)) warnings.push(`"${sheet.name}" is sorted or filtered, so its formulas were saved as their current values.`);

  const rowSizes = new Map<number, number>();
  const rowLayout = sheet.rows.snapshot();
  rowLayout.index.forEach((at, k) => rowSizes.set(at, rowLayout.size[k] as number));
  const colLayout = sheet.cols.snapshot();

  const validations = new Map<string, { rule: Validation; cells: Array<[number, number]> }>();
  const conditionals = new Map<string, { rules: readonly ConditionalRule[]; cells: Array<[number, number]> }>();

  const cellsByRow = new Map<number, string[]>();
  let maxRow = 0;
  let maxCol = 0;

  for (const p of placed) {
    maxRow = Math.max(maxRow, p.row);
    maxCol = Math.max(maxCol, p.col);
    const style = sheet.styles.get(p.cell.styleId);
    const s = p.cell.styleId === 0 ? 0 : styles.xf(style);
    const ref = `${columnLabel(p.col)}${p.row + 1}`;
    const styleAttr = s === 0 ? '' : ` s="${s}"`;

    if (style.validation !== undefined) {
      const key = JSON.stringify(style.validation);
      const entry = validations.get(key) ?? { rule: style.validation, cells: [] };
      entry.cells.push([p.row, p.col]);
      validations.set(key, entry);
    }
    if (style.conditional !== undefined) {
      const key = JSON.stringify(style.conditional);
      const entry = conditionals.get(key) ?? { rules: style.conditional, cells: [] };
      entry.cells.push([p.row, p.col]);
      conditionals.set(key, entry);
    }

    const value = p.cell.value;
    let formula = '';
    if (p.cell.formula !== undefined && identity && !(p.cell.formula.t === 'err' && p.cell.formula.raw !== undefined)) {
      const text = printFormula(p.cell.formula, p.dataRow, p.dataCol).slice(1);
      formula = `<f>${escapeXml(text.replace(/\b([A-Z][A-Z0-9.]*)\(/g, (m, name: string) => (XLFN_FUNCTIONS.has(name) ? `_xlfn.${name}(` : m)))}</f>`;
    }
    let xml: string;
    if (value === null) xml = formula === '' ? `<c r="${ref}"${styleAttr}/>` : `<c r="${ref}"${styleAttr}>${formula}</c>`;
    else if (typeof value === 'number') xml = `<c r="${ref}"${styleAttr}>${formula}<v>${value}</v></c>`;
    else if (typeof value === 'boolean') xml = `<c r="${ref}"${styleAttr} t="b">${formula}<v>${value ? 1 : 0}</v></c>`;
    else if (isCellError(value)) xml = `<c r="${ref}"${styleAttr} t="e">${formula}<v>${value.error}</v></c>`;
    else if (formula !== '') xml = `<c r="${ref}"${styleAttr} t="str">${formula}<v>${escapeXml(value)}</v></c>`;
    else xml = `<c r="${ref}"${styleAttr} t="s"><v>${strings.add(value)}</v></c>`;
    const line = cellsByRow.get(p.row);
    if (line === undefined) cellsByRow.set(p.row, [xml]);
    else line.push(xml);
  }

  // A row is written when it has cells or its own height (or is hidden).
  const rowsXml: string[] = [];
  for (const at of [...new Set([...cellsByRow.keys(), ...rowSizes.keys()])].sort((x, y) => x - y)) {
    const size = rowSizes.get(at);
    const attrs = size === undefined ? '' : size === 0 ? ' hidden="1"' : ` ht="${px2pt(size)}" customHeight="1"`;
    rowsXml.push(`<row r="${at + 1}"${attrs}>${(cellsByRow.get(at) ?? []).join('')}</row>`);
  }
  let unsupportedRules = 0;

  // <cols>: consecutive columns with the same override become one element.
  const colsXml: string[] = [];
  const colSizes = colLayout.index.map((at, k): [number, number] => [at, colLayout.size[k] as number]).sort((a, b) => a[0] - b[0]);
  for (let k = 0; k < colSizes.length; ) {
    const [at, size] = colSizes[k] as [number, number];
    let end = k;
    while (end + 1 < colSizes.length && (colSizes[end + 1] as [number, number])[0] === (colSizes[end] as [number, number])[0] + 1 && (colSizes[end + 1] as [number, number])[1] === size) end++;
    const last = (colSizes[end] as [number, number])[0];
    const width = Math.round(((size === 0 ? sheet.cols.defaultSize : size) / PX_PER_CHAR) * 100) / 100;
    colsXml.push(`<col min="${at + 1}" max="${last + 1}" width="${width}" customWidth="1"${size === 0 ? ' hidden="1"' : ''}/>`);
    k = end + 1;
  }

  const pane =
    sheet.frozenRows > 0 || sheet.frozenCols > 0
      ? `<pane${sheet.frozenCols > 0 ? ` xSplit="${sheet.frozenCols}"` : ''}${sheet.frozenRows > 0 ? ` ySplit="${sheet.frozenRows}"` : ''} topLeftCell="${columnLabel(sheet.frozenCols)}${sheet.frozenRows + 1}" activePane="${sheet.frozenRows > 0 && sheet.frozenCols > 0 ? 'bottomRight' : sheet.frozenRows > 0 ? 'bottomLeft' : 'topRight'}" state="frozen"/>`
      : '';
  const merges = sheet.merges.all.map((m) => `<mergeCell ref="${columnLabel(m.col)}${m.row + 1}:${columnLabel(endColOf(m))}${endRowOf(m) + 1}"/>`);

  // One element per rectangle: a formula-based rule is relative to the top-left cell of its own range.
  const cfXml: string[] = [];
  let priority = 1;
  for (const { rules, cells } of conditionals.values()) {
    for (const range of toRanges(cells)) {
      const anchor = range.split(':')[0] as string;
      const ruleXml = rules.map((rule) => cfRuleXml(rule.when, styles.dxf(rule), priority++, anchor));
      cfXml.push(`<conditionalFormatting sqref="${range}">${ruleXml.join('')}</conditionalFormatting>`);
    }
  }
  const dvXml: string[] = [];
  for (const { rule, cells } of validations.values()) {
    const xml = validationXml(rule, toRanges(cells).join(' '));
    if (xml === null) unsupportedRules++;
    else dvXml.push(xml);
  }
  if (unsupportedRules > 0) warnings.push(`"${sheet.name}": ${unsupportedRules} validation list(s) with commas or quotes in an item, or longer than 255 characters, could not be saved.`);

  return (
    `${XML}<worksheet xmlns="${NS}" xmlns:r="${NS_R}">` +
    `<dimension ref="A1:${columnLabel(maxCol)}${maxRow + 1}"/>` +
    `<sheetViews><sheetView workbookViewId="0"${active ? ' tabSelected="1"' : ''}>${pane}</sheetView></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="${px2pt(sheet.rows.defaultSize)}" customHeight="1" defaultColWidth="${Math.round((sheet.cols.defaultSize / PX_PER_CHAR) * 100) / 100}"/>` +
    (colsXml.length > 0 ? `<cols>${colsXml.join('')}</cols>` : '') +
    `<sheetData>${rowsXml.join('')}</sheetData>` +
    (merges.length > 0 ? `<mergeCells count="${merges.length}">${merges.join('')}</mergeCells>` : '') +
    cfXml.join('') +
    (dvXml.length > 0 ? `<dataValidations count="${dvXml.length}">${dvXml.join('')}</dataValidations>` : '') +
    '</worksheet>'
  );
}

/** What `exportXlsx` needs from a workbook: a `Workbook`, or just `{ sheets: [sheet], activeIndex: 0 }` for a lone sheet. */
export interface WorkbookLike {
  readonly sheets: readonly Spreadsheet[];
  readonly activeIndex: number;
}

/** Writes the whole workbook as an .xlsx file (Excel, Google Sheets, LibreOffice and Numbers open it). */
export async function exportXlsx(workbook: WorkbookLike): Promise<ExportResult> {
  const warnings: string[] = [];
  const styles = new StyleBook();
  const strings = new SharedStrings();
  const sheets = workbook.sheets.map((sheet, i) => sheetXml(sheet, i === workbook.activeIndex, styles, strings, warnings));
  const n = sheets.length;

  const files = [
    {
      name: '[Content_Types].xml',
      data: utf8(
        `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
          sheets.map((_s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
          '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
          '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>',
      ),
    },
    {
      name: '_rels/.rels',
      data: utf8(`${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${NS_R}/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    },
    {
      name: 'xl/workbook.xml',
      data: utf8(
        `${XML}<workbook xmlns="${NS}" xmlns:r="${NS_R}"><workbookPr date1904="0"/><bookViews><workbookView activeTab="${workbook.activeIndex}"/></bookViews><sheets>` +
          workbook.sheets.map((s, i) => `<sheet name="${escapeXml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
          '</sheets></workbook>',
      ),
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: utf8(
        `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
          sheets.map((_s, i) => `<Relationship Id="rId${i + 1}" Type="${NS_R}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
          `<Relationship Id="rId${n + 1}" Type="${NS_R}/styles" Target="styles.xml"/><Relationship Id="rId${n + 2}" Type="${NS_R}/sharedStrings" Target="sharedStrings.xml"/></Relationships>`,
      ),
    },
    { name: 'xl/styles.xml', data: utf8(styles.toXml()) },
    { name: 'xl/sharedStrings.xml', data: utf8(strings.toXml()) },
    ...sheets.map((xml, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: utf8(xml) })),
  ];
  return { data: await writeZip(files), warnings };
}
