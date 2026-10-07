/** Escapes text for an XML element or attribute. Characters XML 1.0 cannot hold are written as `_xHHHH_`, as Excel does. */
export function escapeXml(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    if (ch === 38) out += '&amp;';
    else if (ch === 60) out += '&lt;';
    else if (ch === 62) out += '&gt;';
    else if (ch === 34) out += '&quot;';
    else if (ch < 32 && ch !== 9 && ch !== 10 && ch !== 13) out += `_x${ch.toString(16).toUpperCase().padStart(4, '0')}_`;
    else if (ch === 0xfffe || ch === 0xffff) out += `_x${ch.toString(16).toUpperCase()}_`;
    else if (text.startsWith('_x', i) && /^_x[0-9A-Fa-f]{4}_/.test(text.slice(i, i + 7))) out += '_x005F_'; // a literal "_x" that must not be read back as an escape
    else out += text[i];
  }
  return out;
}

/** Undoes `_xHHHH_` escapes (Excel writes them for control characters and for literal `_x...`). */
export function decodeEscapes(text: string): string {
  return text.includes('_x') ? text.replace(/_x([0-9A-Fa-f]{4})_/g, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16))) : text;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeEntities(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(/&(#x[0-9A-Fa-f]+|#\d+|[A-Za-z]+);/g, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body] ?? whole; // custom entities are never expanded
  });
}

export interface XmlHandler {
  open(name: string, attrs: Readonly<Record<string, string>>): void;
  text?(text: string): void;
  close(name: string): void;
}

export class XmlError extends Error {
  constructor(message: string) {
    super(`Invalid XML: ${message}`);
    this.name = 'XmlError';
  }
}

const local = (name: string): string => {
  const colon = name.indexOf(':');
  return colon < 0 ? name : name.slice(colon + 1);
};

const ATTR = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/**
 * A forgiving SAX-style XML reader (the DOM is not available in Node, and a streaming pass keeps memory flat for
 * big sheets). Tag and attribute names lose their namespace prefix (`x:row` is `row`), except that `r:id` and
 * `xml:space` are kept as they are written. Comments, processing instructions and DOCTYPEs are skipped; entities
 * other than the predefined and numeric ones are left alone, so nothing can be expanded into something huge.
 */
export function parseXml(src: string, handler: XmlHandler): void {
  const stack: string[] = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const lt = src.indexOf('<', i);
    if (lt < 0) {
      if (stack.length > 0 && src.slice(i).trim() !== '') handler.text?.(decodeEntities(src.slice(i)));
      break;
    }
    if (lt > i && stack.length > 0) handler.text?.(decodeEntities(src.slice(i, lt)));
    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt + 4);
      if (end < 0) throw new XmlError('unterminated comment');
      i = end + 3;
    } else if (src.startsWith('<![CDATA[', lt)) {
      const end = src.indexOf(']]>', lt + 9);
      if (end < 0) throw new XmlError('unterminated CDATA');
      handler.text?.(src.slice(lt + 9, end));
      i = end + 3;
    } else if (src.startsWith('<?', lt)) {
      const end = src.indexOf('?>', lt + 2);
      if (end < 0) throw new XmlError('unterminated declaration');
      i = end + 2;
    } else if (src.startsWith('<!', lt)) {
      // DOCTYPE: skipped, including an internal subset in brackets.
      let depth = 0;
      let j = lt + 2;
      for (; j < n; j++) {
        const ch = src[j];
        if (ch === '[') depth++;
        else if (ch === ']') depth--;
        else if (ch === '>' && depth <= 0) break;
      }
      i = j + 1;
    } else if (src[lt + 1] === '/') {
      const end = src.indexOf('>', lt + 2);
      if (end < 0) throw new XmlError('unterminated closing tag');
      const name = local(src.slice(lt + 2, end).trim());
      const open = stack.pop();
      if (open !== name) throw new XmlError(`</${name}> does not match <${open ?? 'nothing'}>`);
      handler.close(name);
      i = end + 1;
    } else {
      // An opening tag; '>' inside an attribute value must not end it.
      let j = lt + 1;
      let quote = '';
      for (; j < n; j++) {
        const ch = src[j] as string;
        if (quote !== '') {
          if (ch === quote) quote = '';
        } else if (ch === '"' || ch === "'") quote = ch;
        else if (ch === '>') break;
      }
      if (j >= n) throw new XmlError('unterminated tag');
      let inner = src.slice(lt + 1, j);
      const selfClosing = inner.endsWith('/');
      if (selfClosing) inner = inner.slice(0, -1);
      const space = inner.search(/\s/);
      const name = local(space < 0 ? inner : inner.slice(0, space));
      if (name === '') throw new XmlError('a tag has no name');
      const attrs: Record<string, string> = {};
      if (space >= 0) {
        ATTR.lastIndex = 0;
        for (let m = ATTR.exec(inner); m !== null; m = ATTR.exec(inner)) {
          const raw = m[1] as string;
          const value = decodeEntities((m[2] ?? m[3]) as string);
          attrs[raw === 'r:id' || raw === 'xml:space' ? raw : local(raw)] = value;
        }
      }
      handler.open(name, attrs);
      if (selfClosing) handler.close(name);
      else stack.push(name);
      i = j + 1;
    }
  }
  if (stack.length > 0) throw new XmlError(`<${stack[stack.length - 1]}> is never closed`);
}
