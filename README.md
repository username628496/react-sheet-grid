# react-sheet-grid

A spreadsheet grid for React with the feel of Google Sheets. The grid is drawn on a canvas, so a sheet of one million
rows by a hundred columns scrolls at 60 fps; editing, menus and the toolbar are ordinary DOM on top of it.

- Formulas with relative and absolute references, a dependency graph and incremental recalculation
- Undo/redo, copy/cut/paste (Excel and Google Sheets compatible), fill handle, paint format, sort, filter, insert/delete, hide, freeze, zoom
- Formatting: bold/italic/underline/strikethrough, font size, colors, borders, alignment, text wrapping, number formats
- Find and replace (with accent-insensitive search), CSV import and export
- Real dates and times (date formats, `DATE`/`TODAY`/… functions, date fill series)
- Data validation (dropdown lists, number and date rules), conditional formatting, merged cells
- Multiple sheets with formulas across them (`=Sheet2!A1`), and `.xlsx` import and export with no extra dependency
- Accessible to screen readers and the keyboard
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

A snapshot is plain JSON: cells (values and formulas as text), formatting, validation and conditional rules, merged
cells, sizes, sort/filter, frozen panes. Formulas are recalculated when it is loaded. The undo history and the selection
are not saved.

With several sheets, save `getWorkbookSnapshot()` instead (every sheet, its name and which one is active); `defaultValue`
and `load` accept either kind, so a single-sheet snapshot from an older version keeps loading.

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
| `toolbar`, `formulaBar`, `statusBar`, `sheetTabs` | `boolean` | Show or hide each bar (all `true`). |
| `dateOrder` | `'dmy' \| 'mdy'` | How an ambiguous typed date such as `3/4/2026` reads: day first (default) or month first. |
| `frozenRows`, `frozenCols` | `number` | Initial frozen panes. |
| `zoom`, `onZoomChange` | `number`, `(zoom) => void` | Zoom factor from 0.5 to 2. |
| `onChange`, `changeDelay` | | See above. |
| `onError` | `(error: Error) => void` | Called when `defaultValue` is unreadable. |
| `className`, `style` | | Applied to the outer box. |

### The ref

```ts
interface SheetGridHandle {
  sheet: Spreadsheet;                 // the sheet that is showing: read cells, run commands, subscribe
  workbook: Workbook;                 // all the sheets (add, rename, delete, reorder, find by name)
  controller: GridController | null;  // input and rendering controller (null until mounted)
  getSnapshot(): SheetSnapshot;       // the showing sheet only
  getWorkbookSnapshot(): WorkbookSnapshot;
  load(snapshot: unknown): void;      // a workbook or a single sheet; throws SnapshotError for bad data and leaves the sheet untouched
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

## Find and replace

<kbd>Ctrl/⌘</kbd>+<kbd>F</kbd> opens the panel (also the magnifier button), <kbd>Ctrl</kbd>+<kbd>H</kbd> (<kbd>⌘</kbd>+<kbd>Shift</kbd>+<kbd>H</kbd> on a Mac)
opens it with the replace row. Matches are highlighted as you type and <kbd>Enter</kbd> / <kbd>Shift</kbd>+<kbd>Enter</kbd> move between them.
Options: match case, match entire cell, **ignore accents** (so `viet` finds `Việt` and `duong` finds `Đường`), also search in
formulas, and search only the selected range. Replace works on what you would edit (typed text or the formula), as one undo step for
"Replace all". Hidden rows and rows filtered out are skipped.

```ts
const { matches } = sheet.findCells({ query: 'viet', ignoreAccents: true });
sheet.replaceInCells({ query: 'viet', ignoreAccents: true }, 'VN');   // { cells, occurrences }
```

## CSV

The toolbar's File menu imports a CSV (comma, semicolon or tab separated, detected automatically; UTF-8 or Windows-1252)
at the active cell as one undo step, and downloads the sheet as CSV, either as displayed (`$1,234.50`) or as plain values.
Downloads start with a byte order mark so Excel reads accents correctly. Text cells that begin with `=`, `+`, `-` or `@`
are written with a leading apostrophe so they cannot run as formulas when someone opens the file ("CSV injection").

The same is available without the UI:

```ts
const csv = sheet.exportCsv({ content: 'raw', delimiter: ';' });   // null if the area is too large
sheet.importCsv(text);                                              // { rows, cols } or null
sheet.transaction('My change', () => { /* several commands, one undo step */ });
```

## Sheets and workbooks

`SheetGrid` shows tabs under the grid: add, switch, rename (double-click or F2), duplicate, delete and reorder from the tab
menu. A formula can read another sheet: `=Sheet2!A1`, `=SUM('My data'!A1:A10)` (names with spaces or symbols go in quotes;
names are not case sensitive). Renaming a sheet rewrites the formulas that mention it, deleting it turns them into `#REF!`,
and inserting or deleting rows and columns in a sheet moves the references that point into it.

```ts
const { workbook } = ref.current!;
workbook.addSheet({ name: 'Totals' });
workbook.sheetByName('Data')?.setCellInput(0, 0, '42');
```

Adding, renaming, deleting and moving sheets are not part of the undo history; each sheet has its own undo. A cycle through
several sheets is not detected (the values settle after a few passes instead of showing `#REF!`).

## Excel files

The File menu opens and downloads `.xlsx`. The code behind it is its own entry point, loaded only when used (about 15 kB gzipped):

```ts
import { exportXlsx, importXlsx } from 'react-sheet-grid/xlsx';

const { data, warnings } = await exportXlsx(workbook);          // Uint8Array
const { workbook: opened, warnings: notes } = await importXlsx(await file.arrayBuffer());
```

What travels: all sheets, values, formulas (also across sheets), fonts, colors, fills, borders, alignment, wrapping, number
formats and dates, row heights and column widths, hidden rows and columns, frozen panes, merged cells, data validation
(lists, numbers, dates) and conditional formatting (value, text and blank rules). Anything that could not be carried over is
listed in `warnings`. Charts, images, comments, named ranges, tables, colour scales and print settings are dropped. A
formula using a function this grid does not have keeps its last saved value. The zip, XML and OOXML code is in this
package (it needs `CompressionStream`: Node 18+, Chrome 80+, Firefox 113+, Safari 16.4+). Files are limited in size and
checked on the way in.

## Formulas

Typed, shown and clicked references always use the rows you see: in a sorted or filtered sheet `A2` is the cell displayed
in row 2, and the formula keeps following that cell when the sheet is sorted again. A range typed over rows that sorting
or filtering has separated (so that they are no longer one block of data) is refused with `#REF!`. Clear the sort or
filter, or select the whole block.

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

- Dates are numbers shown through a date format (like Sheets and Excel); month and weekday names are English only; no time zones.
- No charts, pivot tables, comments or named ranges. Conditional formatting has no colour scales; validation has no custom formulas.
- Merged cells cannot be combined with sorting or filtering.
- Sorting and filtering are views: a formula follows its cells, not screen positions, so after a re-sort a formula range over scattered rows keeps its data rows.
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
