import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { SHORTCUT_GROUPS } from './shortcuts';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

function label(keys: string): string {
  return keys.replace(/Mod\+/g, isMac ? '⌘' : 'Ctrl+').replace(/Alt\+/g, isMac ? '⌥' : 'Alt+').replace(/Shift\+/g, isMac ? '⇧' : 'Shift+');
}

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);

  return createPortal(
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-label="Keyboard shortcuts"
        data-testid="shortcuts-dialog"
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
          }
        }}
        style={{
          width: 560,
          maxWidth: '92vw',
          maxHeight: '80vh',
          overflow: 'auto',
          padding: 20,
          background: '#fff',
          borderRadius: 8,
          boxShadow: '0 4px 24px rgba(0,0,0,0.3)',
          fontFamily: 'Arial, sans-serif',
          fontSize: 13,
          outline: 'none',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
          <b style={{ fontSize: 16 }}>Keyboard shortcuts</b>
          <button type="button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {SHORTCUT_GROUPS.map((group) => (
          <section key={group.title} style={{ marginBottom: 14 }}>
            <h3 style={{ margin: '0 0 6px', fontSize: 13, color: '#5f6368' }}>{group.title}</h3>
            {group.items.map(([keys, action]) => (
              <div key={keys} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '3px 0', borderBottom: '1px solid #f1f3f4' }}>
                <span>{action}</span>
                <kbd style={{ fontFamily: 'inherit', background: '#f1f3f4', borderRadius: 4, padding: '1px 6px', whiteSpace: 'nowrap' }}>{label(keys)}</kbd>
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>,
    document.body,
  );
}
