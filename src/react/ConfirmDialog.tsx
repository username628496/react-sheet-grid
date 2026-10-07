import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ChromeStyles } from './chrome';
import { useMessages, useTheme } from './GridProvider';

interface ConfirmDialogProps {
  title: string;
  body: string;
  confirmLabel: string;
  testId: string;
  onCancel: () => void;
  onConfirm: () => void;
}

/** A modal yes/no question. Focus starts on Cancel, so Enter or Space cannot confirm something destructive by accident. */
export function ConfirmDialog({ title, body, confirmLabel, testId, onCancel, onConfirm }: ConfirmDialogProps) {
  const m = useMessages();
  const theme = useTheme();
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => cancelRef.current?.focus(), []);
  return createPortal(
    <div className="rdg-chrome rdg-overlay" data-rdg-theme={theme} onKeyDown={(e) => e.key === 'Escape' && onCancel()}>
      <ChromeStyles />
      <div role="alertdialog" aria-label={title} data-testid={testId} className="rdg-chrome rdg-popup" style={{ padding: 16, width: 340 }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>{title}</div>
        <div className="rdg-muted" style={{ marginBottom: 14 }}>{body}</div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button ref={cancelRef} type="button" className="rdg-textbtn" onClick={onCancel}>{m.cancel}</button>
          <button type="button" className="rdg-textbtn rdg-primary" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
