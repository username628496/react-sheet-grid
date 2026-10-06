import { forwardRef } from 'react';

/**
 * The hidden textarea that receives all keyboard, IME and clipboard input and
 * doubles as the in-cell editor. It is rendered by React but styled and
 * driven imperatively by EditorController, so typing never re-renders React.
 */
export const CellEditor = forwardRef<HTMLTextAreaElement>(function CellEditor(_props, ref) {
  return (
    <textarea
      ref={ref}
      data-testid="cell-editor"
      aria-label="Cell editor"
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      spellCheck={false}
      rows={1}
      style={{ position: 'absolute', opacity: 0 }}
    />
  );
});
