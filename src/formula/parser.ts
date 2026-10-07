import type { ErrorCode } from '../core/model/Cell';
import { parseColumnLabel } from '../core/model/address';
import { MAX_COLS, MAX_ROWS } from '../core/model/SheetModel';
import type { Axis, BinaryOp, Expr } from './ast';
import { FormulaSyntaxError, type Token, tokenize } from './tokenizer';

const CELL_RE = /^(\$?)([A-Za-z]{1,3})(\$?)(\d+)$/;
const COL_RE = /^(\$?)([A-Za-z]{1,3})$/;
const COMPARE_OPS = new Set(['=', '<>', '<', '>', '<=', '>=']);

const REF_ERROR: Expr = { t: 'err', v: '#REF!' };

function axis(abs: boolean, index: number, base: number): Axis {
  return { abs, n: abs ? index : index - base };
}

/**
 * Parses a formula typed in A1 notation into a tree whose references are
 * relative to (row, col), the cell that will hold it. Throws FormulaSyntaxError.
 */
export function parseFormula(text: string, row: number, col: number): Expr {
  const src = text.startsWith('=') ? text.slice(1) : text;
  return new Parser(tokenize(src), row, col).parse();
}

/** Like parseFormula, but a syntax error becomes an #ERROR! node that remembers the source. */
export function parseFormulaSafe(text: string, row: number, col: number): Expr {
  try {
    return parseFormula(text, row, col);
  } catch (e) {
    if (e instanceof FormulaSyntaxError) return { t: 'err', v: '#ERROR!', raw: text };
    throw e;
  }
}

class Parser {
  private pos = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly row: number,
    private readonly col: number,
  ) {}

  parse(): Expr {
    if (this.peek().type === 'eof') throw new FormulaSyntaxError('Empty formula', 0);
    const expr = this.comparison();
    const t = this.peek();
    if (t.type !== 'eof') throw new FormulaSyntaxError(`Unexpected '${t.text}'`, t.pos);
    return expr;
  }

  private peek(offset = 0): Token {
    return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)] as Token;
  }

  private next(): Token {
    const t = this.peek();
    this.pos++;
    return t;
  }

  // Precedence, lowest to highest: comparison < & < + - < * / < ^ < unary < %.
  private comparison(): Expr {
    let left = this.concat();
    while (this.peek().type === 'op' && COMPARE_OPS.has(this.peek().text)) {
      const op = this.next().text as BinaryOp;
      left = { t: 'bin', op, l: left, r: this.concat() };
    }
    return left;
  }

  private concat(): Expr {
    let left = this.additive();
    while (this.peek().type === 'op' && this.peek().text === '&') {
      this.next();
      left = { t: 'bin', op: '&', l: left, r: this.additive() };
    }
    return left;
  }

  private additive(): Expr {
    let left = this.multiplicative();
    while (this.peek().type === 'op' && (this.peek().text === '+' || this.peek().text === '-')) {
      const op = this.next().text as BinaryOp;
      left = { t: 'bin', op, l: left, r: this.multiplicative() };
    }
    return left;
  }

  private multiplicative(): Expr {
    let left = this.power();
    while (this.peek().type === 'op' && (this.peek().text === '*' || this.peek().text === '/')) {
      const op = this.next().text as BinaryOp;
      left = { t: 'bin', op, l: left, r: this.power() };
    }
    return left;
  }

  // Left-associative like Excel/Sheets: 2^3^2 = 64. Unary binds tighter than ^, so -2^2 = 4.
  private power(): Expr {
    let left = this.unary();
    while (this.peek().type === 'op' && this.peek().text === '^') {
      this.next();
      left = { t: 'bin', op: '^', l: left, r: this.unary() };
    }
    return left;
  }

  private unary(): Expr {
    const t = this.peek();
    if (t.type === 'op' && (t.text === '-' || t.text === '+')) {
      this.next();
      return { t: 'un', op: t.text, e: this.unary() };
    }
    return this.postfix();
  }

  private postfix(): Expr {
    let e = this.primary();
    while (this.peek().type === 'percent') {
      this.next();
      e = { t: 'un', op: '%', e };
    }
    return e;
  }

  private primary(): Expr {
    const t = this.next();
    switch (t.type) {
      case 'num': {
        // "1:1" is a whole-row reference.
        if (this.peek().type === 'colon' && this.peek(1).type === 'num' && /^\d+$/.test(t.text)) {
          const end = this.peek(1);
          if (/^\d+$/.test(end.text)) {
            this.pos += 2;
            return this.rowRange(Number(t.text), Number(end.text));
          }
        }
        return { t: 'num', v: Number(t.text) };
      }
      case 'str':
        return { t: 'str', v: t.text };
      case 'err':
        return { t: 'err', v: t.text as ErrorCode };
      case 'lparen': {
        const e = this.comparison();
        const close = this.next();
        if (close.type !== 'rparen') throw new FormulaSyntaxError('Missing )', close.pos);
        return e;
      }
      case 'ident':
        return this.identifier(t);
      case 'qname':
        if (this.peek().type !== 'bang') throw new FormulaSyntaxError('Expected ! after the sheet name', t.pos);
        return this.qualified(t.text, t.pos);
      default:
        throw new FormulaSyntaxError(t.type === 'eof' ? 'Unexpected end of formula' : `Unexpected '${t.text}'`, t.pos);
    }
  }

  /** `Sheet!A1`, `Sheet!A1:B2`, `Sheet!A:A`: the sheet name has been read and the next token is the `!`. */
  private qualified(sheet: string, pos: number): Expr {
    this.next(); // !
    const t = this.next();
    if (t.type !== 'ident') throw new FormulaSyntaxError('Expected a cell reference after !', t.pos);
    const e = this.reference(t);
    if (e.t !== 'ref' && e.t !== 'range') throw new FormulaSyntaxError('Expected a cell reference after !', pos);
    return { ...e, sheet };
  }

  private identifier(t: Token): Expr {
    if (this.peek().type === 'bang') return this.qualified(t.text, t.pos);
    if (this.peek().type === 'lparen') return this.call(t);
    return this.reference(t);
  }

  private reference(t: Token): Expr {
    const upper = t.text.toUpperCase();
    if (upper === 'TRUE') return { t: 'bool', v: true };
    if (upper === 'FALSE') return { t: 'bool', v: false };

    const cell = CELL_RE.exec(t.text);
    if (cell !== null) {
      const first = this.cellRef(cell);
      if (this.peek().type === 'colon' && this.peek(1).type === 'ident') {
        const endCell = CELL_RE.exec(this.peek(1).text);
        if (endCell !== null) {
          this.pos += 2;
          return this.range(first, this.cellRef(endCell));
        }
      }
      return first;
    }
    // "A:A" is a whole-column reference.
    const colStart = COL_RE.exec(t.text);
    if (colStart !== null && this.peek().type === 'colon' && this.peek(1).type === 'ident') {
      const colEnd = COL_RE.exec(this.peek(1).text);
      if (colEnd !== null) {
        this.pos += 2;
        return this.colRange(colStart, colEnd);
      }
    }
    // Named ranges are not supported: an unknown name evaluates to #NAME? like Sheets does.
    return { t: 'err', v: '#NAME?' };
  }

  private call(nameToken: Token): Expr {
    this.next(); // (
    const args: Expr[] = [];
    if (this.peek().type === 'rparen') {
      this.next();
      return { t: 'call', name: nameToken.text.toUpperCase(), args };
    }
    for (;;) {
      args.push(this.comparison());
      const t = this.next();
      if (t.type === 'rparen') break;
      if (t.type !== 'comma') throw new FormulaSyntaxError(`Expected , or ) but found '${t.text}'`, t.pos);
    }
    return { t: 'call', name: nameToken.text.toUpperCase(), args };
  }

  private cellRef(m: RegExpExecArray): Extract<Expr, { t: 'ref' }> | typeof REF_ERROR {
    const colIndex = parseColumnLabel(m[2] as string);
    const rowIndex = Number(m[4]) - 1;
    if (colIndex < 0 || colIndex >= MAX_COLS || rowIndex < 0 || rowIndex >= MAX_ROWS) return REF_ERROR;
    return { t: 'ref', col: axis(m[1] === '$', colIndex, this.col), row: axis(m[3] === '$', rowIndex, this.row) };
  }

  private range(a: Expr, b: Expr): Expr {
    if (a.t !== 'ref' || b.t !== 'ref') return REF_ERROR;
    return { t: 'range', r1: a.row, c1: a.col, r2: b.row, c2: b.col };
  }

  private colRange(a: RegExpExecArray, b: RegExpExecArray): Expr {
    const c1 = parseColumnLabel(a[2] as string);
    const c2 = parseColumnLabel(b[2] as string);
    if (c1 >= MAX_COLS || c2 >= MAX_COLS) return REF_ERROR;
    return {
      t: 'range',
      r1: { abs: true, n: 0 },
      c1: axis(a[1] === '$', c1, this.col),
      r2: { abs: true, n: MAX_ROWS - 1 },
      c2: axis(b[1] === '$', c2, this.col),
    };
  }

  private rowRange(a: number, b: number): Expr {
    if (a < 1 || b < 1 || a > MAX_ROWS || b > MAX_ROWS) return REF_ERROR;
    return {
      t: 'range',
      r1: axis(false, a - 1, this.row),
      c1: { abs: true, n: 0 },
      r2: axis(false, b - 1, this.row),
      c2: { abs: true, n: MAX_COLS - 1 },
    };
  }
}

