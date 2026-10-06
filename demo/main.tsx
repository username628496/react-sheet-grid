import { type CSSProperties, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DataGrid, deserializeSheet, FormulaBar, type GridController, SnapshotError, Spreadsheet, StatusBar, Toolbar } from '../src/index';
import { autoSave, clearSnapshot, loadSnapshot, type SaveStatus } from './storage';

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

// Default: a blank 50 x 26 sheet that is saved in the browser (IndexedDB) and restored on reload.
// ?mode=sample loads the 1M x 100 stress sheet and ?mode=empty a blank 1000 x 26 one with no frozen panes (kept
// deterministic for the e2e tests); neither reads nor writes the saved sheet.
const mode = new URLSearchParams(location.search).get('mode');
const empty = mode === 'empty';
const sample = mode === 'sample';
const persistent = !empty && !sample;

declare global {
  interface Window {
    __grid?: GridController;
    __sheet?: Spreadsheet;
  }
}

async function createSheet(): Promise<{ sheet: Spreadsheet; notice: string | null }> {
  if (sample) {
    const big = new Spreadsheet({ rowCount: ROWS, colCount: COLS });
    seed(big);
    return { sheet: big, notice: null };
  }
  if (empty) return { sheet: new Spreadsheet({ rowCount: 1000, colCount: 26 }), notice: null };
  const stored = await loadSnapshot();
  if (stored !== undefined) {
    try {
      return { sheet: deserializeSheet(stored), notice: null };
    } catch (e) {
      // A corrupt or too-new save must not lock the user out: start blank and say why.
      const reason = e instanceof SnapshotError ? e.message : 'The saved sheet could not be read.';
      return { sheet: new Spreadsheet({ rowCount: 50, colCount: 26 }), notice: `${reason} Started a blank sheet.` };
    }
  }
  return { sheet: new Spreadsheet({ rowCount: 50, colCount: 26 }), notice: null };
}

const linkStyle: CSSProperties = {
  font: '12px system-ui, sans-serif',
  padding: '6px 14px',
  color: '#1a73e8',
  background: 'transparent',
  border: 0,
  cursor: 'pointer',
  textDecoration: 'none',
};

function App({ sheet, notice }: { sheet: Spreadsheet; notice: string | null }) {
  const [grid, setGrid] = useState<GridController | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus | null>(null);
  useEffect(() => (persistent ? autoSave(sheet, setSaveStatus) : undefined), [sheet]);
  const reset = async (): Promise<void> => {
    if (!window.confirm('Discard the saved sheet and start a blank one?')) return;
    await clearSnapshot();
    location.reload();
  };
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
      <div style={{ display: 'flex', alignItems: 'stretch', background: '#f8f9fb', borderTop: '1px solid #e1e4e8' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <StatusBar sheet={sheet} />
        </div>
        <span data-testid="save-status" style={{ ...linkStyle, color: saveStatus === 'error' ? '#d93025' : '#656d76', alignSelf: 'center' }}>
          {notice ?? (saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? 'Saved' : saveStatus === 'error' ? 'Could not save' : '')}
        </span>
        {persistent && (
          <button type="button" style={linkStyle} onClick={() => void reset()}>
            Reset
          </button>
        )}
        {!sample && (
          <a href="?mode=sample" style={linkStyle}>
            Load 1M × 100 sample
          </a>
        )}
      </div>
    </div>
  );
}

void createSheet().then(({ sheet, notice }) => {
  window.__sheet = sheet;
  createRoot(document.getElementById('root')!).render(<App sheet={sheet} notice={notice} />);
});
