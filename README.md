# react-sheet-grid

A spreadsheet grid for React with the feel of Google Sheets. The grid is drawn on a canvas, so a sheet of one million
rows by a hundred columns scrolls at 60 fps; editing, menus and the toolbar are ordinary DOM on top of it.

- Formulas with relative and absolute references, a dependency graph and incremental recalculation
- Undo/redo, copy/cut/paste (Excel and Google Sheets compatible), fill handle, sort, filter, insert/delete, hide, freeze, zoom
- Vietnamese (Telex/VNI) and other IME input works while typing in a cell
- Toolbar, formula bar and status bar included (and usable on their own)
- English and Vietnamese UI, light and dark theme
- No runtime dependencies besides React

## Install

```bash
npm install react-sheet-grid
# react and react-dom (18 or newer) are peer dependencies
```

## Quick start

```tsx
import { SheetGrid } from 'react-sheet-grid';

export function App() {
  return (
    <div style={{ height: 600 }}>
      <SheetGrid rowCount={1000} colCount={26} />
    </div>
  );
}
```

`SheetGrid` fills its parent (it needs a parent with a height). It renders the toolbar, the formula bar, the grid and
the status bar.

### Saving and loading

```tsx
import { SheetGrid, type SheetGridHandle } from 'react-sheet-grid';

function Editor({ saved }: { saved?: unknown }) {
  const ref = useRef<SheetGridHandle>(null);
  return (
    <SheetGrid
      ref={ref}
      defaultValue={saved}                       // a snapshot from a previous session
      onChange={({ getSnapshot }) => {
        localStorage.setItem('sheet', JSON.stringify(getSnapshot()));   // or send it to your server
      }}
    />
  );
}
```

A snapshot is plain JSON: cells (values and formulas as text), formatting, sizes, sort/filter, frozen panes. Formulas are
recalculated when it is loaded. The undo history and the selection are not saved.

`onChange` fires after the document changed (edits, paste, formatting, undo, freezing), never for selection or scrolling and never while `readOnly` is on.
Calls are batched (`changeDelay`, 300 ms by default) and one more call is made on unmount if changes are still pending.
`getSnapshot()` walks every filled cell, so call it when you save, not on every render.

### Props

| Prop | Type | Description |
|---|---|---|
| `defaultValue` | `unknown` | A saved snapshot. Read once at mount; use `ref.current.load(snapshot)` to replace the sheet later. A snapshot that cannot be read starts a blank sheet and calls `onError`. |
| `rowCount`, `colCount` | `number` | Size of a new sheet (default 1000 × 26). Users can change them from the toolbar. |
| `readOnly` | `boolean` | Blocks every change to cells, formatting and structure. Sorting, filtering, hiding, freezing, zooming and copying still work. |
| `locale` | `'en' \| 'vi'` | UI language (default `'en'`). |
| `messages` | `Partial<Messages>` | Overrides single UI strings. |
| `theme` | `'light' \| 'dark' \| 'auto'` | Default `'light'`; `'auto'` follows the operating system. |
| `toolbar`, `formulaBar`, `statusBar` | `boolean` | Show or hide each bar (all `true`). |
| `frozenRows`, `frozenCols` | `number` | Initial frozen panes. |
| `zoom`, `onZoomChange` | `number`, `(zoom) => void` | Zoom factor from 0.5 to 2. |
| `onChange`, `changeDelay` | | See above. |
| `onError` | `(error: Error) => void` | Called when `defaultValue` is unreadable. |
| `className`, `style` | | Applied to the outer box. |

### The ref

```ts
interface SheetGridHandle {
  sheet: Spreadsheet;                 // the headless model: read cells, run commands, subscribe
  controller: GridController | null;  // input and rendering controller (null until mounted)
  getSnapshot(): SheetSnapshot;
  load(snapshot: unknown): void;      // throws SnapshotError for bad data and leaves the sheet untouched
  focus(): void;
}
```

## Building your own layout

`SheetGrid` is a composition of exported parts. Use them directly when you want a different arrangement:

```tsx
import { useState } from 'react';
import { DataGrid, FormulaBar, GridProvider, Spreadsheet, StatusBar, Toolbar, type GridController } from 'react-sheet-grid';

const sheet = new Spreadsheet({ rowCount: 100, colCount: 26 });

function Custom() {
  const [grid, setGrid] = useState<GridController | null>(null);
  return (
    <GridProvider locale="vi" theme="auto">
      <div style={{ height: 500, display: 'flex', flexDirection: 'column' }}>
        <Toolbar sheet={sheet} grid={grid} onAction={() => grid?.editor.focus()} />
        <FormulaBar sheet={sheet} grid={grid} />
        <div style={{ flex: 1, minHeight: 0 }}>
          <DataGrid sheet={sheet} onReady={setGrid} />
        </div>
        <StatusBar sheet={sheet} />
      </div>
    </GridProvider>
  );
}
```

The `Spreadsheet` class has no dependency on React or the DOM; it also runs in Node (useful for tests and for
server-side processing):

```ts
import { Spreadsheet, serializeSheet, deserializeSheet } from 'react-sheet-grid';

const sheet = new Spreadsheet({ rowCount: 100, colCount: 10 });
sheet.setCellInput(0, 0, '5');
sheet.setCellInput(1, 0, '=A1*2');
sheet.getCellByView(1, 0).value;          // 10
const saved = JSON.stringify(serializeSheet(sheet));
const again = deserializeSheet(JSON.parse(saved));
```

Every change goes through `sheet.execute(command)`, which is what makes undo/redo work; `setCellInput`, `formatSelection`,
`insertRows`, … are conveniences that do that for you. `sheet.subscribe(fn)` fires on every change including selection;
`sheet.subscribeChanges(fn)` only when the document changed.

## Formulas

References: `A1`, `$A$1`, `A1:B5`, `A:A`, `3:3`. Arguments may be separated by `,` or `;`.

`SUM` `AVERAGE` `COUNT` `COUNTA` `MIN` `MAX` `ROUND` `ABS` `INT` `SQRT` `MOD` `POWER` · `IF` `IFERROR` `AND` `OR` `NOT` ·
`CONCAT` `LEN` `UPPER` `LOWER` `TRIM` `LEFT` `RIGHT` `MID` · `SUMIF` `COUNTIF` · `VLOOKUP` `INDEX` `MATCH`

Errors follow Google Sheets: `#DIV/0!`, `#VALUE!`, `#REF!`, `#N/A`, `#NAME?`, `#NUM!`, `#ERROR!`. A circular reference
makes the cells on the cycle `#REF!`.

## Keyboard

Press <kbd>Ctrl/⌘</kbd>+<kbd>/</kbd> in the grid for the full list. The usual ones work: arrows, Tab/Enter, F2,
Ctrl+arrows, Shift+arrows, Ctrl+Z/Y, Ctrl+C/X/V (Ctrl+Shift+V values only), Ctrl+D/R fill, Ctrl+B/I/U, F4 for `$`.

## Accessibility

The grid is drawn on a canvas, so it describes itself to assistive technology in other ways:

- The grid region is a named `application` ("Spreadsheet") with a hint on how to use it.
- A polite live region announces the active cell and its displayed value on every move ("B3, 1,234.50"), the extent of a
  range selection, and when editing starts. It waits for the selection to settle, so holding an arrow key speaks the cell
  you land on rather than every cell you pass.
- Focus lives in one editor `<textarea>`; the canvas and the scroller are hidden from the accessibility tree and are not tab stops.
- Because Tab moves between cells inside the grid, <kbd>Ctrl/⌘</kbd>+<kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>↓</kbd> moves focus to the
  next control on the page and <kbd>↑</kbd> to the previous one.
- The toolbar follows the WAI-ARIA toolbar pattern (arrow keys, Home/End), menus and dialogs are keyboard operable, and
  animations stop when the system asks for reduced motion.

Not covered yet: screen-reader navigation by row and column (the canvas has no per-cell DOM), and the canvas does not adapt to
forced-colors mode. Please report what you find with your screen reader.

## Next.js and server rendering

The package is marked `'use client'`. In the App Router import it from a Client Component or from a file that starts with
`'use client'`. In the Pages Router, load it with `next/dynamic` and `{ ssr: false }` if you want to avoid server-rendering
an empty box. The grid needs a browser to draw (canvas), so nothing is drawn on the server.

## Browser support

Current Chrome, Edge, Firefox and Safari. The test suite runs on Chromium, Firefox and WebKit.

## Limits to know about

- Dates are not a separate type yet (no date series in the fill handle, no date formats).
- No merged cells, multiple sheets, charts, conditional formatting or data validation.
- Formulas refer to cells by their data position, so when the view is sorted the A1 labels do not follow the displayed order.
- The canvas theme is page-wide: two grids on one page cannot use different themes.
- Cut and copy include rows hidden with "Hide rows".

## Development

```bash
pnpm install
pnpm dev          # demo at http://localhost:5173/demo/
pnpm test         # unit tests (Vitest)
pnpm test:e2e     # Playwright on Chromium, Firefox and WebKit
pnpm typecheck && pnpm lint
pnpm build        # builds dist/ (ESM + CJS + types)
```

## License

MIT
