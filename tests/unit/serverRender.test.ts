import { createElement, Fragment } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FormulaBar, GridProvider, SheetGrid, Spreadsheet, StatusBar, Toolbar } from '../../src/index';

// Next.js (and any SSR setup) renders client components once on the server, where there is no window, no document and
// no layout. Rendering must not throw there; the grid itself only comes alive in the browser.
describe('server-side rendering', () => {
  it('renders SheetGrid to markup without a DOM', () => {
    expect(typeof window).toBe('undefined');
    const html = renderToString(createElement(SheetGrid, { rowCount: 20, colCount: 5 }));
    expect(html).toContain('role="toolbar"');
    expect(html).toContain('data-testid="formula-bar"');
    expect(html).toContain('data-testid="status-bar"');
  });

  it('renders every part on its own, in both languages and both themes', () => {
    const sheet = new Spreadsheet({ rowCount: 10, colCount: 4 });
    sheet.setCellInput(0, 0, '5');
    for (const locale of ['en', 'vi'] as const) {
      for (const theme of ['light', 'dark', 'auto'] as const) {
        const html = renderToString(
          createElement(GridProvider, {
            locale,
            theme,
            children: createElement(
              Fragment,
              null,
              createElement(Toolbar, { sheet }),
              createElement(FormulaBar, { sheet, grid: null }),
              createElement(StatusBar, { sheet }),
            ),
          }),
        );
        expect(html.length).toBeGreaterThan(500);
      }
    }
  });

  it('renders a read-only sheet and a restored one', () => {
    const html = renderToString(createElement(SheetGrid, { readOnly: true, toolbar: false, statusBar: false }));
    expect(html).toContain('data-testid="formula-bar"');
    expect(html).not.toContain('role="toolbar"');
  });
});
