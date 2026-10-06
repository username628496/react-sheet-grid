import { CELL_HORIZONTAL_PADDING, DEFAULT_FONT_SIZE, FONT_FAMILY, fontString } from '../core/model/font';
import type { Style } from '../core/model/StyleTable';

export interface Palette {
  background: string;
  text: string;
  gridLine: string;
  headerBackground: string;
  headerText: string;
  headerLine: string;
  headerActive: string;
  headerActiveText: string;
  accent: string;
  selectionFill: string;
  freezeLine: string;
  findMatch: string;
  findCurrent: string;
}

const LIGHT: Palette = {
  background: '#ffffff',
  text: '#1f1f1f',
  gridLine: '#e2e3e3',
  headerBackground: '#f8f9fa',
  headerText: '#444746',
  headerLine: '#c7c7c7',
  headerActive: '#e8eaed',
  headerActiveText: '#1a73e8',
  accent: '#1a73e8',
  selectionFill: 'rgba(26, 115, 232, 0.12)',
  freezeLine: '#9aa0a6',
  findMatch: 'rgba(255, 213, 0, 0.38)',
  findCurrent: 'rgba(255, 140, 0, 0.55)',
};

const DARK: Palette = {
  background: '#1b1d21',
  text: '#e6e8eb',
  gridLine: '#32363d',
  headerBackground: '#23262b',
  headerText: '#b4bac4',
  headerLine: '#454a53',
  headerActive: '#353b45',
  headerActiveText: '#8ab4f8',
  accent: '#8ab4f8',
  selectionFill: 'rgba(138, 180, 248, 0.18)',
  freezeLine: '#6b7280',
  findMatch: 'rgba(255, 213, 0, 0.28)',
  findCurrent: 'rgba(255, 140, 0, 0.5)',
};

/**
 * Colors the canvas layers read on every draw. One shared object, so the canvas theme is per page (not per grid):
 * switching it and invalidating the surfaces is all a theme change takes.
 */
export const theme: { fontFamily: string; fontSize: number; cellPadding: number } & Palette = {
  fontFamily: FONT_FAMILY,
  fontSize: DEFAULT_FONT_SIZE,
  cellPadding: CELL_HORIZONTAL_PADDING,
  ...LIGHT,
};

export function applyCanvasTheme(name: 'light' | 'dark'): void {
  Object.assign(theme, name === 'dark' ? DARK : LIGHT);
}

/** The CSS font for a style. `scale` is for DOM boxes that sit on top of the canvas (the editor) and so need screen pixels; the canvas itself scales by transform. */
export function fontFor(style: Pick<Style, 'bold' | 'italic' | 'fontSize'>, scale = 1): string {
  return fontString(style, scale);
}

/** Colors given to the references of a formula being edited, in order of first appearance (as in Sheets). */
export const REF_COLORS = ['#1a73e8', '#d93025', '#188038', '#e37400', '#a142f4', '#12b5cb', '#c2185b', '#5f6368'] as const;
