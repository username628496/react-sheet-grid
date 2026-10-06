/**
 * Breaks `text` into lines no wider than `available`, the way a wrapping cell shows it: explicit line breaks are kept,
 * lines break at spaces, and a single word wider than the cell is cut between characters. `measure` gives the width
 * of a string in the cell's font (the canvas measures it; tests pass a fake). Never returns an empty list.
 */
export function wrapLines(text: string, available: number, measure: (s: string) => number): string[] {
  const out: string[] = [];
  for (const paragraph of text.split(/\r\n|\r|\n/)) {
    if (paragraph === '') {
      out.push('');
      continue;
    }
    let line = '';
    for (const word of paragraph.split(' ')) {
      const candidate = line === '' ? word : `${line} ${word}`;
      if (measure(candidate) <= available || candidate === '') {
        line = candidate;
        continue;
      }
      if (line !== '') out.push(line);
      line = '';
      // A word too wide for an empty line is cut by characters (surrogate pairs stay together).
      if (measure(word) <= available) {
        line = word;
      } else {
        for (const char of word) {
          const next = line + char;
          if (line !== '' && measure(next) > available) {
            out.push(line);
            line = char;
          } else {
            line = next;
          }
        }
      }
    }
    out.push(line);
  }
  return out.length === 0 ? [''] : out;
}
