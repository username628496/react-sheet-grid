export interface ShortcutGroup {
  title: string;
  items: ReadonlyArray<readonly [keys: string, action: string]>;
}

/** `Mod` is replaced by ⌘ or Ctrl depending on the platform. */
export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
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
      ['Mod+Shift+X', 'Strikethrough'],
      ['Mod+Shift+L / E / R', 'Align left / center / right'],
      ['Mod+Shift+1 / 4 / 5', 'Number / currency / percent'],
      ['Mod+\\', 'Clear formatting'],
    ],
  },
  { title: 'Help', items: [['Mod+/', 'Show this list']] },
];
