import type { Style } from '../core/model/StyleTable';

/** Cells containing tab, newline or quote are quoted, quotes doubled: what Excel and Sheets write. */
export function toTsv(rows: readonly (readonly string[])[]): string {
  return rows
    .map((row) =>
      row
        .map((cell) => (/[\t\n\r"]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell))
        .join('\t'),
    )
    .join('\n');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '<br>');
}

function styleAttr(style: Style | undefined): string {
  if (style === undefined) return '';
  const css: string[] = [];
  if (style.bold === true) css.push('font-weight:bold');
  if (style.italic === true) css.push('font-style:italic');
  if (style.underline === true || style.strike === true) {
    css.push(`text-decoration:${[style.underline === true ? 'underline' : '', style.strike === true ? 'line-through' : ''].filter(Boolean).join(' ')}`);
  }
  if (style.color !== undefined) css.push(`color:${style.color}`);
  if (style.background !== undefined) css.push(`background-color:${style.background}`);
  if (style.align !== undefined) css.push(`text-align:${style.align}`);
  if (style.fontSize !== undefined) css.push(`font-size:${style.fontSize}px`);
  if (style.valign !== undefined) css.push(`vertical-align:${style.valign}`);
  if (style.wrap === 'wrap') css.push('white-space:pre-wrap');
  else if (style.wrap === 'clip') css.push('white-space:nowrap;overflow:hidden');
  return css.length === 0 ? '' : ` style="${css.join(';')}"`;
}

export function toHtmlTable(
  rows: readonly (readonly string[])[],
  styles?: readonly (readonly (Style | undefined)[])[],
): string {
  const body = rows
    .map((row, i) => {
      const cells = row.map((cell, j) => `<td${styleAttr(styles?.[i]?.[j])}>${escapeHtml(cell)}</td>`).join('');
      return `<tr>${cells}</tr>`;
    })
    .join('');
  return `<table><tbody>${body}</tbody></table>`;
}

export function parseTsv(text: string): string[][] {
  const src = text.replace(/\r\n?/g, '\n');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let fieldStart = true;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i] as string;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"' && fieldStart) {
      quoted = true;
      fieldStart = false;
    } else if (ch === '\t') {
      row.push(field);
      field = '';
      fieldStart = true;
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      fieldStart = true;
    } else {
      field += ch;
      fieldStart = false;
    }
  }
  // Excel ends the text with a newline; that final empty line is not a row.
  if (field !== '' || row.length > 0 || rows.length === 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) return String.fromCodePoint(parseInt(body.slice(2), 16));
    if (body.startsWith('#')) return String.fromCodePoint(parseInt(body.slice(1), 10));
    return ENTITIES[body.toLowerCase()] ?? match;
  });
}

/**
 * Reads the first <table> of a clipboard HTML fragment (Excel, Google Sheets,
 * web pages). Regex based on purpose: core input handling must not need a DOM
 * parser, so it also runs in Node tests. Merged cells are not expanded.
 */
export function parseHtmlTable(html: string): string[][] | null {
  const table = /<table[\s\S]*?<\/table>/i.exec(html);
  if (table === null) return null;
  const rows: string[][] = [];
  for (const rowMatch of table[0].matchAll(/<tr\b[\s\S]*?<\/tr>/gi)) {
    const cells: string[] = [];
    for (const cellMatch of rowMatch[0].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)) {
      const inner = cellMatch[1] ?? '';
      const hasBreak = /<br\s*\/?>/i.test(inner);
      let text = inner.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '');
      text = decodeEntities(text);
      // HTML source whitespace is not significant, only <br> is.
      cells.push(hasBreak ? text.trim() : text.replace(/\s+/g, ' ').trim());
    }
    if (cells.length > 0) rows.push(cells);
  }
  return rows.length === 0 ? null : rows;
}
