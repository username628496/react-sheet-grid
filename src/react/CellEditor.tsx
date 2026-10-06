import { forwardRef } from 'react';

/**
 * The hidden textarea that receives all keyboard, IME and clipboard input and
 * doubles as the in-cell editor. It is rendered by React but styled and
 * driven imperatively by EditorController, so typing never re-renders React.
 */
export const CellEditor = forwardRef<HTMLTextAreaElement, { label?: string }>(function CellEditor({ label = 'Cell editor' }, ref) {
  return (
    <textarea
      ref={ref}
      data-testid="cell-editor"
      aria-label={label}
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      spellCheck={false}
      rows={1}
      style={{ position: 'absolute', opacity: 0 }}
    />
  );
});
