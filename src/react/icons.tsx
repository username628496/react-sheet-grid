import type { ReactNode } from 'react';

/** 24x24 line icons drawn with currentColor, so hover/pressed/disabled colors come from CSS. */
const PATHS: Record<string, string[]> = {
  undo: ['M9 14 4 9l5-5', 'M4 9h10.5a5.5 5.5 0 0 1 0 11H11'],
  redo: ['m15 14 5-5-5-5', 'M20 9H9.5a5.5 5.5 0 0 0 0 11H13'],
  clearFormat: ['M5 4h14', 'M12 4v6', 'M9 20h6', 'M4 20 20 4'],
  sortAsc: ['m3 8 4-4 4 4', 'M7 4v16', 'M11 12h4', 'M11 16h7', 'M11 20h10'],
  sortDesc: ['m3 16 4 4 4-4', 'M7 20V4', 'M11 4h10', 'M11 8h7', 'M11 12h4'],
  bold: ['M6 4h8a4 4 0 0 1 0 8H6z', 'M6 12h9a4 4 0 0 1 0 8H6z'],
  italic: ['M19 4h-9', 'M14 20H5', 'M15 4 9 20'],
  underline: ['M6 4v6a6 6 0 0 0 12 0V4', 'M4 20h16'],
  strike: ['M16 5H9.5a3.5 3.5 0 0 0-3 5.2', 'M14 12.5a3.8 3.8 0 0 1-1.5 7.5H6', 'M4 12h16'],
  textColor: ['m6 15 6-11 6 11', 'M8.2 11h7.6'],
  fillColor: ['m19 11-8-8-8.6 8.6a2 2 0 0 0 0 2.8l5.2 5.2c.8.8 2 .8 2.8 0L19 11Z', 'M2.5 12.5h15'],
  alignLeft: ['M3 6h18', 'M3 10h12', 'M3 14h18', 'M3 18h12'],
  alignCenter: ['M3 6h18', 'M7 10h10', 'M3 14h18', 'M7 18h10'],
  alignRight: ['M3 6h18', 'M9 10h12', 'M3 14h18', 'M9 18h12'],
  close: ['M6 6l12 12', 'M18 6 6 18'],
  chevron: ['m6 9 6 6 6-6'],
  paintFormat: ['M18.4 2.6 14 7l-1.6-1.6a2 2 0 0 0-2.8 0L8 7l9 9 1.6-1.6a2 2 0 0 0 0-2.8L17 10l4.4-4.4a2.1 2.1 0 1 0-3-3Z', 'M9 8c-2 3-4 3.5-7 4l8 10c2-1 6-5 6-7', 'M14.5 17.5 4.5 15'],
  copy: ['M9 9h11v11H9z', 'M5 15H4V4h11v1'],
  cut: ['M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M20 4 8.1 15.9', 'M14.5 14.5 20 20', 'M8.1 8.1 12 12'],
  paste: ['M8 4h8v3H8z', 'M16 5h2a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2'],
  filter: ['M3 4h18l-7 8.5V19l-4 2v-8.5z'],
  clearFilter: ['M3 4h13l-5 6.2', 'M10 12.5V19l4-2', 'M17 14l5 5', 'M22 14l-5 5'],
  insert: ['M12 5v14', 'M5 12h14'],
  remove: ['M5 12h14'],
  freeze: ['M3 4h18v16H3z', 'M3 10h18', 'M9 4v16'],
  eyeOff: ['M3 3l18 18', 'M10.6 6.1A9.9 9.9 0 0 1 12 6c5 0 8.5 4 9.5 6a14 14 0 0 1-2.4 3', 'M6.6 6.6A14 14 0 0 0 2.5 12c1 2 4.5 6 9.5 6 1.5 0 2.8-.4 4-1', 'M9.9 9.9a3 3 0 0 0 4.2 4.2'],
  file: ['M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z', 'M14 3v5h5', 'M9 13h6', 'M9 17h6'],
  sigma: ['M18 5H6l6.5 7L6 19h12'],
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, children }: { name: IconName; children?: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false">
      {(PATHS[name] ?? []).map((d) => (
        <path key={d} d={d} />
      ))}
      {children}
    </svg>
  );
}
