import { describe, expect, it } from 'vitest';
import { parseHtmlTable, parseTsv, toHtmlTable, toTsv } from '../../src/input/clipboard';

describe('toTsv / parseTsv', () => {
  it('round-trips plain cells', () => {
    const rows = [['a', 'b'], ['1', '2']];
    expect(toTsv(rows)).toBe('a\tb\n1\t2');
    expect(parseTsv(toTsv(rows))).toEqual(rows);
  });

  it('quotes cells with tabs, newlines and quotes, and reads them back', () => {
    const rows = [['he said "hi"', 'line1\nline2', 'a\tb', 'plain']];
    const tsv = toTsv(rows);
    expect(tsv).toBe('"he said ""hi"""\t"line1\nline2"\t"a\tb"\tplain');
    expect(parseTsv(tsv)).toEqual(rows);
  });

  it('ignores the trailing newline Excel appends and handles CRLF', () => {
    expect(parseTsv('a\tb\r\nc\td\r\n')).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('keeps empty cells and ragged rows', () => {
    expect(parseTsv('a\t\tc\n\nx')).toEqual([['a', '', 'c'], [''], ['x']]);
    expect(parseTsv('')).toEqual([['']]);
    expect(parseTsv('only')).toEqual([['only']]);
  });

  it('does not treat a quote in the middle of a field as quoting', () => {
    expect(parseTsv('5" pipe\tx')).toEqual([['5" pipe', 'x']]);
  });
});

describe('toHtmlTable', () => {
  it('escapes content and writes newlines as <br>', () => {
    expect(toHtmlTable([['<b>&', 'a\nb']])).toBe('<table><tbody><tr><td>&lt;b&gt;&amp;</td><td>a<br>b</td></tr></tbody></table>');
  });

  it('writes formatting as inline styles', () => {
    const html = toHtmlTable([['x']], [[{ bold: true, color: '#f00', background: '#eee', align: 'right', italic: true }]]);
    expect(html).toContain('font-weight:bold');
    expect(html).toContain('font-style:italic');
    expect(html).toContain('color:#f00');
    expect(html).toContain('background-color:#eee');
    expect(html).toContain('text-align:right');
  });

  it('round-trips through parseHtmlTable', () => {
    const rows = [['a & b', 'x\ny'], ['<tag>', '"q"']];
    expect(parseHtmlTable(toHtmlTable(rows))).toEqual(rows);
  });
});

describe('parseHtmlTable', () => {
  it('reads an Excel style fragment with attributes, headers and entities', () => {
    const html = `<html><body><!--StartFragment--><table border=0 cellpadding=0>
      <tr height=20 style='height:15.0pt'><td class=xl65 style='height:15.0pt'>Name</td><th>Qty</th></tr>
      <tr><td>Caf&eacute; &amp; Bar</td><td x:num>12</td></tr>
      </table><!--EndFragment--></body></html>`;
    expect(parseHtmlTable(html)).toEqual([['Name', 'Qty'], ['Caf&eacute; & Bar', '12']]);
  });

  it('reads Google Sheets output with nested tags', () => {
    const html = '<google-sheets-html-origin><table><tbody><tr><td data-sheets-value="x"><span style="font-weight:bold">Hi</span></td><td>2</td></tr></tbody></table>';
    expect(parseHtmlTable(html)).toEqual([['Hi', '2']]);
  });

  it('decodes numeric entities and keeps <br> line breaks', () => {
    expect(parseHtmlTable('<table><tr><td>&#65;&#x42;<br/>C</td></tr></table>')).toEqual([['AB\nC']]);
  });

  it('collapses insignificant whitespace', () => {
    expect(parseHtmlTable('<table><tr><td>\n   a\n   b  </td></tr></table>')).toEqual([['a b']]);
  });

  it('returns null when there is no table', () => {
    expect(parseHtmlTable('<p>hello</p>')).toBeNull();
    expect(parseHtmlTable('<table></table>')).toBeNull();
  });
});
