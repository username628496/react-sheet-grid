import { createRoot } from 'react-dom/client';
import { DataGrid, type GridController, Spreadsheet, StatusBar, Toolbar } from '../src/index';

const ROWS = 1_000_000;
const COLS = 100;

// A full 1M x 100 grid would be 100M cells and cannot live in a Map, so the demo
// seeds a dense block at the top plus scattered cells over the whole sheet.
function seed(sheet: Spreadsheet): void {
  let s = 987654321;
  const rand = (): number => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const words = ['alpha', 'beta', 'gamma', 'delta', 'Xin chào', 'Việt Nam', 'total', 'north'];
  const put = (r: number, c: number): void => {
    const kind = rand();
    const value = kind < 0.6 ? Math.round(rand() * 100000) / 100 : (words[Math.floor(rand() * words.length)] as string);
    sheet.model.setCell(r, c, { value, styleId: 0 });
  };
  for (let c = 0; c < COLS; c++) {
    sheet.model.setCell(0, c, { value: `Column ${c + 1}`, styleId: sheet.styles.intern({ bold: true, background: '#f1f3f4' }) });
  }
  for (let r = 1; r < 5000; r++) for (let c = 0; c < 20; c++) put(r, c);
  for (let i = 0; i < 300_000; i++) put(Math.floor(rand() * ROWS), Math.floor(rand() * COLS));
}

// ?mode=empty gives a small blank sheet so e2e tests are deterministic.
const empty = new URLSearchParams(location.search).get('mode') === 'empty';
const sheet = empty ? new Spreadsheet({ rowCount: 1000, colCount: 26 }) : new Spreadsheet({ rowCount: ROWS, colCount: COLS });
if (!empty) seed(sheet);

declare global {
  interface Window {
    __grid?: GridController;
    __sheet?: Spreadsheet;
  }
}
window.__sheet = sheet;

createRoot(document.getElementById('root')!).render(
  <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
    <Toolbar sheet={sheet} onAction={() => window.__grid?.editor.focus()} />
    <div style={{ flex: 1, minHeight: 0 }}>
    <DataGrid
      sheet={sheet}
      frozenRows={empty ? 0 : 1}
      frozenCols={empty ? 0 : 1}
      onReady={(controller) => {
        window.__grid = controller;
      }}
    />
    </div>
    <StatusBar sheet={sheet} />
  </div>,
);
