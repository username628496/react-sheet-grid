import { type Cell, type CellValue, type ErrorCode } from '../core/model/Cell';
import { parseColumnLabel } from '../core/model/address';
import { type Condition, type ConditionalRule, MAX_CONDITIONAL_RULES } from '../core/model/conditional';
import { clampFontSize } from '../core/model/font';
import { type Border, type BorderSide, BORDER_SIDES } from '../core/model/borders';
import { type MergeRegion, regionsOverlap } from '../core/model/MergeTable';
import { MAX_COLS, MAX_ROWS } from '../core/model/SheetModel';
import { DEFAULT_STYLE_ID, type Style, type VerticalAlign } from '../core/model/StyleTable';
import { type Comparison, parseListItems, type Validation } from '../core/model/validation';
import { isDateFormat, parseDateInput } from '../core/model/dates';
import { sheetNameProblem, Workbook } from '../core/Workbook';
import { Spreadsheet } from '../core/Spreadsheet';
import type { Expr } from '../formula/ast';
import { FUNCTIONS } from '../formula/functions';
import { parseFormulaSafe } from '../formula/parser';
import { fromExcelFormat } from './numFmt';
import { fromArgb, OPERATOR_FROM_EXCEL, PT_PER_PX, PX_PER_CHAR } from './shared';
import { decodeEscapes, parseXml, XmlError, type XmlHandler } from './xml';
import { fromUtf8, readZip, ZipError } from './zip';

export class XlsxError extends Error {
  constructor(message: string) {
    super(`Cannot read this .xlsx file: ${message}`);
    this.name = 'XlsxError';
  }
}

export interface ImportResult {
  workbook: Workbook;
  /** What could not be carried over, in plain English. */
  warnings: string[];
}

const MAX_PART_BYTES = 300_000_000;
/** A rule over more cells than this only reaches the cells that already exist (a whole-column rule would otherwise create millions). */
const MAX_RULE_AREA = 50_000;
const MAX_SPAN = 2_000;
const ERROR_CODES: ReadonlySet<string> = new Set<ErrorCode>(['#DIV/0!', '#VALUE!', '#REF!', '#N/A', '#NAME?', '#NUM!', '#ERROR!']);

interface XfInfo {
  numFmtId: number;
  fontId: number;
  fillId: number;
  borderId: number;
  horizontal?: string;
  vertical?: string;
  wrap: boolean;
}

interface FontInfo {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  size: number | null;
  color: string | null;
}

interface StyleSheet {
  numFmts: Map<number, string>;
  fonts: FontInfo[];
  fills: Array<string | null>;
  borders: Array<Partial<Record<BorderSide, Border>>>;
  xfs: XfInfo[];
  dxfs: Array<{ color?: string; background?: string }>;
}

const num = (text: string | undefined): number | null => {
  if (text === undefined || text.trim() === '') return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
};

/** `A1` → [row, col] (0-based), or null. */
function parseRef(ref: string): [number, number] | null {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(ref);
  if (m === null) return null;
  const col = parseColumnLabel((m[1] as string).toUpperCase());
  const row = Number(m[2]) - 1;
  return col >= 0 && col < MAX_COLS && row >= 0 && row < MAX_ROWS ? [row, col] : null;
}

/** `A1:B5` or `A1`, as an inclusive rectangle. */
function parseRange(text: string): { r1: number; c1: number; r2: number; c2: number } | null {
  const [a, b] = text.split(':');
  const first = parseRef(a ?? '');
  const last = b === undefined ? first : parseRef(b);
  if (first === null || last === null) return null;
  return { r1: Math.min(first[0], last[0]), c1: Math.min(first[1], last[1]), r2: Math.max(first[0], last[0]), c2: Math.max(first[1], last[1]) };
}

function parseStyles(xml: string): StyleSheet {
  const out: StyleSheet = { numFmts: new Map(), fonts: [], fills: [], borders: [], xfs: [], dxfs: [] };
  let section = '';
  let font: FontInfo | null = null;
  let fill: string | null | undefined;
  let border: Partial<Record<BorderSide, Border>> | null = null;
  let side: BorderSide | null = null;
  let sideStyle = '';
  let xf: XfInfo | null = null;
  let dxf: { color?: string; background?: string } | null = null;
  let inCellXfs = false;
  let inDxfFont = false;
  let patternSolid = false;
  const handler: XmlHandler = {
    open(name, a) {
      switch (name) {
        case 'numFmt': {
          const id = num(a.numFmtId);
          if (id !== null && a.formatCode !== undefined) out.numFmts.set(id, a.formatCode);
          break;
        }
        case 'fonts':
        case 'fills':
        case 'borders':
        case 'cellXfs':
        case 'dxfs':
          section = name;
          inCellXfs = name === 'cellXfs';
          break;
        case 'cellStyleXfs':
        case 'cellStyles':
          section = name;
          break;
        case 'font':
          if (section === 'fonts') font = { bold: false, italic: false, underline: false, strike: false, size: null, color: null };
          else if (section === 'dxfs') inDxfFont = true;
          break;
        case 'b':
          if (font !== null) font.bold = a.val !== '0' && a.val !== 'false';
          break;
        case 'i':
          if (font !== null) font.italic = a.val !== '0' && a.val !== 'false';
          break;
        case 'strike':
          if (font !== null) font.strike = a.val !== '0' && a.val !== 'false';
          break;
        case 'u':
          if (font !== null) font.underline = a.val !== 'none';
          break;
        case 'sz':
          if (font !== null) font.size = num(a.val);
          break;
        case 'color':
          if (font !== null) font.color = fromArgb(a.rgb);
          else if (dxf !== null && inDxfFont) dxf.color = fromArgb(a.rgb) ?? undefined;
          else if (border !== null && side !== null && sideStyle !== '') {
            const spec = borderSpec(sideStyle, fromArgb(a.rgb) ?? '#000000');
            if (spec !== null) border[side] = spec;
            sideStyle = '';
          }
          break;
        case 'fill':
          if (section === 'fills') fill = null;
          break;
        case 'patternFill':
          patternSolid = a.patternType === 'solid';
          break;
        case 'fgColor':
          if (section === 'fills' && fill !== undefined && patternSolid) fill = fromArgb(a.rgb);
          else if (section === 'dxfs' && dxf !== null && patternSolid && dxf.background === undefined) dxf.background = fromArgb(a.rgb) ?? undefined;
          break;
        case 'bgColor':
          // In a differential format the solid color is the background color.
          if (section === 'dxfs' && dxf !== null) dxf.background = fromArgb(a.rgb) ?? dxf.background;
          break;
        case 'border':
          if (section === 'borders') border = {};
          break;
        case 'left':
        case 'right':
        case 'top':
        case 'bottom':
          if (border !== null) {
            side = name;
            sideStyle = a.style ?? '';
            // A style with no color child still draws, in black.
            if (sideStyle !== '' && a.style !== undefined) {
              const spec = borderSpec(sideStyle, '#000000');
              if (spec !== null) border[side] = spec;
            }
          }
          break;
        case 'xf':
          if (inCellXfs)
            xf = { numFmtId: num(a.numFmtId) ?? 0, fontId: num(a.fontId) ?? 0, fillId: num(a.fillId) ?? 0, borderId: num(a.borderId) ?? 0, wrap: false };
          break;
        case 'alignment':
          if (xf !== null) {
            xf.horizontal = a.horizontal;
            xf.vertical = a.vertical;
            xf.wrap = a.wrapText === '1' || a.wrapText === 'true';
          }
          break;
        case 'dxf':
          dxf = {};
          inDxfFont = false;
          break;
      }
      if (name === 'fill' && section === 'dxfs') patternSolid = false;
    },
    close(name) {
      if (name === 'font') {
        if (font !== null) out.fonts.push(font);
        font = null;
        inDxfFont = false;
      } else if (name === 'fill' && section === 'fills') {
        out.fills.push(fill ?? null);
        fill = undefined;
      } else if (name === 'border' && border !== null) {
        out.borders.push(border);
        border = null;
        side = null;
      } else if (name === 'xf' && xf !== null) {
        out.xfs.push(xf);
        xf = null;
      } else if (name === 'dxf' && dxf !== null) {
        out.dxfs.push(dxf);
        dxf = null;
      } else if (name === 'fonts' || name === 'fills' || name === 'borders' || name === 'cellXfs' || name === 'dxfs' || name === 'cellStyleXfs' || name === 'cellStyles') {
        section = '';
        inCellXfs = false;
      }
    },
  };
  parseXml(xml, handler);
  return out;
}

function borderSpec(style: string, color: string): Border | null {
  switch (style) {
    case 'thin':
    case 'hair':
      return { width: 1, style: 'solid', color };
    case 'medium':
      return { width: 2, style: 'solid', color };
    case 'thick':
    case 'double':
      return { width: 3, style: 'solid', color };
    case 'dashed':
    case 'dashDot':
    case 'dashDotDot':
      return { width: 1, style: 'dashed', color };
    case 'mediumDashed':
    case 'mediumDashDot':
    case 'mediumDashDotDot':
    case 'slantDashDot':
      return { width: 2, style: 'dashed', color };
    case 'dotted':
      return { width: 1, style: 'dotted', color };
    default:
      return null;
  }
}

function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  let inSi = false;
  let skipDepth = 0;
  let inT = false;
  let current = '';
  parseXml(xml, {
    open(name) {
      if (name === 'si') {
        inSi = true;
        current = '';
      } else if (name === 'rPh') skipDepth++; // phonetic guides (furigana) are not part of the text
      else if (name === 't' && inSi && skipDepth === 0) inT = true;
    },
    text(text) {
      if (inT) current += text;
    },
    close(name) {
      if (name === 't') inT = false;
      else if (name === 'rPh') skipDepth--;
      else if (name === 'si') {
        out.push(decodeEscapes(current));
        inSi = false;
      }
    },
  });
  return out;
}

interface RawCell {
  row: number;
  col: number;
  style: number;
  value: CellValue | null;
  formula: Expr | null;
}

/** A validation as read from the file; a list that takes its items from cells is resolved once every sheet is loaded. */
type ParsedRule = Validation | { readonly kind: 'listRange'; readonly range: string; readonly strict: boolean };

interface ParsedSheet {
  cells: RawCell[];
  merges: string[];
  colSizes: Array<{ min: number; max: number; width: number; hidden: boolean }>;
  rowSizes: Map<number, { height: number | null; hidden: boolean }>;
  defaultRowPt: number | null;
  frozenRows: number;
  frozenCols: number;
  validations: Array<{ sqref: string; rule: ParsedRule | null; raw: string }>;
  conditionals: Array<{ sqref: string; priority: number; rules: Array<{ priority: number; xml: ConditionalXml }> }>;
  formulasKept: number;
  formulasDropped: number;
}

interface ConditionalXml {
  type: string;
  operator?: string;
  text?: string;
  dxfId: number | null;
  formulas: string[];
}

const unquote = (text: string): string | null => {
  const m = /^"((?:[^"]|"")*)"$/.exec(text.trim());
  return m === null ? null : (m[1] as string).replace(/""/g, '"');
};

function usable(expr: Expr): boolean {
  switch (expr.t) {
    case 'err':
      return expr.raw === undefined;
    case 'call':
      return FUNCTIONS[expr.name] !== undefined && expr.args.every(usable);
    case 'un':
      return usable(expr.e);
    case 'bin':
      return usable(expr.l) && usable(expr.r);
    default:
      return true;
  }
}

function parseSheet(xml: string, strings: readonly string[], date1904: boolean, isDate: (xf: number) => boolean, warnings: string[]): ParsedSheet {
  const sheet: ParsedSheet = {
    cells: [],
    merges: [],
    colSizes: [],
    rowSizes: new Map(),
    defaultRowPt: null,
    frozenRows: 0,
    frozenCols: 0,
    validations: [],
    conditionals: [],
    formulasKept: 0,
    formulasDropped: 0,
  };
  const shared = new Map<string, Expr | null>();
  let row = -1;
  let col = -1;
  let cell: { r: number; c: number; s: number; t: string; v: string; inline: string; f: { t: string; si: string; text: string } | null } | null = null;
  let capture: 'v' | 'inline' | 'f' | 'f1' | 'f2' | 'cf' | null = null;
  let inIs = false;
  let dv: { sqref: string; type: string; operator: string; errorStyle: string; f1: string; f2: string } | null = null;
  let cf: { sqref: string; rules: Array<{ priority: number; xml: ConditionalXml }> } | null = null;
  let rule: ConditionalXml | null = null;
  let rulePriority = 0;
  let ruleFormula = '';
  let mergeCapped = 0;

  const finishCell = (): void => {
    if (cell === null) return;
    const c = cell;
    cell = null;
    if (c.r >= MAX_ROWS || c.c >= MAX_COLS || c.r < 0 || c.c < 0) {
      mergeCapped++;
      return;
    }
    let value: CellValue | null;
    switch (c.t) {
      case 's': {
        const at = num(c.v);
        value = at === null ? null : (strings[at] ?? null);
        break;
      }
      case 'inlineStr':
        value = decodeEscapes(c.inline);
        break;
      case 'str':
        value = c.v === '' ? null : decodeEscapes(c.v);
        break;
      case 'b':
        value = c.v === '1' || c.v === 'true';
        break;
      case 'e':
        value = { error: (ERROR_CODES.has(c.v) ? c.v : '#ERROR!') as ErrorCode };
        break;
      case 'd': {
        const d = parseDateInput(c.v.replace('T', ' ').slice(0, 19));
        value = d === null ? c.v : d.serial;
        break;
      }
      default: {
        const n = num(c.v);
        value = n === null ? null : n;
        if (n !== null && date1904 && isDate(c.s)) value = n + 1462;
      }
    }
    let formula: Expr | null = null;
    if (c.f !== null) {
      const key = c.f.si;
      let expr: Expr | null;
      if (c.f.t === 'shared' && c.f.text === '') expr = shared.get(key) ?? null;
      else {
        const text = c.f.text.replace(/_xlfn\.|_xlws\./g, '');
        const parsed = parseFormulaSafe(`=${text}`, c.r, c.c);
        expr = usable(parsed) ? parsed : null;
        if (c.f.t === 'shared') shared.set(key, expr);
      }
      if (expr !== null) {
        formula = expr;
        sheet.formulasKept++;
      } else sheet.formulasDropped++;
    }
    if (value === null && formula === null && c.s === 0) return;
    sheet.cells.push({ row: c.r, col: c.c, style: c.s, value: formula === null ? value : null, formula });
  };

  parseXml(xml, {
    open(name, a) {
      switch (name) {
        case 'sheetFormatPr':
          sheet.defaultRowPt = num(a.defaultRowHeight);
          break;
        case 'col': {
          const min = num(a.min);
          const max = num(a.max);
          const width = num(a.width);
          if (min !== null && max !== null && width !== null) sheet.colSizes.push({ min: min - 1, max: max - 1, width, hidden: a.hidden === '1' || a.hidden === 'true' });
          break;
        }
        case 'row': {
          const r = num(a.r);
          row = r === null ? row + 1 : r - 1;
          col = -1;
          const ht = num(a.ht);
          const hidden = a.hidden === '1' || a.hidden === 'true';
          if (hidden || ht !== null) sheet.rowSizes.set(row, { height: ht, hidden });
          break;
        }
        case 'c': {
          const at = a.r === undefined ? null : parseRef(a.r);
          if (at !== null) {
            row = at[0];
            col = at[1];
          } else col++;
          cell = { r: row, c: col, s: num(a.s) ?? 0, t: a.t ?? 'n', v: '', inline: '', f: null };
          break;
        }
        case 'v':
          if (cell !== null) capture = 'v';
          break;
        case 'is':
          inIs = true;
          break;
        case 't':
          if (cell !== null && inIs) capture = 'inline';
          break;
        case 'f':
          if (cell !== null) {
            cell.f = { t: a.t ?? 'normal', si: a.si ?? '', text: '' };
            capture = 'f';
          } else if (dv !== null) capture = null;
          break;
        case 'mergeCell':
          if (a.ref !== undefined) sheet.merges.push(a.ref);
          break;
        case 'pane':
          if (a.state === 'frozen') {
            sheet.frozenCols = Math.max(0, Math.trunc(num(a.xSplit) ?? 0));
            sheet.frozenRows = Math.max(0, Math.trunc(num(a.ySplit) ?? 0));
          }
          break;
        case 'dataValidation':
          dv = { sqref: a.sqref ?? '', type: a.type ?? 'none', operator: a.operator ?? 'between', errorStyle: a.errorStyle ?? 'stop', f1: '', f2: '' };
          break;
        case 'formula1':
          if (dv !== null) capture = 'f1';
          break;
        case 'formula2':
          if (dv !== null) capture = 'f2';
          break;
        case 'conditionalFormatting':
          cf = { sqref: a.sqref ?? '', rules: [] };
          break;
        case 'cfRule':
          if (cf !== null) {
            rule = { type: a.type ?? '', operator: a.operator, text: a.text, dxfId: num(a.dxfId), formulas: [] };
            rulePriority = num(a.priority) ?? 1_000_000;
          }
          break;
        case 'formula':
          if (rule !== null) {
            capture = 'cf';
            ruleFormula = '';
          }
          break;
      }
    },
    text(text) {
      if (capture === 'v' && cell !== null) cell.v += text;
      else if (capture === 'inline' && cell !== null) cell.inline += text;
      else if (capture === 'f' && cell?.f != null) cell.f.text += text;
      else if (capture === 'f1' && dv !== null) dv.f1 += text;
      else if (capture === 'f2' && dv !== null) dv.f2 += text;
      else if (capture === 'cf') ruleFormula += text;
    },
    close(name) {
      switch (name) {
        case 'v':
        case 'f':
        case 'formula1':
        case 'formula2':
          capture = null;
          break;
        case 't':
          if (capture === 'inline') capture = null;
          break;
        case 'is':
          inIs = false;
          break;
        case 'c':
          finishCell();
          break;
        case 'formula':
          if (rule !== null) rule.formulas.push(ruleFormula);
          capture = null;
          break;
        case 'cfRule':
          if (cf !== null && rule !== null) cf.rules.push({ priority: rulePriority, xml: rule });
          rule = null;
          break;
        case 'conditionalFormatting':
          if (cf !== null) sheet.conditionals.push({ sqref: cf.sqref, priority: cf.rules[0]?.priority ?? 0, rules: cf.rules });
          cf = null;
          break;
        case 'dataValidation':
          if (dv !== null) sheet.validations.push({ sqref: dv.sqref, rule: dataValidation(dv), raw: dv.type });
          dv = null;
          break;
      }
    },
  });
  if (mergeCapped > 0) warnings.push(`${mergeCapped} cell(s) beyond the grid size limit were left out.`);
  return sheet;
}

function dataValidation(dv: { type: string; operator: string; errorStyle: string; f1: string; f2: string }): ParsedSheet['validations'][number]['rule'] {
  const strict = dv.errorStyle === 'stop';
  if (dv.type === 'list') {
    const literal = unquote(dv.f1);
    if (literal !== null) return { kind: 'list', items: parseListItems(literal), strict };
    return { kind: 'listRange', range: dv.f1.trim(), strict };
  }
  const kind = dv.type === 'date' ? 'date' : dv.type === 'decimal' || dv.type === 'whole' ? 'number' : null;
  if (kind === null) return null;
  const op = OPERATOR_FROM_EXCEL[dv.operator];
  const a = num(dv.f1);
  if (op === undefined || a === null) return null;
  if (op === 'between' || op === 'notBetween') {
    const b = num(dv.f2);
    return b === null ? null : { kind, op, a, b, strict };
  }
  return { kind, op, a, strict };
}

/** Rectangles of an sqref list ("A1:B2 D4"). */
function sqrefRects(sqref: string): Array<{ r1: number; c1: number; r2: number; c2: number }> {
  return sqref
    .split(/\s+/)
    .map(parseRange)
    .filter((r): r is NonNullable<typeof r> => r !== null);
}

/** Visits every cell of an sqref that exists or lies in a small area (see MAX_RULE_AREA). */
function forEachRuleCell(sheet: Spreadsheet, sqref: string, visit: (row: number, col: number) => void): void {
  for (const r of sqrefRects(sqref)) {
    const area = (r.r2 - r.r1 + 1) * (r.c2 - r.c1 + 1);
    if (area <= MAX_RULE_AREA) {
      for (let row = r.r1; row <= r.r2; row++) for (let col = r.c1; col <= r.c2; col++) visit(row, col);
    } else {
      sheet.model.forEachCell((row, col) => {
        if (row >= r.r1 && row <= r.r2 && col >= r.c1 && col <= r.c2) visit(row, col);
      });
    }
  }
}

function conditionOf(rule: ConditionalXml): Condition | null {
  const f = rule.formulas;
  const lit = (i: number): number | null => num(f[i]);
  switch (rule.type) {
    case 'cellIs': {
      const op = OPERATOR_FROM_EXCEL[rule.operator ?? ''];
      if (op === undefined) return null;
      const text = f[0] === undefined ? null : unquote(f[0]);
      if (text !== null && op === 'eq') return { kind: 'text', op: 'eq', text };
      const a = lit(0);
      if (a === null) return null;
      if (op === 'between' || op === 'notBetween') {
        const b = lit(1);
        return b === null ? null : { kind: 'number', op: op as Comparison, a, b };
      }
      return { kind: 'number', op: op as Comparison, a };
    }
    case 'containsText':
      return rule.text === undefined ? null : { kind: 'text', op: 'contains', text: rule.text };
    case 'notContainsText':
      return rule.text === undefined ? null : { kind: 'text', op: 'notContains', text: rule.text };
    case 'beginsWith':
      return rule.text === undefined ? null : { kind: 'text', op: 'startsWith', text: rule.text };
    case 'endsWith':
      return rule.text === undefined ? null : { kind: 'text', op: 'endsWith', text: rule.text };
    case 'expression':
      return expressionCondition(f[0] ?? '');
    case 'containsBlanks':
      return { kind: 'blank' };
    case 'notContainsBlanks':
      return { kind: 'notBlank' };
    default:
      return null;
  }
}

/**
 * Rules written as plain formulas ("Use a formula" in Excel; what openpyxl and many tools write for text rules) in
 * the shapes this grid has a rule for. Anything else stays unsupported.
 */
function expressionCondition(formula: string): Condition | null {
  const f = formula.trim().replace(/^=/, '');
  const ref = '\\$?[A-Za-z]{1,3}\\$?\\d+';
  const str = '"((?:[^"]|"")*)"';
  const un = (t: string | undefined): string => (t ?? '').replace(/""/g, '"');
  let m = new RegExp(`^NOT\\(ISERROR\\(SEARCH\\(${str},${ref}\\)\\)\\)$`, 'i').exec(f);
  if (m !== null) return { kind: 'text', op: 'contains', text: un(m[1]) };
  m = new RegExp(`^ISERROR\\(SEARCH\\(${str},${ref}\\)\\)$`, 'i').exec(f);
  if (m !== null) return { kind: 'text', op: 'notContains', text: un(m[1]) };
  m = new RegExp(`^LEFT\\(${ref},LEN\\(${str}\\)\\)=${str}$`, 'i').exec(f);
  if (m !== null && m[1] === m[2]) return { kind: 'text', op: 'startsWith', text: un(m[1]) };
  m = new RegExp(`^RIGHT\\(${ref},LEN\\(${str}\\)\\)=${str}$`, 'i').exec(f);
  if (m !== null && m[1] === m[2]) return { kind: 'text', op: 'endsWith', text: un(m[1]) };
  if (new RegExp(`^(?:LEN\\(TRIM\\(${ref}\\)\\)=0|ISBLANK\\(${ref}\\))$`, 'i').test(f)) return { kind: 'blank' };
  if (new RegExp(`^(?:LEN\\(TRIM\\(${ref}\\)\\)>0|NOT\\(ISBLANK\\(${ref}\\)\\))$`, 'i').test(f)) return { kind: 'notBlank' };
  return null;
}

function sheetUniqueName(workbookNames: Set<string>, wanted: string, index: number): string {
  let name = [...wanted.replace(/[[\]:*?/\\]/g, '_').replace(/^'+|'+$/g, '').trim()].slice(0, 50).join('');
  if (sheetNameProblem(name) !== null) name = `Sheet${index + 1}`;
  let candidate = name;
  for (let n = 2; workbookNames.has(candidate.toLowerCase()); n++) candidate = `${[...name].slice(0, 45).join('')} (${n})`;
  workbookNames.add(candidate.toLowerCase());
  return candidate;
}

/** Reads an .xlsx file into a workbook. Throws XlsxError / ZipError for files that are not readable xlsx files. */
export async function importXlsx(input: Uint8Array | ArrayBuffer): Promise<ImportResult> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let files: Map<string, Uint8Array>;
  try {
    files = await readZip(bytes);
  } catch (e) {
    if (e instanceof ZipError) throw new XlsxError(e.message.replace('Invalid ZIP file: ', 'the file is damaged or not an .xlsx file ('));
    throw e;
  }
  const text = (path: string): string | null => {
    const data = files.get(path);
    if (data === undefined) return null;
    if (data.length > MAX_PART_BYTES) throw new XlsxError(`"${path}" is too large`);
    return fromUtf8(data);
  };
  const warnings: string[] = [];
  try {
    const rootRels = text('_rels/.rels');
    let workbookPath = 'xl/workbook.xml';
    if (rootRels !== null) {
      parseXml(rootRels, {
        open(name, a) {
          if (name === 'Relationship' && (a.Type ?? '').endsWith('/officeDocument') && a.Target !== undefined) workbookPath = a.Target.replace(/^\//, '');
        },
        close() {},
      });
    }
    const workbookXml = text(workbookPath);
    if (workbookXml === null) throw new XlsxError('it has no workbook part (is this an .xlsx file?)');
    const base = workbookPath.includes('/') ? workbookPath.slice(0, workbookPath.lastIndexOf('/') + 1) : '';
    const resolve = (target: string): string => (target.startsWith('/') ? target.slice(1) : `${base}${target}`.replace(/[^/]+\/\.\.\//g, ''));

    const sheetsDef: Array<{ name: string; rid: string; state: string }> = [];
    let date1904 = false;
    let activeTab = 0;
    parseXml(workbookXml, {
      open(name, a) {
        if (name === 'sheet') sheetsDef.push({ name: a.name ?? '', rid: a['r:id'] ?? '', state: a.state ?? 'visible' });
        else if (name === 'workbookPr') date1904 = a.date1904 === '1' || a.date1904 === 'true';
        else if (name === 'workbookView') activeTab = Math.max(0, Math.trunc(num(a.activeTab) ?? 0));
      },
      close() {},
    });
    if (sheetsDef.length === 0) throw new XlsxError('the workbook has no sheets');

    const targets = new Map<string, string>();
    let stringsPath = `${base}sharedStrings.xml`;
    let stylesPath = `${base}styles.xml`;
    const rels = text(`${base}_rels/${workbookPath.slice(base.length)}.rels`);
    if (rels !== null) {
      parseXml(rels, {
        open(name, a) {
          if (name !== 'Relationship' || a.Id === undefined || a.Target === undefined) return;
          targets.set(a.Id, resolve(a.Target));
          if ((a.Type ?? '').endsWith('/sharedStrings')) stringsPath = resolve(a.Target);
          else if ((a.Type ?? '').endsWith('/styles')) stylesPath = resolve(a.Target);
        },
        close() {},
      });
    }
    const sharedXml = text(stringsPath);
    const strings = sharedXml === null ? [] : parseSharedStrings(sharedXml);
    const stylesXml = text(stylesPath);
    const book: StyleSheet = stylesXml === null ? { numFmts: new Map(), fonts: [], fills: [], borders: [], xfs: [], dxfs: [] } : parseStyles(stylesXml);
    const defaultFontSize = book.fonts[0]?.size ?? null;

    const formatOf = (xf: number): string | undefined => {
      const info = book.xfs[xf];
      if (info === undefined) return undefined;
      return fromExcelFormat(info.numFmtId, book.numFmts.get(info.numFmtId));
    };
    const dateXf = new Map<number, boolean>();
    const isDate = (xf: number): boolean => {
      let known = dateXf.get(xf);
      if (known === undefined) {
        known = isDateFormat(formatOf(xf));
        dateXf.set(xf, known);
      }
      return known;
    };

    /** An Excel cell format as this grid's style. */
    const styleOf = (xf: number): Style => {
      const info = book.xfs[xf];
      if (info === undefined) return {};
      const out: { -readonly [K in keyof Style]: Style[K] } = {};
      const font = book.fonts[info.fontId];
      const background = book.fills[info.fillId] ?? null;
      if (font !== undefined) {
        if (font.bold) out.bold = true;
        if (font.italic) out.italic = true;
        if (font.underline) out.underline = true;
        if (font.strike) out.strike = true;
        if (font.size !== null && defaultFontSize !== null && Math.abs(font.size - defaultFontSize) > 0.01) out.fontSize = clampFontSize(Math.round(font.size / PT_PER_PX));
        // Plain black is Excel's default text color; keeping it would make text unreadable on a dark theme.
        if (font.color !== null && !(font.color === '#000000' && background === null)) out.color = font.color;
      }
      if (background !== null) out.background = background;
      const border = book.borders[info.borderId];
      if (border !== undefined && Object.keys(border).length > 0) {
        const borders: { -readonly [K in BorderSide]?: Border } = {};
        for (const side of BORDER_SIDES) if (border[side] !== undefined) borders[side] = border[side];
        out.borders = borders;
      }
      if (info.horizontal === 'left' || info.horizontal === 'center' || info.horizontal === 'right') out.align = info.horizontal;
      if (info.vertical === 'top' || info.vertical === 'bottom') out.valign = info.vertical as VerticalAlign;
      else if (info.vertical === 'center') out.valign = 'middle';
      if (info.wrap) out.wrap = 'wrap';
      const numberFormat = formatOf(xf);
      if (numberFormat !== undefined) out.numberFormat = numberFormat;
      return out;
    };

    const parsed: Array<{ def: (typeof sheetsDef)[number]; data: ParsedSheet }> = [];
    for (const def of sheetsDef) {
      const path = targets.get(def.rid);
      const xml = path === undefined ? null : text(path);
      if (xml === null) {
        warnings.push(`The sheet "${def.name}" is missing from the file and was left out.`);
        continue;
      }
      if (def.state !== 'visible') warnings.push(`The sheet "${def.name}" was hidden in the file; it is shown here.`);
      parsed.push({ def, data: parseSheet(xml, strings, date1904, isDate, warnings) });
    }
    if (parsed.length === 0) throw new XlsxError('none of its sheets could be read');

    const names = new Set<string>();
    const sheets: Spreadsheet[] = parsed.map(({ def, data }, index) => {
      let maxRow = 0;
      let maxCol = 0;
      for (const c of data.cells) {
        maxRow = Math.max(maxRow, c.row);
        maxCol = Math.max(maxCol, c.col);
      }
      const sheet = new Spreadsheet({ rowCount: Math.min(MAX_ROWS, Math.max(50, maxRow + 1)), colCount: Math.min(MAX_COLS, Math.max(26, maxCol + 1)) });
      sheet.name = sheetUniqueName(names, def.name, index);
      const styleIds = new Map<number, number>();
      const styleFor = (xf: number): number => {
        if (xf === 0) return DEFAULT_STYLE_ID;
        let id = styleIds.get(xf);
        if (id === undefined) {
          id = sheet.styles.intern(styleOf(xf));
          styleIds.set(xf, id);
        }
        return id;
      };
      for (const c of data.cells) {
        const cell: Cell = c.formula === null ? { value: c.value, styleId: styleFor(c.style) } : { value: null, styleId: styleFor(c.style), formula: c.formula };
        sheet.model.setCell(c.row, c.col, cell);
      }
      if (data.formulasDropped > 0) warnings.push(`"${sheet.name}": ${data.formulasDropped} formula(s) use functions or syntax this grid does not support; ${data.formulasDropped === 1 ? 'its' : 'their'} saved value${data.formulasDropped === 1 ? ' is' : 's are'} kept instead.`);

      // Sizes. Rows Excel auto-sized to their default height are left alone.
      const defaultRowPx = (data.defaultRowPt ?? 15) / PT_PER_PX;
      for (const [r, info] of data.rowSizes) {
        if (r >= sheet.rowCount) continue;
        if (info.hidden) sheet.rows.setSize(r, 0);
        else if (info.height !== null && Math.abs(info.height / PT_PER_PX - defaultRowPx) > 1) sheet.rows.setSize(r, Math.max(1, Math.round(info.height / PT_PER_PX)));
      }
      for (const c of data.colSizes) {
        if (c.max - c.min > MAX_SPAN) continue; // a "whole sheet" default, not a size for each column
        for (let i = c.min; i <= Math.min(c.max, sheet.colCount - 1); i++) sheet.cols.setSize(i, c.hidden ? 0 : Math.max(1, Math.round(c.width * PX_PER_CHAR)));
      }
      sheet.setFrozen(Math.min(data.frozenRows, sheet.rowCount - 1), Math.min(data.frozenCols, sheet.colCount - 1));

      const regions: MergeRegion[] = [];
      for (const ref of data.merges) {
        const r = parseRange(ref);
        if (r === null || r.r2 >= sheet.rowCount || r.c2 >= sheet.colCount) continue;
        const region = { row: r.r1, col: r.c1, rowSpan: r.r2 - r.r1 + 1, colSpan: r.c2 - r.c1 + 1 };
        if (region.rowSpan * region.colSpan < 2 || regions.some((other) => regionsOverlap(other, region))) continue;
        regions.push(region);
      }
      sheet.merges.set(regions);
      return sheet;
    });

    const workbook = new Workbook(sheets[0]);
    for (const sheet of sheets.slice(1)) workbook.addSheet({ sheet, name: sheet.name });
    workbook.setActive(Math.min(Math.max(0, activeTab), sheets.length - 1));

    // Rules last: a list can take its items from cells, which are all in place now.
    const rangeValues = (ref: string, home: Spreadsheet): string[] | null => {
      const m = /^(?:(?:'((?:[^']|'')+)'|([^'!]+))!)?(\$?[A-Za-z]+\$?\d+(?::\$?[A-Za-z]+\$?\d+)?)$/.exec(ref.replace(/^=/, ''));
      if (m === null) return null;
      const target = m[1] === undefined && m[2] === undefined ? home : workbook.sheetByName((m[1] ?? m[2] ?? '').replace(/''/g, "'"));
      const r = parseRange(m[3] as string);
      if (target === undefined || r === null || (r.r2 - r.r1 + 1) * (r.c2 - r.c1 + 1) > 5_000) return null;
      const items: string[] = [];
      for (let row = r.r1; row <= r.r2; row++) for (let col = r.c1; col <= r.c2; col++) items.push(target.getDisplayText(row, col));
      return items.filter((t) => t !== '');
    };
    parsed.forEach(({ data }, index) => {
      const sheet = sheets[index] as Spreadsheet;
      const attach = (sqref: string, patch: (style: Style) => Partial<Style>): void => {
        forEachRuleCell(sheet, sqref, (row, col) => {
          const cell = sheet.model.getCell(row, col);
          sheet.model.setCell(row, col, { ...cell, styleId: sheet.styles.derive(cell.styleId, patch(sheet.styles.get(cell.styleId))) });
        });
      };
      for (const v of data.validations) {
        if (v.rule === null) {
          warnings.push(`"${sheet.name}": a data validation of type "${v.raw}" is not supported and was left out.`);
          continue;
        }
        let final: Validation;
        if (v.rule.kind === 'listRange') {
          const items = rangeValues(v.rule.range, sheet);
          if (items === null || items.length === 0) {
            warnings.push(`"${sheet.name}": a validation list that reads its items from cells could not be resolved and was left out.`);
            continue;
          }
          final = { kind: 'list', items: items.slice(0, 500), strict: v.rule.strict };
        } else final = v.rule;
        attach(v.sqref, () => ({ validation: final }));
      }
      const unsupported = new Set<string>();
      for (const group of data.conditionals) {
        const rules: ConditionalRule[] = [];
        for (const { xml } of [...group.rules].sort((a, b) => a.priority - b.priority)) {
          const when = conditionOf(xml);
          const dxf = xml.dxfId === null ? undefined : book.dxfs[xml.dxfId];
          if (when === null) unsupported.add(xml.type);
          else if (dxf !== undefined && (dxf.color !== undefined || dxf.background !== undefined)) {
            rules.push({ when, ...(dxf.color === undefined ? {} : { color: dxf.color }), ...(dxf.background === undefined ? {} : { background: dxf.background }) });
          }
        }
        if (rules.length === 0) continue;
        attach(group.sqref, (style) => ({ conditional: [...(style.conditional ?? []), ...rules].slice(0, MAX_CONDITIONAL_RULES) }));
      }
      if (unsupported.size > 0) warnings.push(`"${sheet.name}": conditional formatting of type ${[...unsupported].map((t) => `"${t}"`).join(', ')} is not supported and was left out.`);
    });

    workbook.recalculateAll();
    return { workbook, warnings };
  } catch (e) {
    if (e instanceof XmlError) throw new XlsxError(`a part of the file is not valid XML (${e.message.replace('Invalid XML: ', '')})`);
    throw e;
  }
}

