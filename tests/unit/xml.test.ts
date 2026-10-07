import { describe, expect, it } from 'vitest';
import { decodeEscapes, escapeXml, parseXml, XmlError } from '../../src/xlsx/xml';

function events(src: string): string[] {
  const out: string[] = [];
  parseXml(src, {
    open: (name, attrs) => out.push(`<${name}${Object.entries(attrs).map(([k, v]) => ` ${k}=${JSON.stringify(v)}`).join('')}>`),
    text: (t) => out.push(`#${t}`),
    close: (name) => out.push(`</${name}>`),
  });
  return out;
}

describe('escapeXml', () => {
  it('escapes markup and control characters', () => {
    expect(escapeXml('a<b>&"c')).toBe('a&lt;b&gt;&amp;&quot;c');
    expect(escapeXml('x\u0001y')).toBe('x_x0001_y');
    expect(escapeXml('tab\tnl\n')).toBe('tab\tnl\n');
    expect(escapeXml('_x0041_')).toBe('_x005F_x0041_'); // a literal that looks like an escape survives a round trip
    expect(decodeEscapes(escapeXml('_x0041_ and \u0002'))).toBe('_x0041_ and \u0002');
  });
});

describe('parseXml', () => {
  it('reads elements, attributes, text and self-closing tags, dropping prefixes', () => {
    expect(events('<?xml version="1.0"?><x:a b="1" c=\'two\'><x:b/>hi &amp; bye<c d="&lt;"></c></x:a>')).toEqual([
      '<a b="1" c="two">',
      '<b>',
      '</b>',
      '#hi & bye',
      '<c d="<">',
      '</c>',
      '</a>',
    ]);
  });

  it('keeps r:id and xml:space as written', () => {
    expect(events('<t xml:space="preserve" r:id="rId1"> x </t>')).toEqual(['<t xml:space="preserve" r:id="rId1">', '# x ', '</t>']);
  });

  it('handles CDATA, comments and numeric entities', () => {
    expect(events('<a><!-- no --><![CDATA[<raw>]]>&#65;&#x42;</a>')).toEqual(['<a>', '#<raw>', '#AB', '</a>']);
  });

  it("a '>' inside an attribute value does not end the tag", () => {
    expect(events('<a v="x>y"/>')).toEqual(['<a v="x>y">', '</a>']);
  });

  it('never expands custom entities (no billion laughs)', () => {
    expect(events('<!DOCTYPE a [<!ENTITY x "boom">]><a>&x;</a>')).toEqual(['<a>', '#&x;', '</a>']);
  });

  it('rejects broken documents', () => {
    expect(() => parseXml('<a><b></a>', { open() {}, close() {} })).toThrow(XmlError);
    expect(() => parseXml('<a>', { open() {}, close() {} })).toThrow(XmlError);
    expect(() => parseXml('<a', { open() {}, close() {} })).toThrow(XmlError);
    expect(() => parseXml('<!-- x', { open() {}, close() {} })).toThrow(XmlError);
  });
});
