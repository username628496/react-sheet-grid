export const theme = {
  fontFamily: 'Arial, "Helvetica Neue", sans-serif',
  fontSize: 13,
  cellPadding: 4,
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
} as const;

export function fontFor(bold: boolean | undefined, italic: boolean | undefined): string {
  return `${italic === true ? 'italic ' : ''}${bold === true ? 'bold ' : ''}${theme.fontSize}px ${theme.fontFamily}`;
}

/** Colors given to the references of a formula being edited, in order of first appearance (as in Sheets). */
export const REF_COLORS = ['#1a73e8', '#d93025', '#188038', '#e37400', '#a142f4', '#12b5cb', '#c2185b', '#5f6368'] as const;
