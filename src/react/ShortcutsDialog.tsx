import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ChromeStyles } from './chrome';
import { useMessages, useTheme } from './GridProvider';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** `Mod` in the shortcut tables becomes ⌘ or Ctrl depending on the platform. */
function label(keys: string): string {
  return keys.replace(/Mod\+/g, isMac ? '⌘' : 'Ctrl+').replace(/Alt\+/g, isMac ? '⌥' : 'Alt+').replace(/Shift\+/g, isMac ? '⇧' : 'Shift+');
}

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const m = useMessages();
  const theme = useTheme();
  useEffect(() => {
    ref.current?.focus();
  }, []);

  return createPortal(
    <div
      className="rdg-chrome rdg-overlay"
      data-rdg-theme={theme}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <ChromeStyles />
      <div
        ref={ref}
        role="dialog"
        aria-label={m.shortcutsTitle}
        data-testid="shortcuts-dialog"
        tabIndex={-1}
        className="rdg-popup"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
          }
        }}
        style={{ width: 560, maxWidth: '92vw', maxHeight: '80vh', overflow: 'auto', padding: 20, outline: 'none' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <b style={{ fontSize: 16 }}>{m.shortcutsTitle}</b>
          <button type="button" className="rdg-textbtn" onClick={onClose} aria-label={m.close}>
            ✕
          </button>
        </div>
        {m.shortcutGroups.map((group) => (
          <section key={group.title} style={{ marginBottom: 14 }}>
            <h3 className="rdg-muted" style={{ margin: '0 0 6px', fontSize: 13 }}>
              {group.title}
            </h3>
            {group.items.map(([keys, action]) => (
              <div key={keys} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '3px 0', borderBottom: '1px solid var(--rdg-border)' }}>
                <span>{action}</span>
                <kbd className="rdg-kbd">{label(keys)}</kbd>
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>,
    document.body,
  );
}
