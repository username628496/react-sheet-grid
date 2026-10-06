import { describe, expect, it } from 'vitest';
import { FormulaSyntaxError, tokenize } from '../../../src/formula/tokenizer';

const types = (src: string): string[] => tokenize(src).map((t) => t.type);
const texts = (src: string): string[] => tokenize(src).map((t) => t.text);

describe('tokenize', () => {
  it('splits numbers, operators and refs', () => {
    expect(texts('1+2.5*A1')).toEqual(['1', '+', '2.5', '*', 'A1', '']);
    expect(types('1+A1')).toEqual(['num', 'op', 'ident', 'eof']);
  });

  it('reads scientific notation and leading-dot numbers', () => {
    expect(texts('1e3+.5+2E-2')).toEqual(['1e3', '+', '.5', '+', '2E-2', '']);
  });

  it('reads strings with doubled quotes', () => {
    const [t] = tokenize('"say ""hi"""');
    expect(t).toMatchObject({ type: 'str', text: 'say "hi"' });
  });

  it('reads two-character operators', () => {
    expect(texts('A1<>B1<=2>=3')).toEqual(['A1', '<>', 'B1', '<=', '2', '>=', '3', '']);
  });

  it('treats ; like , as an argument separator', () => {
    expect(types('SUM(1;2,3)')).toEqual(['ident', 'lparen', 'num', 'comma', 'num', 'comma', 'num', 'rparen', 'eof']);
  });

  it('reads absolute refs, ranges and error literals', () => {
    expect(texts('$A$1:B2')).toEqual(['$A$1', ':', 'B2', '']);
    expect(types('#N/A')).toEqual(['err', 'eof']);
    expect(texts('#div/0!')).toEqual(['#DIV/0!', '']);
  });

  it('ignores whitespace', () => {
    expect(texts('  1 +\t2 ')).toEqual(['1', '+', '2', '']);
  });

  it('rejects unterminated strings and unknown characters', () => {
    expect(() => tokenize('"abc')).toThrow(FormulaSyntaxError);
    expect(() => tokenize('1 @ 2')).toThrow(FormulaSyntaxError);
    expect(() => tokenize('#BOGUS')).toThrow(FormulaSyntaxError);
  });
});
