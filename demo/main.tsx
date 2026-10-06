import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DataGrid, FormulaBar, type GridController, Spreadsheet, StatusBar, Toolbar } from '../src/index';

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

// Default: a blank 50 x 26 sheet (resizable from the toolbar). ?mode=sample loads the 1M x 100 stress sheet,
// ?mode=empty a blank 1000 x 26 one with no frozen panes, which keeps the e2e tests deterministic.
const mode = new URLSearchParams(location.search).get('mode');
const empty = mode === 'empty';
const sample = mode === 'sample';
const sheet = sample
  ? new Spreadsheet({ rowCount: ROWS, colCount: COLS })
  : new Spreadsheet(empty ? { rowCount: 1000, colCount: 26 } : { rowCount: 50, colCount: 26 });
if (sample) seed(sheet);

declare global {
  interface Window {
    __grid?: GridController;
    __sheet?: Spreadsheet;
  }
}
window.__sheet = sheet;

function App() {
  const [grid, setGrid] = useState<GridController | null>(null);
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Toolbar sheet={sheet} onAction={() => window.__grid?.editor.focus()} />
      <FormulaBar sheet={sheet} grid={grid} />
      <div style={{ flex: 1, minHeight: 0 }}>
        <DataGrid
          sheet={sheet}
          frozenRows={sample ? 1 : 0}
          frozenCols={sample ? 1 : 0}
          onReady={(controller) => {
            window.__grid = controller;
            setGrid(controller);
          }}
        />
      </div>
      <div style={{ display: 'flex', alignItems: 'stretch' }}>
        <div style={{ flex: 1 }}>
          <StatusBar sheet={sheet} />
        </div>
        {!sample && (
          <a href="?mode=sample" style={{ font: '12px system-ui, sans-serif', padding: '6px 14px', color: '#1a73e8', borderTop: '1px solid #e1e4e8', background: '#f8f9fb', textDecoration: 'none' }}>
            Load 1M × 100 sample
          </a>
        )}
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
