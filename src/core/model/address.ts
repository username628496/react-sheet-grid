/** 0 -> "A", 25 -> "Z", 26 -> "AA". */
export function columnLabel(index: number): string {
  let label = '';
  let n = index + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    label = String.fromCharCode(65 + rem) + label;
    n = Math.floor((n - 1) / 26);
  }
  return label;
}

/** "A" -> 0, "AA" -> 26. Returns -1 for anything that is not letters. */
export function parseColumnLabel(label: string): number {
  if (!/^[A-Za-z]+$/.test(label)) return -1;
  let n = 0;
  for (const ch of label.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function cellAddress(dataRow: number, dataCol: number): string {
  return `${columnLabel(dataCol)}${dataRow + 1}`;
}
