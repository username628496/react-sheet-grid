import { describe, expect, it } from 'vitest';
import { DEFAULT_STYLE_ID, StyleTable } from '../../src/core/model/StyleTable';

describe('StyleTable', () => {
  it('reserves id 0 for the default style', () => {
    const table = new StyleTable();
    expect(table.intern({})).toBe(DEFAULT_STYLE_ID);
    expect(table.get(DEFAULT_STYLE_ID)).toEqual({});
  });

  it('interns equal styles to the same id regardless of key order', () => {
    const table = new StyleTable();
    const a = table.intern({ bold: true, color: '#f00' });
    const b = table.intern({ color: '#f00', bold: true });
    expect(a).toBe(b);
    expect(a).not.toBe(DEFAULT_STYLE_ID);
    expect(table.size).toBe(2);
  });

  it('treats undefined properties as absent', () => {
    const table = new StyleTable();
    expect(table.intern({ bold: undefined })).toBe(DEFAULT_STYLE_ID);
  });

  it('gives different styles different ids', () => {
    const table = new StyleTable();
    expect(table.intern({ bold: true })).not.toBe(table.intern({ italic: true }));
  });

  it('derives a style by patching an existing one', () => {
    const table = new StyleTable();
    const bold = table.intern({ bold: true });
    const boldRed = table.derive(bold, { color: '#f00' });
    expect(table.get(boldRed)).toEqual({ bold: true, color: '#f00' });
    expect(table.get(bold)).toEqual({ bold: true });
  });

  it('falls back to the default style for unknown ids', () => {
    expect(new StyleTable().get(999)).toEqual({});
  });
});
