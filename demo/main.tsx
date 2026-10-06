import { type CSSProperties, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  DataGrid,
  deserializeSheet,
  FormulaBar,
  GridProvider,
  type GridController,
  type Locale,
  SnapshotError,
  Spreadsheet,
  StatusBar,
  type ThemeSetting,
  Toolbar,
} from '../src/index';
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

function readPref<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return allowed.includes(value as T) ? (value as T) : fallback;
  } catch {
    return fallback;
  }
}

function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage blocked: the choice just lasts until reload */
  }
}

const LOCALES: readonly Locale[] = ['en', 'vi'];
const THEMES: readonly ThemeSetting[] = ['auto', 'light', 'dark'];
const defaultLocale: Locale = navigator.language.toLowerCase().startsWith('vi') ? 'vi' : 'en';

const footerButton: CSSProperties = {
  font: '12px system-ui, sans-serif',
  padding: '6px 12px',
  color: 'var(--rdg-accent)',
  background: 'transparent',
  border: 0,
  cursor: 'pointer',
  textDecoration: 'none',
};

const footerSelect: CSSProperties = {
  font: '12px system-ui, sans-serif',
  color: 'var(--rdg-text)',
  background: 'var(--rdg-field)',
  border: '1px solid var(--rdg-border)',
  borderRadius: 6,
  padding: '2px 4px',
  margin: '0 4px',
};

function App({ sheet, notice }: { sheet: Spreadsheet; notice: string | null }) {
  const [grid, setGrid] = useState<GridController | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus | null>(null);
  const [locale, setLocale] = useState<Locale>(() => readPref('rdg-locale', LOCALES, defaultLocale));
  const [theme, setTheme] = useState<ThemeSetting>(() => readPref('rdg-theme', THEMES, 'auto'));
  useEffect(() => (persistent ? autoSave(sheet, setSaveStatus) : undefined), [sheet]);
  return (
    <GridProvider locale={locale} theme={theme}>
      <Page
        sheet={sheet}
        grid={grid}
        notice={notice}
        saveStatus={saveStatus}
        locale={locale}
        theme={theme}
        onGrid={setGrid}
        onLocale={(l) => {
          setLocale(l);
          writePref('rdg-locale', l);
        }}
        onTheme={(t) => {
          setTheme(t);
          writePref('rdg-theme', t);
        }}
      />
    </GridProvider>
  );
}

interface PageProps {
  sheet: Spreadsheet;
  grid: GridController | null;
  notice: string | null;
  saveStatus: SaveStatus | null;
  locale: Locale;
  theme: ThemeSetting;
  onGrid(g: GridController): void;
  onLocale(l: Locale): void;
  onTheme(t: ThemeSetting): void;
}

function Page({ sheet, grid, notice, saveStatus, locale, theme, onGrid, onLocale, onTheme }: PageProps) {
  const resolved = useResolvedTheme(theme);
  const reset = async (): Promise<void> => {
    if (!window.confirm(locale === 'vi' ? 'Xóa bảng đã lưu và bắt đầu bảng trống?' : 'Discard the saved sheet and start a blank one?')) return;
    await clearSnapshot();
    location.reload();
  };
  const t = locale === 'vi'
    ? { saving: 'Đang lưu…', saved: 'Đã lưu', error: 'Không lưu được', reset: 'Đặt lại', sample: 'Nạp mẫu 1M × 100', language: 'Ngôn ngữ', theme: 'Giao diện', auto: 'Tự động', light: 'Sáng', dark: 'Tối' }
    : { saving: 'Saving…', saved: 'Saved', error: 'Could not save', reset: 'Reset', sample: 'Load 1M × 100 sample', language: 'Language', theme: 'Theme', auto: 'Auto', light: 'Light', dark: 'Dark' };
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: resolved === 'dark' ? '#1b1d21' : '#fff' }}>
      <Toolbar sheet={sheet} grid={grid} onAction={() => window.__grid?.editor.focus()} />
      <FormulaBar sheet={sheet} grid={grid} />
      <div style={{ flex: 1, minHeight: 0 }}>
        <DataGrid
          sheet={sheet}
          frozenRows={sample ? 1 : 0}
          frozenCols={sample ? 1 : 0}
          onReady={(controller) => {
            window.__grid = controller;
            onGrid(controller);
          }}
        />
      </div>
      <div className="rdg-chrome" data-rdg-theme={resolved} style={{ display: 'flex', alignItems: 'stretch', borderTop: '1px solid var(--rdg-border)' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <StatusBar sheet={sheet} />
        </div>
        <span data-testid="save-status" style={{ ...footerButton, color: saveStatus === 'error' ? '#d93025' : 'var(--rdg-muted)', alignSelf: 'center' }}>
          {notice ?? (saveStatus === 'saving' ? t.saving : saveStatus === 'saved' ? t.saved : saveStatus === 'error' ? t.error : '')}
        </span>
        <label style={{ alignSelf: 'center', font: '12px system-ui, sans-serif', color: 'var(--rdg-muted)' }}>
          {t.language}
          <select aria-label="Language" style={footerSelect} value={locale} onChange={(e) => onLocale(e.target.value as Locale)}>
            <option value="en">English</option>
            <option value="vi">Tiếng Việt</option>
          </select>
        </label>
        <label style={{ alignSelf: 'center', font: '12px system-ui, sans-serif', color: 'var(--rdg-muted)' }}>
          {t.theme}
          <select aria-label="Theme" style={footerSelect} value={theme} onChange={(e) => onTheme(e.target.value as ThemeSetting)}>
            <option value="auto">{t.auto}</option>
            <option value="light">{t.light}</option>
            <option value="dark">{t.dark}</option>
          </select>
        </label>
        {persistent && (
          <button type="button" style={footerButton} onClick={() => void reset()}>
            {t.reset}
          </button>
        )}
        {!sample && (
          <a href="?mode=sample" style={footerButton}>
            {t.sample}
          </a>
        )}
      </div>
    </div>
  );
}

/** The demo page needs to know the effective theme (to color its own background), including "auto". */
function useResolvedTheme(setting: ThemeSetting): 'light' | 'dark' {
  const [dark, setDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const update = (): void => setDark(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return setting === 'auto' ? (dark ? 'dark' : 'light') : setting;
}

void createSheet().then(({ sheet, notice }) => {
  window.__sheet = sheet;
  createRoot(document.getElementById('root')!).render(<App sheet={sheet} notice={notice} />);
});
