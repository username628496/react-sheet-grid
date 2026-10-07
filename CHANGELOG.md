# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/)
and the project follows [Semantic Versioning](https://semver.org/). Before 1.0.0 minor versions may contain breaking changes.

## [Unreleased]

### Added
- Real dates and times: typed `2026-10-07`, `7/10/2026` or `14:30` become date serials (days since 1899-12-30, like Sheets/Excel) with a date format, so sorting, filtering, arithmetic and the fill series work on them.
- Date formats (`yyyy-mm-dd`, `dd/mm/yyyy`, `d mmm yyyy`, `hh:mm`, ...) in the "More formats" menu; `dateOrder` prop (`'dmy'` default, `'mdy'`) decides how `3/4/2026` reads.
- Fill series for dates (daily, monthly, yearly); `COUNTIF`/`SUMIF` criteria and arithmetic accept date text.
- Data validation: dropdown lists, number and date rules, reject or warn; dialog (toolbar, context menu), red corner on invalid cells, dropdown arrow and Alt+Down for lists; `sheet.setValidation`, `sheet.isInvalid`; `setCellInput` now returns whether the edit was accepted; new notice `validationRejected`. Rules live in the cell style, so they follow sort, copy/paste, insert/delete and snapshots.
- Conditional formatting: rules on number/date/text/blank conditions set the text or fill color (first match wins, up to 8 per cell); dialog from toolbar and context menu; `sheet.setConditionalRules`. Rules live in the cell style like validation.
- Merge cells: toolbar button and context menu, `sheet.mergeSelection` / `unmergeSelection` / `merges`. The block keeps the top-left content; selection, arrow keys, Tab/Enter, the editor and drawing treat it as one cell; blocks follow row/column insert and delete and are saved in snapshots (`merges`). Sorting or filtering a sheet with merged cells is refused (notice `mergeConflict`), as in Sheets.
- Functions: `TODAY`, `NOW`, `DATE`, `DATEVALUE`, `YEAR`, `MONTH`, `DAY`, `HOUR`, `MINUTE`, `SECOND`, `WEEKDAY`, `EDATE`, `EOMONTH`, `DAYS`.

## [0.2.0] - 2026-10-06

### Added
- Cell borders: Borders menu (all, outer, inner, horizontal, vertical, each side, clear), line style (thin, medium, thick, dashed, dotted) and color; `sheet.applyBorders`.

- Font size (toolbar box, +/- buttons, Ctrl/⌘+Shift+, and .), text wrapping (overflow / wrap / clip), vertical alignment; rows are fitted to their content when the font size or wrapping changes and on a double-click of the row border.
- Find and replace (panel, highlighting, accent-insensitive search, `sheet.findCells` / `replaceInCells`, `findInText`).
- CSV import/export (File menu, `sheet.exportCsv`/`importCsv`, `parseCsv`/`toCsv`), `sheet.transaction` to group commands into one undo step.
- Accessibility: named `application` region with usage hint, live region announcing the active cell/selection/editing,
  keyboard way out of the grid (Ctrl/⌘+Alt+Shift+↓/↑), canvas and scroller hidden from the accessibility tree,
  reduced-motion and forced-colors styles, localized editor label.

### Fixed
- Copying a cell that has formatting but no value (a border, a fill) and pasting it now carries the formatting.

## [0.1.1] - 2026-10-06

### Changed
- Package metadata: repository, homepage and bug tracker links.

## [0.1.0] - 2026-10-06

First public version.

### Added
- Canvas-rendered grid (1,000,000 × 100 at 60 fps), frozen panes, zoom 50–200%, hide/show rows and columns.
- Cell editing with IME support, formula bar with name box, formulas (30 functions), undo/redo.
- Copy/cut/paste compatible with Excel and Google Sheets, fill handle, paint format, sort, filter, insert/delete.
- Toolbar, status bar, context menu, keyboard shortcuts help.
- `SheetGrid` component, `readOnly`, `onChange`, snapshots (`serializeSheet`/`deserializeSheet`).
- English and Vietnamese UI, light/dark/auto theme.
