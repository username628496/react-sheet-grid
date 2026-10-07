import { describe, expect, it } from 'vitest';
import { fromExcelFormat, toExcelFormat } from '../../src/xlsx/numFmt';

describe('toExcelFormat', () => {
  it('quotes literal text, keeps the dollar sign and percent, passes dates through', () => {
    expect(toExcelFormat('#,##0.00')).toBe('#,##0.00');
    expect(toExcelFormat('$#,##0.00')).toBe('$#,##0.00');
    expect(toExcelFormat('#,##0 ₫')).toBe('#,##0" ₫"');
    expect(toExcelFormat('€#,##0.00')).toBe('"€"#,##0.00');
    expect(toExcelFormat('0.0%')).toBe('0.0%');
    expect(toExcelFormat('yyyy-mm-dd hh:mm')).toBe('yyyy-mm-dd hh:mm');
    expect(toExcelFormat(undefined)).toBeNull();
    expect(toExcelFormat('weird')).toBeNull();
  });
});

describe('fromExcelFormat', () => {
  it('reads built-in ids', () => {
    expect(fromExcelFormat(0, undefined)).toBeUndefined();
    expect(fromExcelFormat(2, undefined)).toBe('0.00');
    expect(fromExcelFormat(10, undefined)).toBe('0.00%');
    expect(fromExcelFormat(14, undefined)).toBe('mm/dd/yyyy');
    expect(fromExcelFormat(21, undefined)).toBe('hh:mm:ss');
    expect(fromExcelFormat(49, undefined)).toBeUndefined();
  });

  it('reads custom codes: quotes, escapes, padding, sections, tags', () => {
    expect(fromExcelFormat(164, '#,##0" ₫"')).toBe('#,##0 ₫');
    expect(fromExcelFormat(164, '"€"#,##0.00')).toBe('€#,##0.00');
    expect(fromExcelFormat(164, '[$€-407] #,##0.00')).toBe('€ #,##0.00');
    expect(fromExcelFormat(164, '[$$-409]#,##0.00')).toBe('$#,##0.00');
    expect(fromExcelFormat(164, '#,##0.00_);[Red](#,##0.00)')).toBe('#,##0.00');
    expect(fromExcelFormat(164, 'yyyy\\-mm\\-dd')).toBe('yyyy-mm-dd');
    expect(fromExcelFormat(164, 'dd/mm/yyyy;@')).toBe('dd/mm/yyyy');
    expect(fromExcelFormat(164, 'DD/MM/YYYY')).toBe('dd/mm/yyyy');
    expect(fromExcelFormat(164, 'h:mm AM/PM')).toBe('h:mm AM/PM');
    expect(fromExcelFormat(164, '0.00%')).toBe('0.00%');
  });

  it('gives up on what it cannot show', () => {
    for (const code of ['General', '@', '[h]:mm:ss', '0.0,,"M"', '# ?/?', '[>100]0;0', '0.00E+00', '']) {
      expect(fromExcelFormat(164, code), code).toBeUndefined();
    }
  });

  it('round trips this grid\'s own patterns', () => {
    for (const f of ['0', '0.00', '#,##0', '#,##0.00', '0%', '0.00%', '$#,##0.00', '€#,##0.00', '#,##0 ₫', 'yyyy-mm-dd', 'dd/mm/yyyy', 'd mmm yyyy', 'hh:mm', 'yyyy-mm-dd hh:mm']) {
      expect(fromExcelFormat(164, toExcelFormat(f) ?? undefined), f).toBe(f);
    }
  });
});
