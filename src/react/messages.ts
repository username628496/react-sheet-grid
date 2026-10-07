export type Locale = 'en' | 'vi';

export interface ShortcutGroup {
  title: string;
  items: ReadonlyArray<readonly [keys: string, action: string]>;
}

/**
 * Every string the UI shows. Functions take the numbers/names that vary so each language decides its own grammar
 * (English pluralises, Vietnamese does not). Hosts can override single entries through GridProvider's `messages`.
 */
export interface Messages {
  // accessibility
  a11yLabel: string;
  a11yRoleDescription: string;
  a11yHint: string;
  a11yEditorLabel: string;
  a11yCell: (address: string, text: string, kind: 'text' | 'formula' | 'empty') => string;
  a11yRange: (from: string, to: string, cells: number, active: string) => string;
  a11yEditing: (address: string) => string;
  // toolbar
  toolbar: string;
  groupHistory: string;
  groupSort: string;
  groupTextStyle: string;
  groupAlignment: string;
  borders: string;
  borderColor: string;
  borderAll: string;
  borderOuter: string;
  borderInner: string;
  borderHorizontal: string;
  borderVertical: string;
  borderTop: string;
  borderBottom: string;
  borderLeft: string;
  borderRight: string;
  borderNone: string;
  borderThin: string;
  borderMedium: string;
  borderThick: string;
  borderDashed: string;
  borderDotted: string;
  formatTooLarge: (limit: number) => string;
  groupFont: string;
  fontSize: string;
  decreaseFontSize: string;
  increaseFontSize: string;
  textWrapping: string;
  wrapOverflow: string;
  wrapWrap: string;
  wrapClip: string;
  verticalAlign: string;
  alignTop: string;
  alignMiddle: string;
  alignBottom: string;
  groupSheetSize: string;
  undo: string;
  redo: string;
  clearFormatting: string;
  sortAsc: string;
  sortDesc: string;
  bold: string;
  italic: string;
  underline: string;
  strike: string;
  textColor: string;
  fillColor: string;
  resetColor: (what: string) => string;
  colorPicker: (what: string) => string;
  alignLeft: string;
  alignCenter: string;
  alignRight: string;
  numberFormat: string;
  formatAutomatic: string;
  formatNumber: (example: string) => string;
  formatPercent: (example: string) => string;
  formatCurrency: (example: string) => string;
  groupClipboard: string;
  groupNumber: string;
  groupStructure: string;
  pasteValues: string;
  pasteFormat: string;
  paintFormat: string;
  filter: string;
  removeSortAndFilters: string;
  formatCurrencyButton: string;
  formatPercentButton: string;
  decreaseDecimals: string;
  increaseDecimals: string;
  moreFormats: string;
  formatEuro: (example: string) => string;
  formatDong: (example: string) => string;
  formatDate: (example: string) => string;
  formatTime: (example: string) => string;
  formatDateTime: (example: string) => string;
  insert: string;
  delete: string;
  freeze: string;
  noFrozenRows: string;
  noFrozenCols: string;
  freezeRows: (n: number) => string;
  freezeCols: (n: number) => string;
  freezeUpToRow: (n: number) => string;
  freezeUpToCol: (col: string) => string;
  functions: string;
  zoom: string;
  visibility: string;
  hideRows: (first: number, last: number) => string;
  hideCols: (first: string, last: string) => string;
  showHiddenRows: string;
  showHiddenCols: string;
  fnSum: string;
  fnAverage: string;
  fnCount: string;
  fnMax: string;
  fnMin: string;
  rowsLabel: string;
  colsLabel: string;
  rowCount: string;
  colCount: string;
  removedCells: (n: number) => string;
  pasteTooLarge: (limit: number) => string;
  findAndReplace: string;
  find: string;
  replaceWith: string;
  matchCase: string;
  matchWholeCell: string;
  searchInFormulas: string;
  ignoreAccents: string;
  searchIn: string;
  scopeSheet: string;
  scopeSelection: string;
  previousMatch: string;
  nextMatch: string;
  replace: string;
  replaceAll: string;
  showReplace: string;
  findCount: (current: number, total: number, more: boolean) => string;
  findNoResults: string;
  replacedSummary: (occurrences: number, cells: number) => string;
  exportTooLarge: (limit: number) => string;
  file: string;
  importCsv: string;
  exportCsvDisplayed: string;
  exportCsvRaw: string;
  importEmpty: string;
  importTooBig: string;
  errorTitle: string;
  errorRetry: string;
  // formula bar
  nameBox: string;
  formulaBar: string;
  // status bar
  selectionSummary: string;
  sum: string;
  average: string;
  count: string;
  // context menu
  cellMenu: string;
  cut: string;
  copy: string;
  paste: string;
  insertRowsAbove: (n: number) => string;
  insertRowsBelow: (n: number) => string;
  insertColsLeft: (n: number) => string;
  insertColsRight: (n: number) => string;
  deleteRows: (first: number, last: number) => string;
  deleteCols: (first: string, last: string) => string;
  clearContents: string;
  sortSheetAsc: (col: string) => string;
  sortSheetDesc: (col: string) => string;
  removeSort: string;
  filterByValues: (col: string) => string;
  removeFilter: (col: string) => string;
  removeAllFilters: string;
  // filter dialog
  filterTitle: (col: string) => string;
  search: string;
  searchValues: string;
  selectAll: string;
  clear: string;
  noValues: string;
  blanks: string;
  onlyFirstValues: (n: number) => string;
  cancel: string;
  ok: string;
  close: string;
  // shortcuts dialog
  shortcutsTitle: string;
  shortcutGroups: readonly ShortcutGroup[];
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

const en: Messages = {
  a11yLabel: 'Spreadsheet',
  a11yRoleDescription: 'spreadsheet',
  a11yHint: 'Use the arrow keys to move between cells, F2 to edit, and Ctrl or Command plus slash for all shortcuts. Press Ctrl+Alt+Shift+Down arrow to leave the spreadsheet.',
  a11yEditorLabel: 'Cell editor',
  a11yCell: (address, text, kind) => (kind === 'empty' ? `${address}, empty` : `${address}, ${text}${kind === 'formula' ? ', formula' : ''}`),
  a11yRange: (from, to, cells, active) => `Selected ${from} to ${to}, ${plural(cells, 'cell', 'cells')}. Active cell ${active}`,
  a11yEditing: (address) => `Editing ${address}`,
  toolbar: 'Formatting',
  groupHistory: 'History',
  groupSort: 'Sort',
  groupTextStyle: 'Text style',
  groupAlignment: 'Alignment',
  borders: 'Borders',
  borderColor: 'Border color',
  borderAll: 'All borders',
  borderOuter: 'Outer borders',
  borderInner: 'Inner borders',
  borderHorizontal: 'Horizontal borders',
  borderVertical: 'Vertical borders',
  borderTop: 'Top border',
  borderBottom: 'Bottom border',
  borderLeft: 'Left border',
  borderRight: 'Right border',
  borderNone: 'Clear borders',
  borderThin: 'Thin line',
  borderMedium: 'Medium line',
  borderThick: 'Thick line',
  borderDashed: 'Dashed line',
  borderDotted: 'Dotted line',
  formatTooLarge: (limit) => `That range is too large to format this way (over ${limit.toLocaleString('en-US')} cells). Select a smaller range.`,
  groupFont: 'Font',
  fontSize: 'Font size',
  decreaseFontSize: 'Decrease font size',
  increaseFontSize: 'Increase font size',
  textWrapping: 'Text wrapping',
  wrapOverflow: 'Overflow into empty cells',
  wrapWrap: 'Wrap',
  wrapClip: 'Clip',
  verticalAlign: 'Vertical align',
  alignTop: 'Top',
  alignMiddle: 'Middle',
  alignBottom: 'Bottom',
  groupSheetSize: 'Sheet size',
  undo: 'Undo',
  redo: 'Redo',
  clearFormatting: 'Clear formatting',
  sortAsc: 'Sort A to Z',
  sortDesc: 'Sort Z to A',
  bold: 'Bold',
  italic: 'Italic',
  underline: 'Underline',
  strike: 'Strikethrough',
  textColor: 'Text color',
  fillColor: 'Fill color',
  resetColor: (what) => `Reset ${what.toLowerCase()}`,
  colorPicker: (what) => `${what} picker`,
  alignLeft: 'Align left',
  alignCenter: 'Align center',
  alignRight: 'Align right',
  numberFormat: 'Number format',
  formatAutomatic: 'Automatic',
  formatNumber: (example) => `Number (${example})`,
  formatPercent: (example) => `Percent (${example})`,
  formatCurrency: (example) => `Currency (${example})`,
  groupClipboard: 'Clipboard',
  groupNumber: 'Number',
  groupStructure: 'Rows and columns',
  pasteValues: 'Paste values only',
  pasteFormat: 'Paste format only',
  paintFormat: 'Paint format',
  filter: 'Filter by values',
  removeSortAndFilters: 'Remove sort and filters',
  formatCurrencyButton: 'Format as currency',
  formatPercentButton: 'Format as percent',
  decreaseDecimals: 'Decrease decimal places',
  increaseDecimals: 'Increase decimal places',
  moreFormats: 'More formats',
  formatEuro: (example) => `Euro (${example})`,
  formatDong: (example) => `Dong (${example})`,
  formatDate: (example) => `Date (${example})`,
  formatTime: (example) => `Time (${example})`,
  formatDateTime: (example) => `Date time (${example})`,
  insert: 'Insert',
  delete: 'Delete',
  freeze: 'Freeze',
  noFrozenRows: 'No frozen rows',
  noFrozenCols: 'No frozen columns',
  freezeRows: (n) => `${n === 1 ? '1 row' : `${n} rows`}`,
  freezeCols: (n) => `${n === 1 ? '1 column' : `${n} columns`}`,
  freezeUpToRow: (n) => `Up to row ${n}`,
  freezeUpToCol: (col) => `Up to column ${col}`,
  functions: 'Functions',
  zoom: 'Zoom',
  visibility: 'Show or hide',
  hideRows: (a, b) => (a === b ? `Hide row ${a}` : `Hide rows ${a}–${b}`),
  hideCols: (a, b) => (a === b ? `Hide column ${a}` : `Hide columns ${a}–${b}`),
  showHiddenRows: 'Show hidden rows',
  showHiddenCols: 'Show hidden columns',
  fnSum: 'SUM',
  fnAverage: 'AVERAGE',
  fnCount: 'COUNT',
  fnMax: 'MAX',
  fnMin: 'MIN',
  rowsLabel: 'Rows',
  colsLabel: 'Cols',
  rowCount: 'Row count',
  colCount: 'Column count',
  removedCells: (n) => `Removed ${plural(n, 'filled cell', 'filled cells')}. Undo to restore.`,
  pasteTooLarge: (limit) => `That is too much to paste at once (over ${limit.toLocaleString('en-US')} cells). Nothing was pasted.`,
  findAndReplace: 'Find and replace',
  find: 'Find',
  replaceWith: 'Replace with',
  matchCase: 'Match case',
  matchWholeCell: 'Match entire cell',
  searchInFormulas: 'Also search in formulas',
  ignoreAccents: 'Ignore accents (viet finds Việt)',
  searchIn: 'Search in',
  scopeSheet: 'This sheet',
  scopeSelection: 'Selected range',
  previousMatch: 'Previous result',
  nextMatch: 'Next result',
  replace: 'Replace',
  replaceAll: 'Replace all',
  showReplace: 'Show replace options',
  findCount: (current, total, more) => `${current} of ${total.toLocaleString('en-US')}${more ? '+' : ''}`,
  findNoResults: 'No results',
  replacedSummary: (occurrences, cells) => `Replaced ${plural(occurrences, 'occurrence', 'occurrences')} in ${plural(cells, 'cell', 'cells')}`,
  exportTooLarge: (limit) => `That is too large to export (over ${limit.toLocaleString('en-US')} cells). Select a smaller range.`,
  file: 'File',
  importCsv: 'Import CSV…',
  exportCsvDisplayed: 'Download as CSV (as displayed)',
  exportCsvRaw: 'Download as CSV (plain values)',
  importEmpty: 'The file has no data to import.',
  importTooBig: 'That file is too large to import (over 50 MB).',
  errorTitle: 'Something went wrong in the spreadsheet.',
  errorRetry: 'Try again',
  nameBox: 'Name box',
  formulaBar: 'Formula bar',
  selectionSummary: 'Selection summary',
  sum: 'Sum',
  average: 'Average',
  count: 'Count',
  cellMenu: 'Cell menu',
  cut: 'Cut',
  copy: 'Copy',
  paste: 'Paste',
  insertRowsAbove: (n) => `Insert ${plural(n, 'row', 'rows')} above`,
  insertRowsBelow: (n) => `Insert ${plural(n, 'row', 'rows')} below`,
  insertColsLeft: (n) => `Insert ${plural(n, 'column', 'columns')} left`,
  insertColsRight: (n) => `Insert ${plural(n, 'column', 'columns')} right`,
  deleteRows: (a, b) => (a === b ? `Delete row ${a}` : `Delete rows ${a}–${b}`),
  deleteCols: (a, b) => (a === b ? `Delete column ${a}` : `Delete columns ${a}–${b}`),
  clearContents: 'Clear contents',
  sortSheetAsc: (col) => `Sort sheet by column ${col}, A → Z`,
  sortSheetDesc: (col) => `Sort sheet by column ${col}, Z → A`,
  removeSort: 'Remove sort',
  filterByValues: (col) => `Filter column ${col} by values…`,
  removeFilter: (col) => `Remove filter on column ${col}`,
  removeAllFilters: 'Remove all filters',
  filterTitle: (col) => `Filter column ${col} by values`,
  search: 'Search',
  searchValues: 'Search values',
  selectAll: 'Select all',
  clear: 'Clear',
  noValues: 'No values',
  blanks: '(Blanks)',
  onlyFirstValues: (n) => `Only the first ${n} values are listed.`,
  cancel: 'Cancel',
  ok: 'OK',
  close: 'Close',
  shortcutsTitle: 'Keyboard shortcuts',
  shortcutGroups: [
    {
      title: 'Navigate and select',
      items: [
        ['Arrows', 'Move one cell'],
        ['Mod+Arrows', 'Jump to the edge of the data block'],
        ['Shift+Arrows', 'Extend the selection'],
        ['Tab / Shift+Tab', 'Move right / left'],
        ['Enter / Shift+Enter', 'Edit the cell / move up'],
        ['Home / End', 'Start / end of the row'],
        ['Mod+Home / Mod+End', 'First cell / last cell with data'],
        ['PageUp / PageDown', 'Move one page'],
        ['Mod+A', 'Select all'],
        ['Mod+Space / Shift+Space', 'Select column / row'],
        ['Mod+Backspace', 'Scroll to the active cell'],
      ],
    },
    {
      title: 'Edit',
      items: [
        ['F2', 'Edit the cell, caret at the end'],
        ['Enter / Tab / Esc', 'Save and move down / save and move right / cancel'],
        ['Alt+Enter', 'New line in the cell'],
        ['Mod+Enter', 'Fill the selection with what you typed'],
        ['Delete', 'Clear contents'],
        ['Mod+Z / Mod+Y', 'Undo / redo'],
        ['Mod+D / Mod+R', 'Fill down / fill right'],
        ['Mod+F / Ctrl+H (Cmd+Shift+H)', 'Find / find and replace'],
        ['Mod+Alt+9 / Mod+Alt+0', 'Hide rows / hide columns'],
        ['Mod+Shift+9 / Mod+Shift+0', 'Show hidden rows / columns'],
      ],
    },
    {
      title: 'Formulas',
      items: [
        ['Arrows or click after = ( , +', 'Point at a cell'],
        ['Shift+Arrows or drag', 'Point at a range'],
        ['F4', 'Toggle $ on the reference at the caret'],
      ],
    },
    {
      title: 'Clipboard',
      items: [
        ['Mod+C / Mod+X / Mod+V', 'Copy / cut / paste'],
        ['Mod+Shift+V', 'Paste values only'],
        ['Mod+Alt+V', 'Paste format only'],
      ],
    },
    {
      title: 'Format',
      items: [
        ['Mod+B / Mod+I / Mod+U', 'Bold / italic / underline'],
        ['Mod+Shift+, / Mod+Shift+.', 'Decrease / increase font size'],
        ['Mod+Shift+X', 'Strikethrough'],
        ['Mod+Shift+L / E / R', 'Align left / center / right'],
        ['Mod+Shift+1 / 4 / 5', 'Number / currency / percent'],
        ['Mod+\\', 'Clear formatting'],
      ],
    },
    { title: 'Help', items: [['Mod+/', 'Show this list'], ['Mod+Alt+Shift+Down / Up', 'Leave the grid: focus the next / previous control on the page']] },
  ],
};

const vi: Messages = {
  a11yLabel: 'Bảng tính',
  a11yRoleDescription: 'bảng tính',
  a11yHint: 'Dùng phím mũi tên để di chuyển giữa các ô, F2 để sửa, Ctrl hoặc Command cùng dấu gạch chéo để xem mọi phím tắt. Nhấn Ctrl+Alt+Shift+mũi tên xuống để thoát khỏi bảng tính.',
  a11yEditorLabel: 'Ô soạn thảo',
  a11yCell: (address, text, kind) => (kind === 'empty' ? `${address}, trống` : `${address}, ${text}${kind === 'formula' ? ', công thức' : ''}`),
  a11yRange: (from, to, cells, active) => `Đã chọn ${from} đến ${to}, ${cells} ô. Ô đang chọn ${active}`,
  a11yEditing: (address) => `Đang sửa ${address}`,
  toolbar: 'Định dạng',
  groupHistory: 'Lịch sử',
  groupSort: 'Sắp xếp',
  groupTextStyle: 'Kiểu chữ',
  groupAlignment: 'Căn lề',
  borders: 'Viền',
  borderColor: 'Màu viền',
  borderAll: 'Tất cả đường viền',
  borderOuter: 'Viền ngoài',
  borderInner: 'Viền trong',
  borderHorizontal: 'Viền ngang',
  borderVertical: 'Viền dọc',
  borderTop: 'Viền trên',
  borderBottom: 'Viền dưới',
  borderLeft: 'Viền trái',
  borderRight: 'Viền phải',
  borderNone: 'Xóa viền',
  borderThin: 'Nét mảnh',
  borderMedium: 'Nét vừa',
  borderThick: 'Nét dày',
  borderDashed: 'Nét gạch',
  borderDotted: 'Nét chấm',
  formatTooLarge: (limit) => `Vùng này quá lớn để định dạng kiểu này (hơn ${limit.toLocaleString('vi-VN')} ô). Hãy chọn vùng nhỏ hơn.`,
  groupFont: 'Phông chữ',
  fontSize: 'Cỡ chữ',
  decreaseFontSize: 'Giảm cỡ chữ',
  increaseFontSize: 'Tăng cỡ chữ',
  textWrapping: 'Xuống dòng',
  wrapOverflow: 'Tràn sang ô trống',
  wrapWrap: 'Xuống dòng tự động',
  wrapClip: 'Cắt bớt',
  verticalAlign: 'Căn dọc',
  alignTop: 'Trên',
  alignMiddle: 'Giữa',
  alignBottom: 'Dưới',
  groupSheetSize: 'Kích thước bảng',
  undo: 'Hoàn tác',
  redo: 'Làm lại',
  clearFormatting: 'Xóa định dạng',
  sortAsc: 'Sắp xếp A → Z',
  sortDesc: 'Sắp xếp Z → A',
  bold: 'Đậm',
  italic: 'Nghiêng',
  underline: 'Gạch chân',
  strike: 'Gạch ngang',
  textColor: 'Màu chữ',
  fillColor: 'Màu nền',
  resetColor: (what) => `Bỏ ${what.toLowerCase()}`,
  colorPicker: (what) => `Chọn ${what.toLowerCase()}`,
  alignLeft: 'Căn trái',
  alignCenter: 'Căn giữa',
  alignRight: 'Căn phải',
  numberFormat: 'Định dạng số',
  formatAutomatic: 'Tự động',
  formatNumber: (example) => `Số (${example})`,
  formatPercent: (example) => `Phần trăm (${example})`,
  formatCurrency: (example) => `Tiền tệ (${example})`,
  groupClipboard: 'Bộ nhớ tạm',
  groupNumber: 'Số',
  groupStructure: 'Dòng và cột',
  pasteValues: 'Chỉ dán giá trị',
  pasteFormat: 'Chỉ dán định dạng',
  paintFormat: 'Sao chép định dạng',
  filter: 'Lọc theo giá trị',
  removeSortAndFilters: 'Bỏ sắp xếp và bộ lọc',
  formatCurrencyButton: 'Định dạng tiền tệ',
  formatPercentButton: 'Định dạng phần trăm',
  decreaseDecimals: 'Giảm số thập phân',
  increaseDecimals: 'Tăng số thập phân',
  moreFormats: 'Định dạng khác',
  formatEuro: (example) => `Euro (${example})`,
  formatDong: (example) => `Đồng (${example})`,
  formatDate: (example) => `Ngày (${example})`,
  formatTime: (example) => `Giờ (${example})`,
  formatDateTime: (example) => `Ngày giờ (${example})`,
  insert: 'Chèn',
  delete: 'Xóa',
  freeze: 'Cố định',
  noFrozenRows: 'Không cố định dòng',
  noFrozenCols: 'Không cố định cột',
  freezeRows: (n) => `${n} dòng`,
  freezeCols: (n) => `${n} cột`,
  freezeUpToRow: (n) => `Đến dòng ${n}`,
  freezeUpToCol: (col) => `Đến cột ${col}`,
  functions: 'Hàm',
  zoom: 'Thu phóng',
  visibility: 'Hiện hoặc ẩn',
  hideRows: (a, b) => (a === b ? `Ẩn dòng ${a}` : `Ẩn dòng ${a}–${b}`),
  hideCols: (a, b) => (a === b ? `Ẩn cột ${a}` : `Ẩn cột ${a}–${b}`),
  showHiddenRows: 'Hiện các dòng đã ẩn',
  showHiddenCols: 'Hiện các cột đã ẩn',
  fnSum: 'SUM (tổng)',
  fnAverage: 'AVERAGE (trung bình)',
  fnCount: 'COUNT (đếm số)',
  fnMax: 'MAX (lớn nhất)',
  fnMin: 'MIN (nhỏ nhất)',
  rowsLabel: 'Dòng',
  colsLabel: 'Cột',
  rowCount: 'Số dòng',
  colCount: 'Số cột',
  removedCells: (n) => `Đã xóa ${n} ô có dữ liệu. Nhấn hoàn tác để khôi phục.`,
  pasteTooLarge: (limit) => `Dữ liệu dán quá lớn (hơn ${limit.toLocaleString('vi-VN')} ô). Chưa dán gì cả.`,
  findAndReplace: 'Tìm và thay thế',
  find: 'Tìm',
  replaceWith: 'Thay bằng',
  matchCase: 'Phân biệt hoa thường',
  matchWholeCell: 'Khớp toàn bộ ô',
  searchInFormulas: 'Tìm cả trong công thức',
  ignoreAccents: 'Bỏ qua dấu (viet tìm ra Việt)',
  searchIn: 'Tìm trong',
  scopeSheet: 'Toàn bộ bảng',
  scopeSelection: 'Vùng đang chọn',
  previousMatch: 'Kết quả trước',
  nextMatch: 'Kết quả sau',
  replace: 'Thay thế',
  replaceAll: 'Thay tất cả',
  showReplace: 'Hiện tùy chọn thay thế',
  findCount: (current, total, more) => `${current} / ${total.toLocaleString('vi-VN')}${more ? '+' : ''}`,
  findNoResults: 'Không có kết quả',
  replacedSummary: (occurrences, cells) => `Đã thay ${occurrences} chỗ trong ${cells} ô`,
  exportTooLarge: (limit) => `Vùng này quá lớn để xuất (hơn ${limit.toLocaleString('vi-VN')} ô). Hãy chọn vùng nhỏ hơn.`,
  file: 'Tệp',
  importCsv: 'Nhập CSV…',
  exportCsvDisplayed: 'Tải xuống CSV (như đang hiển thị)',
  exportCsvRaw: 'Tải xuống CSV (giá trị thô)',
  importEmpty: 'Tệp không có dữ liệu để nhập.',
  importTooBig: 'Tệp quá lớn để nhập (hơn 50 MB).',
  errorTitle: 'Bảng tính gặp sự cố.',
  errorRetry: 'Thử lại',
  nameBox: 'Ô tên',
  formulaBar: 'Thanh công thức',
  selectionSummary: 'Tóm tắt vùng chọn',
  sum: 'Tổng',
  average: 'Trung bình',
  count: 'Đếm',
  cellMenu: 'Menu ô',
  cut: 'Cắt',
  copy: 'Sao chép',
  paste: 'Dán',
  insertRowsAbove: (n) => `Chèn ${n} dòng phía trên`,
  insertRowsBelow: (n) => `Chèn ${n} dòng phía dưới`,
  insertColsLeft: (n) => `Chèn ${n} cột bên trái`,
  insertColsRight: (n) => `Chèn ${n} cột bên phải`,
  deleteRows: (a, b) => (a === b ? `Xóa dòng ${a}` : `Xóa dòng ${a}–${b}`),
  deleteCols: (a, b) => (a === b ? `Xóa cột ${a}` : `Xóa cột ${a}–${b}`),
  clearContents: 'Xóa nội dung',
  sortSheetAsc: (col) => `Sắp xếp bảng theo cột ${col}, A → Z`,
  sortSheetDesc: (col) => `Sắp xếp bảng theo cột ${col}, Z → A`,
  removeSort: 'Bỏ sắp xếp',
  filterByValues: (col) => `Lọc cột ${col} theo giá trị…`,
  removeFilter: (col) => `Bỏ lọc cột ${col}`,
  removeAllFilters: 'Bỏ tất cả bộ lọc',
  filterTitle: (col) => `Lọc cột ${col} theo giá trị`,
  search: 'Tìm kiếm',
  searchValues: 'Tìm giá trị',
  selectAll: 'Chọn tất cả',
  clear: 'Bỏ chọn',
  noValues: 'Không có giá trị',
  blanks: '(Ô trống)',
  onlyFirstValues: (n) => `Chỉ liệt kê ${n} giá trị đầu tiên.`,
  cancel: 'Hủy',
  ok: 'OK',
  close: 'Đóng',
  shortcutsTitle: 'Phím tắt',
  shortcutGroups: [
    {
      title: 'Di chuyển và chọn',
      items: [
        ['Arrows', 'Di chuyển một ô'],
        ['Mod+Arrows', 'Nhảy tới mép khối dữ liệu'],
        ['Shift+Arrows', 'Mở rộng vùng chọn'],
        ['Tab / Shift+Tab', 'Sang phải / sang trái'],
        ['Enter / Shift+Enter', 'Sửa ô / lên trên'],
        ['Home / End', 'Đầu / cuối dòng'],
        ['Mod+Home / Mod+End', 'Ô đầu tiên / ô cuối có dữ liệu'],
        ['PageUp / PageDown', 'Lên / xuống một trang'],
        ['Mod+A', 'Chọn tất cả'],
        ['Mod+Space / Shift+Space', 'Chọn cột / chọn dòng'],
        ['Mod+Backspace', 'Cuộn tới ô đang chọn'],
      ],
    },
    {
      title: 'Chỉnh sửa',
      items: [
        ['F2', 'Sửa ô, con trỏ ở cuối'],
        ['Enter / Tab / Esc', 'Lưu và xuống dưới / lưu và sang phải / hủy'],
        ['Alt+Enter', 'Xuống dòng trong ô'],
        ['Mod+Enter', 'Điền nội dung vừa gõ vào cả vùng chọn'],
        ['Delete', 'Xóa nội dung'],
        ['Mod+Z / Mod+Y', 'Hoàn tác / làm lại'],
        ['Mod+D / Mod+R', 'Điền xuống / điền sang phải'],
        ['Mod+F / Ctrl+H (Cmd+Shift+H)', 'Tìm / tìm và thay thế'],
        ['Mod+Alt+9 / Mod+Alt+0', 'Ẩn dòng / ẩn cột'],
        ['Mod+Shift+9 / Mod+Shift+0', 'Hiện dòng đã ẩn / cột đã ẩn'],
      ],
    },
    {
      title: 'Công thức',
      items: [
        ['Arrows hoặc click sau = ( , +', 'Trỏ vào một ô'],
        ['Shift+Arrows hoặc kéo', 'Trỏ vào một vùng'],
        ['F4', 'Bật/tắt $ cho tham chiếu tại con trỏ'],
      ],
    },
    {
      title: 'Bộ nhớ tạm',
      items: [
        ['Mod+C / Mod+X / Mod+V', 'Sao chép / cắt / dán'],
        ['Mod+Shift+V', 'Chỉ dán giá trị'],
        ['Mod+Alt+V', 'Chỉ dán định dạng'],
      ],
    },
    {
      title: 'Định dạng',
      items: [
        ['Mod+B / Mod+I / Mod+U', 'Đậm / nghiêng / gạch chân'],
        ['Mod+Shift+, / Mod+Shift+.', 'Giảm / tăng cỡ chữ'],
        ['Mod+Shift+X', 'Gạch ngang'],
        ['Mod+Shift+L / E / R', 'Căn trái / giữa / phải'],
        ['Mod+Shift+1 / 4 / 5', 'Số / tiền tệ / phần trăm'],
        ['Mod+\\', 'Xóa định dạng'],
      ],
    },
    { title: 'Trợ giúp', items: [['Mod+/', 'Hiện danh sách này'], ['Mod+Alt+Shift+Down / Up', 'Thoát khỏi bảng: chuyển tới điều khiển kế tiếp / trước đó trên trang']] },
  ],
};

export const MESSAGES: Readonly<Record<Locale, Messages>> = { en, vi };

export function resolveMessages(locale: Locale, overrides?: Partial<Messages>): Messages {
  return overrides === undefined ? MESSAGES[locale] : { ...MESSAGES[locale], ...overrides };
}
