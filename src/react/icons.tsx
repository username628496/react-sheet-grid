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
