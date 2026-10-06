export type TokenType = 'num' | 'str' | 'ident' | 'op' | 'lparen' | 'rparen' | 'comma' | 'colon' | 'percent' | 'err' | 'eof';

export interface Token {
  readonly type: TokenType;
  readonly text: string;
  readonly pos: number;
}

export class FormulaSyntaxError extends Error {
  constructor(
    message: string,
    readonly pos: number,
  ) {
    super(message);
    this.name = 'FormulaSyntaxError';
  }
}

const NUMBER_RE = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;
const ERROR_RE = /^#(?:DIV\/0!|VALUE!|REF!|N\/A|NAME\?|NUM!|ERROR!)/i;
const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$.]*/;

/** Splits formula source (without the leading '=') into tokens. */
export function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i] as string;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    const rest = src.slice(i);
    if (ch === '"') {
      let text = '';
      let j = i + 1;
      let closed = false;
      while (j < src.length) {
        if (src[j] === '"') {
          if (src[j + 1] === '"') {
            text += '"';
            j += 2;
            continue;
          }
          closed = true;
          j++;
          break;
        }
        text += src[j];
        j++;
      }
      if (!closed) throw new FormulaSyntaxError('Unterminated string', i);
      tokens.push({ type: 'str', text, pos: i });
      i = j;
      continue;
    }
    const num = NUMBER_RE.exec(rest);
    if (num !== null) {
      tokens.push({ type: 'num', text: num[0], pos: i });
      i += num[0].length;
      continue;
    }
    if (ch === '#') {
      const err = ERROR_RE.exec(rest);
      if (err === null) throw new FormulaSyntaxError('Unknown error literal', i);
      tokens.push({ type: 'err', text: err[0].toUpperCase(), pos: i });
      i += err[0].length;
      continue;
    }
    const ident = IDENT_RE.exec(rest);
    if (ident !== null) {
      tokens.push({ type: 'ident', text: ident[0], pos: i });
      i += ident[0].length;
      continue;
    }
    const two = rest.slice(0, 2);
    if (two === '<>' || two === '<=' || two === '>=') {
      tokens.push({ type: 'op', text: two, pos: i });
      i += 2;
      continue;
    }
    if ('+-*/^&=<>'.includes(ch)) tokens.push({ type: 'op', text: ch, pos: i });
    else if (ch === '(') tokens.push({ type: 'lparen', text: ch, pos: i });
    else if (ch === ')') tokens.push({ type: 'rparen', text: ch, pos: i });
    // ';' is the argument separator in locales that use ',' as the decimal mark (e.g. Vietnamese).
    else if (ch === ',' || ch === ';') tokens.push({ type: 'comma', text: ch, pos: i });
    else if (ch === ':') tokens.push({ type: 'colon', text: ch, pos: i });
    else if (ch === '%') tokens.push({ type: 'percent', text: ch, pos: i });
    else throw new FormulaSyntaxError(`Unexpected character '${ch}'`, i);
    i++;
  }
  tokens.push({ type: 'eof', text: '', pos: src.length });
  return tokens;
}
