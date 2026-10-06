/** Delimiters offered for import/export: comma (default), semicolon (common where the decimal mark is a comma) and tab. */
export type CsvDelimiter = ',' | ';' | '\t';

const DELIMITERS: readonly CsvDelimiter[] = [',', ';', '\t'];

/** Strips a UTF-8 byte order mark, which Excel adds to CSV files and which would otherwise stick to the first cell. */
function withoutBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Guesses the delimiter from the first record: whichever of `,` `;` tab appears most outside quotes (comma wins ties).
 */
export function detectDelimiter(text: string): CsvDelimiter {
  const src = withoutBom(text);
  const counts = new Map<CsvDelimiter, number>(DELIMITERS.map((d) => [d, 0]));
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i] as string;
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === '\n' || ch === '\r')) break;
    else if (!quoted && counts.has(ch as CsvDelimiter)) counts.set(ch as CsvDelimiter, (counts.get(ch as CsvDelimiter) as number) + 1);
  }
  let best: CsvDelimiter = ',';
  for (const d of DELIMITERS) if ((counts.get(d) as number) > (counts.get(best) as number)) best = d;
  return best;
}

/**
 * RFC 4180 reader: quoted fields may contain the delimiter, quotes (doubled) and line breaks; CRLF, LF and CR all end a
 * record. A trailing line break does not create an empty record, but empty lines inside the data do (they are blank rows).
 */
export function parseCsv(text: string, delimiter: CsvDelimiter = detectDelimiter(text)): string[][] {
  const src = withoutBom(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let fieldStart = true;
  let sawAnything = false; // distinguishes "" (no rows) from a lone empty record

  const endField = (): void => {
    row.push(field);
    field = '';
    fieldStart = true;
  };
  const endRow = (): void => {
    endField();
    rows.push(row);
    row = [];
    sawAnything = false;
  };

  for (let i = 0; i < src.length; i++) {
    const ch = src[i] as string;
    sawAnything = true;
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
    } else if (ch === delimiter) {
      endField();
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      endRow();
    } else {
      field += ch;
      fieldStart = false;
    }
  }
  if (sawAnything) endRow(); // the last record had no line break
  return rows;
}

/** Quotes a field when it contains the delimiter, a quote or a line break (RFC 4180). */
export function csvField(value: string, delimiter: CsvDelimiter): string {
  return value.includes(delimiter) || /["\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Writes records with CRLF line breaks, as RFC 4180 and Excel expect. */
export function toCsv(rows: readonly (readonly string[])[], delimiter: CsvDelimiter = ','): string {
  return rows.map((row) => row.map((v) => csvField(v, delimiter)).join(delimiter)).join('\r\n');
}

/**
 * Spreadsheet programs treat a text cell that starts with = + - @ (or a tab/CR) as a formula when a CSV is opened, so
 * data like `=HYPERLINK(...)` typed by someone else would run on the reader's machine ("CSV injection"). A leading
 * apostrophe makes them show as text; it is the same marker Excel and Sheets use for "this is text".
 */
export function neutralizeFormula(text: string): string {
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}
