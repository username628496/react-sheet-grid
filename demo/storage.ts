import { serializeSheet, type SheetSnapshot, type Spreadsheet } from '../src/index';

// IndexedDB rather than localStorage: a filled sheet is many megabytes, and IndexedDB stores the snapshot object
// directly (structured clone) without a JSON round trip.
const DB_NAME = 'react-data-grid-demo';
const STORE = 'sheets';
const KEY = 'default';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = work(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function loadSnapshot(): Promise<unknown> {
  try {
    return await run('readonly', (store) => store.get(KEY));
  } catch {
    return undefined; // storage blocked (private mode, no IndexedDB): behave like a first visit
  }
}

export async function clearSnapshot(): Promise<void> {
  try {
    await run('readwrite', (store) => store.delete(KEY));
  } catch {
    /* nothing stored, or storage unavailable */
  }
}

export type SaveStatus = 'saved' | 'saving' | 'error';

/**
 * Saves the sheet shortly after the last change (not on every keystroke or selection move) and again when the tab is
 * hidden or closed. Only real edits count: the revision moves with every edit, undo, redo and freeze.
 */
export function autoSave(sheet: Spreadsheet, onStatus: (status: SaveStatus) => void): () => void {
  let savedVersion = sheet.revision;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let writing = false;

  const flush = async (): Promise<void> => {
    timer = undefined;
    if (writing) {
      timer = setTimeout(() => void flush(), 200); // one write at a time; the next one picks up newer edits
      return;
    }
    const version = sheet.revision;
    if (version === savedVersion) return;
    writing = true;
    onStatus('saving');
    try {
      await run('readwrite', (store) => store.put(serializeSheet(sheet) satisfies SheetSnapshot, KEY));
      savedVersion = version;
      onStatus(sheet.revision === savedVersion ? 'saved' : 'saving');
    } catch {
      onStatus('error');
    } finally {
      writing = false;
    }
  };

  const schedule = (): void => {
    if (sheet.revision === savedVersion) return;
    onStatus('saving');
    clearTimeout(timer);
    timer = setTimeout(() => void flush(), 600);
  };
  const flushNow = (): void => {
    clearTimeout(timer);
    void flush();
  };
  const onVisibility = (): void => {
    if (document.visibilityState === 'hidden') flushNow();
  };

  const off = sheet.subscribe(schedule);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', flushNow);
  return () => {
    off();
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', flushNow);
  };
}
