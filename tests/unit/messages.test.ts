import { describe, expect, it } from 'vitest';
import { MESSAGES, resolveMessages } from '../../src/react/messages';

describe('messages', () => {
  const en = MESSAGES.en as unknown as Record<string, unknown>;
  const vi = MESSAGES.vi as unknown as Record<string, unknown>;

  it('every locale defines exactly the same keys, of the same kind', () => {
    expect(Object.keys(vi).sort()).toEqual(Object.keys(en).sort());
    for (const key of Object.keys(en)) expect(typeof vi[key], key).toBe(typeof en[key]);
  });

  it('no string is empty and functions return text', () => {
    for (const locale of ['en', 'vi'] as const) {
      const messages = MESSAGES[locale] as unknown as Record<string, unknown>;
      for (const [key, value] of Object.entries(messages)) {
        if (typeof value === 'string') expect(value.trim(), `${locale}.${key}`).not.toBe('');
        if (typeof value === 'function') {
          const text = (value as (...a: unknown[]) => unknown)('X', 'Y', 3);
          expect(typeof text, `${locale}.${key}`).toBe('string');
          expect((text as string).trim(), `${locale}.${key}`).not.toBe('');
        }
      }
    }
  });

  it('shortcut tables line up: same groups, same key combinations in the same order', () => {
    const shape = (l: 'en' | 'vi') => MESSAGES[l].shortcutGroups.map((g) => g.items.length);
    expect(shape('vi')).toEqual(shape('en'));
    // The key combinations are language independent, except where an entry joins alternatives with "or"/"hoặc".
    const plain = (l: 'en' | 'vi') => MESSAGES[l].shortcutGroups.flatMap((g) => g.items.map(([k]) => k)).filter((k) => !/ (or|hoặc) /.test(k));
    expect(plain('vi')).toEqual(plain('en'));
  });

  it('plurals follow each language', () => {
    expect(MESSAGES.en.insertRowsAbove(1)).toBe('Insert 1 row above');
    expect(MESSAGES.en.insertRowsAbove(3)).toBe('Insert 3 rows above');
    expect(MESSAGES.vi.insertRowsAbove(3)).toBe('Chèn 3 dòng phía trên');
    expect(MESSAGES.en.deleteRows(2, 2)).toBe('Delete row 2');
    expect(MESSAGES.en.deleteRows(2, 4)).toBe('Delete rows 2–4');
  });

  it('a host can override single strings', () => {
    const custom = resolveMessages('en', { bold: 'Strong' });
    expect(custom.bold).toBe('Strong');
    expect(custom.italic).toBe('Italic');
  });
});
