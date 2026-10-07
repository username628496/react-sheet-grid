/** A file bigger than this is refused: reading it into one string and parsing it would stall the page. */
export const MAX_IMPORT_BYTES = 50 * 1024 * 1024;

/**
 * Reads a text file for import. CSV from Windows Excel is often not UTF-8 (the "CSV" save option uses the system code
 * page), so when the bytes are not valid UTF-8 they are read as Windows-1252 instead of showing replacement characters.
 */
export async function readTextFile(file: Blob): Promise<string> {
  const bytes = await file.arrayBuffer();
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/**
 * Hands `text` to the browser as a download. A byte order mark is added so Excel opens UTF-8 (Vietnamese, accents)
 * correctly instead of guessing a legacy encoding; other programs ignore it.
 */
export function downloadText(fileName: string, text: string, mime = 'text/csv;charset=utf-8'): void {
  const url = URL.createObjectURL(new Blob(['﻿', text], { type: mime }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.style.display = 'none';
  document.body.append(link);
  link.click();
  link.remove();
  // Revoking right away can cancel the download in some browsers; give it a moment.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Hands binary data to the browser as a download (an .xlsx file). */
export function downloadBytes(fileName: string, bytes: Uint8Array, mime: string): void {
  const url = URL.createObjectURL(new Blob([bytes.slice().buffer as ArrayBuffer], { type: mime }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.style.display = 'none';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
