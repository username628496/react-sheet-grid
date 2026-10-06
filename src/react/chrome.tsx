/**
 * Styles shared by the toolbar, formula bar and status bar. They are injected once as a <style> element instead of
 * imported as a CSS file so the library stays a single JS bundle with no stylesheet for consumers to wire up.
 * Everything is scoped under `.rdg-chrome`, and the colors are variables a host app can override.
 */
const CSS = `
.rdg-chrome {
  --rdg-surface: #f8f9fb;
  --rdg-field: #ffffff;
  --rdg-border: #e1e4e8;
  --rdg-hover: #eceff3;
  --rdg-pressed: #e3ecfd;
  --rdg-accent: #1a73e8;
  --rdg-text: #1f2328;
  --rdg-muted: #656d76;
  --rdg-notice-bg: #fef3c7;
  --rdg-notice-text: #7a4b00;
  --rdg-shadow: rgba(0, 0, 0, .18);
  --rdg-on-accent: #ffffff;
  font: 13px/1.4 system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif;
  color: var(--rdg-text);
  background: var(--rdg-surface);
  box-sizing: border-box;
}
.rdg-chrome[data-rdg-theme='dark'] {
  --rdg-surface: #23262b;
  --rdg-field: #2b2f36;
  --rdg-border: #3d424b;
  --rdg-hover: #353b45;
  --rdg-pressed: #31415f;
  --rdg-accent: #8ab4f8;
  --rdg-text: #e6e8eb;
  --rdg-muted: #a3a9b3;
  --rdg-notice-bg: #4a3b12;
  --rdg-notice-text: #ffd98a;
  --rdg-shadow: rgba(0, 0, 0, .55);
  --rdg-on-accent: #10213f;
  color-scheme: dark;
}
.rdg-chrome *, .rdg-chrome *::before, .rdg-chrome *::after { box-sizing: border-box; }

.rdg-toolbar {
  display: flex; align-items: center; gap: 2px; padding: 5px 10px;
  border-bottom: 1px solid var(--rdg-border);
  overflow-x: auto; scrollbar-width: thin; white-space: nowrap;
}
.rdg-group { display: flex; align-items: center; gap: 1px; flex: none; }
.rdg-sep { width: 1px; height: 20px; margin: 0 6px; background: var(--rdg-border); flex: none; }

.rdg-btn {
  position: relative; display: inline-flex; align-items: center; justify-content: center;
  width: 30px; height: 30px; padding: 0; margin: 0; flex: none;
  border: 0; border-radius: 6px; background: transparent; color: inherit;
  cursor: pointer; transition: background-color .12s, color .12s;
}
.rdg-btn:hover:not(:disabled) { background: var(--rdg-hover); }
.rdg-btn:active:not(:disabled) { background: var(--rdg-pressed); }
.rdg-btn[aria-pressed='true'] { background: var(--rdg-pressed); color: var(--rdg-accent); }
.rdg-btn:disabled { opacity: .35; cursor: default; }
.rdg-btn:focus-visible, .rdg-select:focus-visible, .rdg-field:focus-visible {
  outline: 2px solid var(--rdg-accent); outline-offset: -2px;
}

.rdg-btn-menu { width: auto; padding: 0 3px 0 6px; gap: 0; }
.rdg-btn-menu svg:last-child { width: 12px; height: 12px; margin-left: 1px; opacity: .65; }
.rdg-btn[aria-expanded='true'] { background: var(--rdg-pressed); }
.rdg-glyph { font-size: 12px; font-weight: 600; letter-spacing: -.2px; white-space: nowrap; }
.rdg-btn:has(.rdg-glyph) { width: auto; min-width: 30px; padding: 0 6px; }

.rdg-swatch { position: absolute; left: 7px; right: 7px; bottom: 4px; height: 3px; border-radius: 2px; background: var(--rdg-swatch, #1f2328); box-shadow: 0 0 0 .5px rgba(0,0,0,.18); }
.rdg-color { position: relative; display: inline-flex; }
.rdg-color input[type='color'] { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; pointer-events: none; }
.rdg-reset {
  position: absolute; top: -2px; right: -2px; width: 14px; height: 14px; display: none;
  align-items: center; justify-content: center; padding: 0;
  border: 1px solid var(--rdg-border); border-radius: 50%; background: var(--rdg-field); color: var(--rdg-muted); cursor: pointer;
}
.rdg-reset svg { width: 8px; height: 8px; stroke-width: 3; }
.rdg-color:hover .rdg-reset, .rdg-reset:focus-visible { display: inline-flex; }

.rdg-select {
  height: 30px; padding: 0 26px 0 10px; border: 0; border-radius: 6px; color: inherit; font: inherit; cursor: pointer;
  appearance: none; -webkit-appearance: none; flex: none; min-width: 140px;
  background: transparent url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23656d76' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E") no-repeat right 8px center / 12px;
}
.rdg-select:hover { background-color: var(--rdg-hover); }

.rdg-spacer { flex: 1; min-width: 12px; }
.rdg-toolbar-wrap { position: relative; z-index: 5; }
.rdg-toolbar-wrap > .rdg-toolbar { background: var(--rdg-surface); }
.rdg-notice { position: absolute; right: 12px; top: calc(100% + 6px); padding: 5px 12px; border-radius: 14px; background: var(--rdg-notice-bg); color: var(--rdg-notice-text); font-size: 12px; box-shadow: 0 2px 8px var(--rdg-shadow); }
.rdg-count { display: inline-flex; align-items: center; gap: 6px; flex: none; margin-left: 6px; color: var(--rdg-muted); font-size: 12px; }
.rdg-count-input {
  width: 64px; height: 26px; padding: 0 8px; text-align: right; font: inherit; color: var(--rdg-text);
  font-variant-numeric: tabular-nums; border: 1px solid var(--rdg-border); border-radius: 6px; background: var(--rdg-field);
}
.rdg-fontsize { width: 40px; margin: 0 2px; text-align: center; padding: 0 2px; }
.rdg-count-input:hover { border-color: var(--rdg-muted); }
.rdg-count-input:focus { outline: 2px solid var(--rdg-accent); outline-offset: -1px; border-color: transparent; }

.rdg-formulabar { display: flex; align-items: center; gap: 0; border-bottom: 1px solid var(--rdg-border); background: var(--rdg-field); height: 30px; }
.rdg-field { height: 100%; border: 0; background: transparent; color: inherit; font: inherit; padding: 0 10px; min-width: 0; }
.rdg-field:disabled { opacity: .5; }
.rdg-namebox { width: 110px; flex: none; border-right: 1px solid var(--rdg-border); font-weight: 500; text-align: center; }
.rdg-fx { flex: none; padding: 0 10px; color: var(--rdg-muted); font-style: italic; font-family: Georgia, serif; user-select: none; }
.rdg-formula { flex: 1; }

.rdg-popup { background: var(--rdg-field); color: var(--rdg-text); border: 1px solid var(--rdg-border); border-radius: 8px; box-shadow: 0 4px 18px var(--rdg-shadow); z-index: 1000; }
.rdg-menu { position: fixed; min-width: 240px; padding: 6px 0; outline: none; }
.rdg-menuitem {
  display: flex; justify-content: space-between; gap: 24px; width: 100%; padding: 6px 16px; border: 0; background: transparent;
  color: inherit; font: inherit; text-align: left; cursor: pointer;
}
.rdg-menuitem[data-active='true']:not(:disabled), .rdg-menuitem:hover:not(:disabled) { background: var(--rdg-hover); }
.rdg-menuitem:disabled { color: var(--rdg-muted); opacity: .6; cursor: default; }
.rdg-menuitem[role='menuitemradio'] > span:first-child::before { content: ''; display: inline-block; width: 20px; }
.rdg-menuitem[aria-checked='true'] { color: var(--rdg-accent); font-weight: 600; }
.rdg-menuitem[aria-checked='true'] > span:first-child::before { content: '✓'; }
.rdg-menuitem .rdg-hint { color: var(--rdg-muted); }
.rdg-menusep { height: 1px; margin: 6px 0; background: var(--rdg-border); }
.rdg-dialog { position: fixed; padding: 14px; outline: none; }
.rdg-overlay { position: fixed; inset: 0; z-index: 1100; display: flex; align-items: center; justify-content: center; background: rgba(0, 0, 0, .38); }
.rdg-textbtn { padding: 6px 14px; border: 1px solid var(--rdg-border); border-radius: 6px; background: var(--rdg-field); color: inherit; font: inherit; cursor: pointer; }
.rdg-textbtn:hover { background: var(--rdg-hover); }
.rdg-textbtn.rdg-primary { background: var(--rdg-accent); border-color: var(--rdg-accent); color: var(--rdg-on-accent); }
.rdg-textbtn.rdg-primary:hover { filter: brightness(1.08); }
.rdg-textbtn:focus-visible, .rdg-search:focus-visible, .rdg-menuitem:focus-visible { outline: 2px solid var(--rdg-accent); outline-offset: -2px; }
.rdg-search { width: 100%; padding: 6px 8px; margin-bottom: 8px; border: 1px solid var(--rdg-border); border-radius: 6px; background: var(--rdg-field); color: inherit; font: inherit; }
.rdg-list { max-height: 220px; overflow: auto; border: 1px solid var(--rdg-border); border-radius: 6px; padding: 4px; }
.rdg-kbd { font: inherit; background: var(--rdg-hover); border-radius: 4px; padding: 1px 6px; white-space: nowrap; }
.rdg-muted { color: var(--rdg-muted); }

.rdg-find { padding: 8px 10px 6px; font-size: 13px; }
.rdg-find-row { display: flex; align-items: center; gap: 4px; margin-bottom: 6px; }
.rdg-find-row .rdg-search { margin: 0; flex: 1; min-width: 0; }
.rdg-find-gutter { width: 30px; flex: none; }
.rdg-find-count { min-width: 56px; text-align: right; color: var(--rdg-muted); font-size: 12px; white-space: nowrap; }
.rdg-find-toggle svg { transition: transform .12s; }
.rdg-find-toggle[aria-expanded='false'] svg { transform: rotate(-90deg); }
.rdg-find-options { display: flex; flex-wrap: wrap; gap: 2px 14px; padding: 2px 4px 2px 34px; }
.rdg-check { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; color: var(--rdg-text); }
.rdg-find-result { min-height: 18px; padding: 2px 4px 0 34px; font-size: 12px; color: var(--rdg-muted); }
.rdg-textbtn:disabled { opacity: .45; cursor: default; }

.rdg-sr-only { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; border: 0; }
@media (prefers-reduced-motion: reduce) {
  .rdg-chrome * { transition: none !important; animation: none !important; }
}
@media (forced-colors: active) {
  .rdg-btn, .rdg-textbtn, .rdg-select, .rdg-count-input, .rdg-field { border: 1px solid ButtonText; }
  .rdg-btn[aria-pressed='true'], .rdg-menuitem[aria-checked='true'] { outline: 2px solid Highlight; }
  .rdg-swatch { forced-color-adjust: none; }
}

.rdg-statusbar { display: flex; align-items: center; gap: 18px; min-height: 28px; padding: 0 14px; border-top: 1px solid var(--rdg-border); font-size: 12px; color: var(--rdg-muted); }
.rdg-statusbar b { color: var(--rdg-text); font-weight: 600; font-variant-numeric: tabular-nums; }
`;

/** Renders the shared stylesheet; several instances in one page just repeat identical rules. */
export function ChromeStyles() {
  return <style data-rdg-chrome>{CSS}</style>;
}
