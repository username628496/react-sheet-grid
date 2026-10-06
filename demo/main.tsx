import { createRoot } from 'react-dom/client';
import { DataGrid, Spreadsheet } from '../src/index';

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

const sheet = new Spreadsheet({ rowCount: ROWS, colCount: COLS });
seed(sheet);

createRoot(document.getElementById('root')!).render(
  <div style={{ height: '100%' }}>
    <DataGrid sheet={sheet} frozenRows={1} frozenCols={1} />
  </div>,
);
