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
  font: 13px/1.4 system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif;
  color: var(--rdg-text);
  background: var(--rdg-surface);
  box-sizing: border-box;
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
.rdg-notice { position: absolute; right: 12px; top: calc(100% + 6px); padding: 5px 12px; border-radius: 14px; background: #fef3c7; color: #7a4b00; font-size: 12px; box-shadow: 0 2px 8px rgba(0,0,0,.15); }
.rdg-count { display: inline-flex; align-items: center; gap: 6px; flex: none; margin-left: 6px; color: var(--rdg-muted); font-size: 12px; }
.rdg-count-input {
  width: 64px; height: 26px; padding: 0 8px; text-align: right; font: inherit; color: var(--rdg-text);
  font-variant-numeric: tabular-nums; border: 1px solid var(--rdg-border); border-radius: 6px; background: var(--rdg-field);
}
.rdg-count-input:hover { border-color: #c4c9d0; }
.rdg-count-input:focus { outline: 2px solid var(--rdg-accent); outline-offset: -1px; border-color: transparent; }

.rdg-formulabar { display: flex; align-items: center; gap: 0; border-bottom: 1px solid var(--rdg-border); background: var(--rdg-field); height: 30px; }
.rdg-field { height: 100%; border: 0; background: transparent; color: inherit; font: inherit; padding: 0 10px; min-width: 0; }
.rdg-field:disabled { opacity: .5; }
.rdg-namebox { width: 110px; flex: none; border-right: 1px solid var(--rdg-border); font-weight: 500; text-align: center; }
.rdg-fx { flex: none; padding: 0 10px; color: var(--rdg-muted); font-style: italic; font-family: Georgia, serif; user-select: none; }
.rdg-formula { flex: 1; }

.rdg-statusbar { display: flex; align-items: center; gap: 18px; min-height: 28px; padding: 0 14px; border-top: 1px solid var(--rdg-border); font-size: 12px; color: var(--rdg-muted); }
.rdg-statusbar b { color: var(--rdg-text); font-weight: 600; font-variant-numeric: tabular-nums; }
`;

/** Renders the shared stylesheet; several instances in one page just repeat identical rules. */
export function ChromeStyles() {
  return <style data-rdg-chrome>{CSS}</style>;
}
