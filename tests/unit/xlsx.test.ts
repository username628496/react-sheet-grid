import { describe, expect, it } from 'vitest';
import { toSerial } from '../../src/core/model/dates';
import { Spreadsheet } from '../../src/core/Spreadsheet';
import { Workbook } from '../../src/core/Workbook';
import { exportXlsx, importXlsx, XlsxError } from '../../src/xlsx';
import { parseXml } from '../../src/xlsx/xml';
import { fromUtf8, readZip, utf8, writeZip } from '../../src/xlsx/zip';

function book(...names: string[]): Workbook {
  const wb = new Workbook(new Spreadsheet({ rowCount: 60, colCount: 30 }));
  wb.active.name = names[0] ?? 'Sheet1';
  for (const name of names.slice(1)) wb.addSheet({ name, rowCount: 60, colCount: 30 });
  wb.setActive(0);
  return wb;
}

async function roundTrip(wb: Workbook) {
  const { data, warnings } = await exportXlsx(wb);
  const back = await importXlsx(data);
  return { data, warnings, back: back.workbook, importWarnings: back.warnings };
}

const val = (wb: Workbook, sheet: string, row: number, col: number): unknown => wb.sheetByName(sheet)!.getCellByView(row, col).value;
const styleAt = (wb: Workbook, sheet: string, row: number, col: number) => {
  const s = wb.sheetByName(sheet)!;
  return s.styles.get(s.getCellByView(row, col).styleId);
};

describe('export produces well-formed OOXML', () => {
  it('every part is valid XML and the package has the required parts', async () => {
    const wb = book('A', 'B');
    wb.active.setCellInput(0, 0, 'x < y & "z"');
    wb.active.setCellInput(0, 1, '=SUM(1,2)');
    const files = await readZip((await exportXlsx(wb)).data);
    for (const required of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/sharedStrings.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml']) {
      expect(files.has(required), required).toBe(true);
    }
    for (const [name, data] of files) {
      expect(() => parseXml(fromUtf8(data), { open() {}, close() {} }), name).not.toThrow();
    }
    expect(fromUtf8(files.get('xl/sharedStrings.xml') as Uint8Array)).toContain('x &lt; y &amp; &quot;z&quot;');
  });
});

describe('round trip', () => {
  it('values of every type, sheet names and order, and the active sheet', async () => {
    const wb = book('Data', 'Totals & more', 'Bảng 3');
    const d = wb.sheetByName('Data')!;
    d.setCellInput(0, 0, 'text');
    d.setCellInput(0, 1, '3.5');
    d.setCellInput(0, 2, 'TRUE');
    d.setCellInput(1, 0, '=1/0');
    d.setCellInput(1, 1, "'007");
    d.setCellInput(1, 2, '  padded  ');
    d.setCellInput(2, 0, 'line1\nline2');
    d.setCellInput(2, 1, 'tiếng Việt – ✓ 😀');
    d.setCellInput(2, 2, 'a\u0001b');
    wb.setActive(2);
    const { back } = await roundTrip(wb);
    expect(back.sheets.map((s) => s.name)).toEqual(['Data', 'Totals & more', 'Bảng 3']);
    expect(back.activeIndex).toBe(2);
    expect([val(back, 'Data', 0, 0), val(back, 'Data', 0, 1), val(back, 'Data', 0, 2)]).toEqual(['text', 3.5, true]);
    expect(val(back, 'Data', 1, 0)).toEqual({ error: '#DIV/0!' });
    expect([val(back, 'Data', 1, 1), val(back, 'Data', 1, 2)]).toEqual(['007', '  padded  ']);
    expect([val(back, 'Data', 2, 0), val(back, 'Data', 2, 1), val(back, 'Data', 2, 2)]).toEqual(['line1\nline2', 'tiếng Việt – ✓ 😀', 'a\u0001b']);
  });

  it('formulas stay formulas, including references to other sheets and the _xlfn functions', async () => {
    const wb = book('Data', 'Calc');
    wb.sheetByName('Data')!.setCellInput(0, 0, '5');
    wb.sheetByName('Data')!.setCellInput(1, 0, '7');
    const calc = wb.sheetByName('Calc')!;
    calc.setCellInput(0, 0, '=SUM(Data!A1:A2)*2');
    calc.setCellInput(1, 0, "=CONCAT(\"a\",Data!A1)");
    calc.setCellInput(2, 0, '=DAYS("2026-03-01","2026-01-01")');
    calc.setCellInput(3, 0, '=IF(Data!A1>3,"big","small")');
    const files = await readZip((await exportXlsx(wb)).data);
    const sheet2 = fromUtf8(files.get('xl/worksheets/sheet2.xml') as Uint8Array);
    expect(sheet2).toContain('<f>SUM(Data!A1:A2)*2</f>');
    expect(sheet2).toContain('_xlfn.CONCAT(');
    expect(sheet2).toContain('_xlfn.DAYS(');
    const { back } = await roundTrip(wb);
    const b = back.sheetByName('Calc')!;
    expect([0, 1, 2, 3].map((r) => b.getEditText(r, 0))).toEqual(['=SUM(Data!A1:A2)*2', '=CONCAT("a",Data!A1)', '=DAYS("2026-03-01","2026-01-01")', '=IF(Data!A1>3,"big","small")']);
    expect([0, 1, 2, 3].map((r) => b.getCellByView(r, 0).value)).toEqual([24, 'a5', 59, 'big']);
    // And they are live: editing the other sheet updates them.
    back.sheetByName('Data')!.setCellInput(0, 0, '1');
    expect(b.getCellByView(0, 0).value).toBe(16);
  });

  it('formatting: fonts, colors, fills, borders, alignment, wrapping, number formats and dates', async () => {
    const wb = book('S');
    const s = wb.active;
    s.setCellInput(0, 0, 'styled');
    s.selection.selectCell(0, 0);
    s.formatSelection({ bold: true, italic: true, underline: true, strike: true, color: '#ff0000', background: '#00ff00', fontSize: 18, align: 'center', valign: 'top', wrap: 'wrap' });
    s.applyBorders('all', { width: 2, style: 'dashed', color: '#0000ff' });
    s.setCellInput(1, 0, '1234.5');
    s.selection.selectCell(1, 0);
    s.formatSelection({ numberFormat: '#,##0.00' });
    s.setCellInput(2, 0, '2026-10-07 14:30');
    s.selection.selectCell(2, 0);
    s.formatSelection({ numberFormat: 'dd/mm/yyyy hh:mm' });
    s.setCellInput(3, 0, '5');
    s.selection.selectCell(3, 0);
    s.formatSelection({ numberFormat: '#,##0 ₫' });
    const { back } = await roundTrip(wb);
    const st = styleAt(back, 'S', 0, 0);
    expect(st).toMatchObject({ bold: true, italic: true, underline: true, strike: true, color: '#ff0000', background: '#00ff00', fontSize: 18, align: 'center', valign: 'top', wrap: 'wrap' });
    expect(st.borders?.top).toEqual({ width: 2, style: 'dashed', color: '#0000ff' });
    expect(st.borders?.left).toEqual({ width: 2, style: 'dashed', color: '#0000ff' });
    expect(back.active.getDisplayText(1, 0)).toBe('1,234.50');
    expect(back.active.getDisplayText(2, 0)).toBe('07/10/2026 14:30');
    expect(val(back, 'S', 2, 0)).toBeCloseTo(toSerial(2026, 10, 7) + (14 * 60 + 30) / 1440, 9);
    expect(back.active.getDisplayText(3, 0)).toBe('5 ₫');
  });

  it('layout: row heights, column widths, hidden lines, frozen panes, merges', async () => {
    const wb = book('S');
    const s = wb.active;
    s.setCellInput(0, 0, 'x');
    s.rows.setSize(2, 50);
    s.rows.setSize(4, 0);
    s.cols.setSize(1, 140);
    s.cols.setSize(2, 140);
    s.cols.setSize(3, 0);
    s.setFrozen(2, 1);
    s.selection.selectCell(6, 1);
    s.selection.extendTo(7, 3);
    s.mergeSelection();
    const { back } = await roundTrip(wb);
    const b = back.active;
    expect(b.rows.getSize(2)).toBe(50);
    expect(b.rows.getSize(4)).toBe(0);
    expect(b.rows.getSize(1)).toBe(b.rows.defaultSize);
    expect([b.cols.getSize(1), b.cols.getSize(2), b.cols.getSize(3)]).toEqual([140, 140, 0]);
    expect([b.frozenRows, b.frozenCols]).toEqual([2, 1]);
    expect(b.merges.all).toEqual([{ row: 6, col: 1, rowSpan: 2, colSpan: 3 }]);
  });

  it('data validation (list, number, date, warning mode) and conditional formatting', async () => {
    const wb = book('S');
    const s = wb.active;
    s.selection.selectCell(0, 0);
    s.selection.extendTo(4, 0);
    s.setValidation({ kind: 'list', items: ['Open', 'Done'], strict: true });
    s.selection.selectCell(0, 1);
    s.selection.extendTo(2, 1);
    s.setValidation({ kind: 'number', op: 'between', a: 1, b: 10, strict: false });
    s.selection.selectCell(0, 2);
    s.setValidation({ kind: 'date', op: 'gte', a: toSerial(2026, 1, 1), strict: true });
    s.selection.selectCell(0, 4);
    s.selection.extendTo(3, 4);
    s.setConditionalRules([
      { when: { kind: 'number', op: 'lt', a: 0 }, color: '#ff0000' },
      { when: { kind: 'text', op: 'contains', text: 'err "x"' }, background: '#ffcccc' },
      { when: { kind: 'blank' }, background: '#eeeeee' },
    ]);
    const { back } = await roundTrip(wb);
    expect(styleAt(back, 'S', 3, 0).validation).toEqual({ kind: 'list', items: ['Open', 'Done'], strict: true });
    expect(styleAt(back, 'S', 1, 1).validation).toEqual({ kind: 'number', op: 'between', a: 1, b: 10, strict: false });
    expect(styleAt(back, 'S', 0, 2).validation).toEqual({ kind: 'date', op: 'gte', a: toSerial(2026, 1, 1), strict: true });
    expect(styleAt(back, 'S', 5, 0).validation).toBeUndefined();
    expect(styleAt(back, 'S', 2, 4).conditional).toEqual([
      { when: { kind: 'number', op: 'lt', a: 0 }, color: '#ff0000' },
      { when: { kind: 'text', op: 'contains', text: 'err "x"' }, background: '#ffcccc' },
      { when: { kind: 'blank' }, background: '#eeeeee' },
    ]);
  });

  it('warns about validation lists Excel cannot hold', async () => {
    const wb = book('S');
    wb.active.selection.selectCell(0, 0);
    wb.active.setValidation({ kind: 'list', items: ['a,b', 'c'], strict: true });
    const { warnings, back } = await roundTrip(wb);
    expect(warnings.join(' ')).toMatch(/validation list/);
    expect(styleAt(back, 'S', 0, 0).validation).toBeUndefined();
  });

  it('a sorted sheet is saved as it looks, with values instead of formulas', async () => {
    const wb = book('S');
    const s = wb.active;
    s.setCellInput(0, 0, '3');
    s.setCellInput(1, 0, '1');
    s.setCellInput(2, 0, '=A1*2');
    s.sortByColumn(0, true);
    const { back, warnings } = await roundTrip(wb);
    expect(warnings.join(' ')).toMatch(/sorted or filtered/);
    expect([0, 1, 2].map((r) => val(back, 'S', r, 0))).toEqual([1, 3, 6]);
    expect(back.active.getCellByView(2, 0).formula).toBeUndefined();
  });

  it('a big sheet survives and stays small', async () => {
    const wb = new Workbook(new Spreadsheet({ rowCount: 5000, colCount: 30 }));
    const s = wb.active;
    for (let r = 0; r < 3000; r++) for (let c = 0; c < 10; c++) s.model.setCell(r, c, { value: c % 2 === 0 ? r * c : `row ${r} col ${c}`, styleId: 0 });
    const { data, back } = await roundTrip(wb);
    expect(back.active.model.cellCount).toBe(30_000);
    expect(val(back, 'Sheet1', 2999, 8)).toBe(2999 * 8);
    expect(data.length).toBeLessThan(400_000);
  });

  it('an empty workbook round trips', async () => {
    const { back } = await roundTrip(book('Only'));
    expect(back.sheets.map((s) => s.name)).toEqual(['Only']);
    expect(back.active.model.cellCount).toBe(0);
  });
});

/** A hand-written xlsx, the way other programs write them. */
async function fixture(parts: Record<string, string>): Promise<Uint8Array> {
  const defaults: Record<string, string> = {
    '_rels/.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/_rels/workbook.xml.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>',
    'xl/workbook.xml': '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Imported" sheetId="1" r:id="rId1"/></sheets></workbook>',
  };
  const all = { ...defaults, ...parts };
  return writeZip(Object.entries(all).map(([name, xml]) => ({ name, data: utf8(`<?xml version="1.0"?>${xml}`) })));
}
const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
const sheetXml = (inner: string): string => `<worksheet ${NS}>${inner}</worksheet>`;

describe('importing files written by other programs', () => {
  it('shared strings with rich text and phonetic runs, inline strings, booleans, errors, dates (t="d")', async () => {
    const data = await fixture({
      'xl/sharedStrings.xml': `<sst ${NS}><si><t>plain</t></si><si><r><t>rich </t></r><r><rPr><b/></rPr><t>text</t></r><rPh sb="0" eb="1"><t>ignored</t></rPh></si><si><t>_x0041_ _x000D_</t></si></sst>`,
      'xl/worksheets/sheet1.xml': sheetXml(
        '<sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>' +
          '<row r="2"><c r="A2" t="inlineStr"><is><t>inline</t></is></c><c r="B2" t="b"><v>1</v></c><c r="C2" t="e"><v>#N/A</v></c><c r="D2" t="d"><v>2026-10-07T10:30:00</v></c><c r="E2"><v>42.5</v></c></row></sheetData>',
      ),
      'xl/styles.xml': `<styleSheet ${NS}/>`,
    });
    const { workbook } = await importXlsx(data);
    const s = workbook.active;
    expect([0, 1, 2].map((c) => s.getCellByView(0, c).value)).toEqual(['plain', 'rich text', 'A \r']);
    expect([0, 1, 2, 3, 4].map((c) => s.getCellByView(1, c).value)).toEqual(['inline', true, { error: '#N/A' }, toSerial(2026, 10, 7) + (10 * 60 + 30) / 1440, 42.5]);
  });

  it('shared formulas move with their cell, and unsupported functions keep their saved value', async () => {
    const data = await fixture({
      'xl/worksheets/sheet1.xml': sheetXml(
        '<sheetData><row r="1"><c r="A1"><v>1</v></c><c r="B1"><f t="shared" ref="B1:B3" si="0">A1*10</f><v>10</v></c></row>' +
          '<row r="2"><c r="A2"><v>2</v></c><c r="B2"><f t="shared" si="0"/><v>20</v></c></row>' +
          '<row r="3"><c r="A3"><v>3</v></c><c r="B3"><f t="shared" si="0"/><v>30</v></c><c r="C3"><f>XLOOKUP(A3,A1:A3,A1:A3)</f><v>3</v></c><c r="D3" t="str"><f>_xlfn.CONCAT("a","b")</f><v>ab</v></c></row></sheetData>',
      ),
      'xl/styles.xml': `<styleSheet ${NS}/>`,
    });
    const { workbook, warnings } = await importXlsx(data);
    const s = workbook.active;
    expect([0, 1, 2].map((r) => s.getEditText(r, 1))).toEqual(['=A1*10', '=A2*10', '=A3*10']);
    expect([0, 1, 2].map((r) => s.getCellByView(r, 1).value)).toEqual([10, 20, 30]);
    expect(s.getCellByView(2, 2).formula).toBeUndefined();
    expect(s.getCellByView(2, 2).value).toBe(3);
    expect(s.getEditText(2, 3)).toBe('=CONCAT("a","b")');
    expect(warnings.join(' ')).toMatch(/1 formula/);
  });

  it('styles: default font size is not "larger", theme colors are ignored, custom number formats and dates', async () => {
    const data = await fixture({
      'xl/styles.xml':
        `<styleSheet ${NS}><numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy;@"/></numFmts>` +
        '<fonts count="3"><font><sz val="11"/><color theme="1"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFF0000"/></font><font><sz val="14"/></font></fonts>' +
        '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor theme="4"/></patternFill></fill></fills>' +
        '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
        '<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="164" fontId="1" fillId="0" borderId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="2" fillId="2" borderId="0"/><xf numFmtId="14" fontId="0" fillId="0" borderId="0"/></cellXfs></styleSheet>',
      'xl/worksheets/sheet1.xml': sheetXml('<sheetData><row r="1"><c r="A1" s="1"><v>46302</v></c><c r="B1" s="2"><v>1</v></c><c r="C1" s="3"><v>46302</v></c><c r="D1" s="0"><v>5</v></c></row></sheetData>'),
    });
    const { workbook } = await importXlsx(data);
    const s = workbook.active;
    expect(s.getDisplayText(0, 0)).toBe('07/10/2026');
    expect(s.styles.get(s.getCellByView(0, 0).styleId)).toMatchObject({ bold: true, color: '#ff0000' });
    const second = s.styles.get(s.getCellByView(0, 1).styleId);
    expect(second.fontSize).toBe(19); // 14pt
    expect(second.background).toBeUndefined(); // a theme color: not carried over
    expect(s.getDisplayText(0, 2)).toBe('10/07/2026');
    expect(s.getCellByView(0, 3).styleId).toBe(0);
  });

  it('1904 date system, hidden sheets, odd names, relative targets, whole-sheet column defaults', async () => {
    const data = await fixture({
      'xl/workbook.xml': `<workbook ${NS} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr date1904="1"/><sheets><sheet name="a/b:c" sheetId="1" r:id="rId1"/><sheet name="A/B:C" sheetId="2" state="hidden" r:id="rId1"/></sheets></workbook>`,
      'xl/styles.xml': `<styleSheet ${NS}><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>`,
      'xl/worksheets/sheet1.xml': sheetXml('<cols><col min="1" max="16384" width="9" customWidth="1"/><col min="2" max="2" width="20" customWidth="1"/></cols><sheetData><row r="1"><c r="A1" s="1"><v>1000</v></c><c r="B1"><v>1000</v></c></row></sheetData>'),
    });
    const { workbook, warnings } = await importXlsx(data);
    expect(workbook.sheets.map((s) => s.name)).toEqual(['a_b_c', 'A_B_C (2)']);
    expect(warnings.join(' ')).toMatch(/hidden/);
    expect(workbook.sheets[0]!.getCellByView(0, 0).value).toBe(1000 + 1462); // a date is shifted to the 1900 system
    expect(workbook.sheets[0]!.getCellByView(0, 1).value).toBe(1000); // a plain number is not
    expect(workbook.sheets[0]!.cols.getSize(1)).toBe(140);
    expect(workbook.sheets[0]!.cols.getSize(5)).toBe(workbook.sheets[0]!.cols.defaultSize); // the 16384-column default was not applied cell by cell
  });

  it('validations that read cells, whole-number and unsupported types; unsupported conditional formats warn', async () => {
    const data = await fixture({
      'xl/styles.xml': `<styleSheet ${NS}><dxfs count="1"><dxf><fill><patternFill><bgColor rgb="FFFFC7CE"/></patternFill></fill></dxf></dxfs></styleSheet>`,
      'xl/worksheets/sheet1.xml': sheetXml(
        '<sheetData><row r="1"><c r="E1" t="inlineStr"><is><t>red</t></is></c><c r="F1" t="inlineStr"><is><t>blue</t></is></c></row></sheetData>' +
          '<conditionalFormatting sqref="A1:A3"><cfRule type="cellIs" dxfId="0" priority="2" operator="greaterThan"><formula>5</formula></cfRule><cfRule type="colorScale" priority="1"><colorScale/></cfRule></conditionalFormatting>' +
          '<dataValidations count="3">' +
          '<dataValidation type="list" sqref="A1:A3"><formula1>$E$1:$F$1</formula1></dataValidation>' +
          '<dataValidation type="whole" operator="lessThanOrEqual" errorStyle="warning" sqref="B1"><formula1>9</formula1></dataValidation>' +
          '<dataValidation type="textLength" operator="lessThan" sqref="C1"><formula1>5</formula1></dataValidation></dataValidations>',
      ),
    });
    const { workbook, warnings } = await importXlsx(data);
    const s = workbook.active;
    expect(s.styles.get(s.getCellByView(1, 0).styleId).validation).toEqual({ kind: 'list', items: ['red', 'blue'], strict: true });
    expect(s.styles.get(s.getCellByView(0, 1).styleId).validation).toEqual({ kind: 'number', op: 'lte', a: 9, strict: false });
    expect(s.styles.get(s.getCellByView(0, 2).styleId).validation).toBeUndefined();
    expect(s.styles.get(s.getCellByView(1, 0).styleId).conditional).toEqual([{ when: { kind: 'number', op: 'gt', a: 5 }, background: '#ffc7ce' }]);
    expect(warnings.join('\n')).toMatch(/textLength/);
    expect(warnings.join('\n')).toMatch(/colorScale/);
  });
});

describe('importing rejects what is not a usable xlsx', () => {
  it('not a zip, a zip without a workbook, a broken workbook, no sheets', async () => {
    await expect(importXlsx(utf8('hello'))).rejects.toBeInstanceOf(XlsxError);
    await expect(importXlsx(await writeZip([{ name: 'a.txt', data: utf8('x') }]))).rejects.toThrow(/workbook/);
    await expect(importXlsx(await fixture({ 'xl/workbook.xml': '<workbook><sheets></workbook>' }))).rejects.toThrow(/XML/);
    await expect(importXlsx(await fixture({ 'xl/workbook.xml': `<workbook ${NS}><sheets/></workbook>` }))).rejects.toThrow(/no sheets/);
  });

  it('a sheet whose part is missing is skipped with a warning; if none are left it fails', async () => {
    const two = await fixture({
      'xl/workbook.xml': `<workbook ${NS} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Ok" sheetId="1" r:id="rId1"/><sheet name="Gone" sheetId="2" r:id="rId9"/></sheets></workbook>`,
      'xl/worksheets/sheet1.xml': sheetXml('<sheetData/>'),
      'xl/styles.xml': `<styleSheet ${NS}/>`,
    });
    const { workbook, warnings } = await importXlsx(two);
    expect(workbook.sheets.map((s) => s.name)).toEqual(['Ok']);
    expect(warnings.join(' ')).toMatch(/Gone/);
    const none = await fixture({ 'xl/workbook.xml': `<workbook ${NS} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Gone" sheetId="1" r:id="rId9"/></sheets></workbook>` });
    await expect(importXlsx(none)).rejects.toThrow(/none of its sheets/);
  });
});

describe('colors and rules as other writers spell them', () => {
  it('a 00 alpha byte (openpyxl) still means an opaque color', async () => {
    const data = await fixture({
      'xl/styles.xml':
        `<styleSheet ${NS}><fonts count="2"><font><sz val="11"/></font><font><color rgb="00FFFFFF"/></font></fonts>` +
        '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="004472C4"/></patternFill></fill></fills>' +
        '<borders count="1"><border/></borders><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0"/></cellXfs></styleSheet>',
      'xl/worksheets/sheet1.xml': sheetXml('<sheetData><row r="1"><c r="A1" s="1" t="inlineStr"><is><t>h</t></is></c></row></sheetData>'),
    });
    const { workbook } = await importXlsx(data);
    const s = workbook.active;
    expect(s.styles.get(s.getCellByView(0, 0).styleId)).toMatchObject({ color: '#ffffff', background: '#4472c4' });
  });

  it('rules written as formulas in the shapes this grid knows become real rules', async () => {
    const dxf = '<dxfs count="1"><dxf><fill><patternFill patternType="solid"><bgColor rgb="00C6EFCE"/></patternFill></fill></dxf></dxfs>';
    const rule = (f: string, p: number): string => `<cfRule type="expression" dxfId="0" priority="${p}"><formula>${f}</formula></cfRule>`;
    const data = await fixture({
      'xl/styles.xml': `<styleSheet ${NS}>${dxf}</styleSheet>`,
      'xl/worksheets/sheet1.xml': sheetXml(
        '<sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData>' +
          `<conditionalFormatting sqref="A1">${rule('NOT(ISERROR(SEARCH(&quot;ắ&quot;,A1)))', 1)}${rule('ISERROR(SEARCH(&quot;x&quot;,A1))', 2)}${rule('LEFT(A1,LEN(&quot;ab&quot;))=&quot;ab&quot;', 3)}${rule('RIGHT(A1,LEN(&quot;yz&quot;))=&quot;yz&quot;', 4)}${rule('LEN(TRIM(A1))=0', 5)}${rule('A1&gt;SUM(B1:B3)', 6)}</conditionalFormatting>`,
      ),
    });
    const { workbook, warnings } = await importXlsx(data);
    const s = workbook.active;
    expect(s.styles.get(s.getCellByView(0, 0).styleId).conditional?.map((r) => r.when)).toEqual([
      { kind: 'text', op: 'contains', text: 'ắ' },
      { kind: 'text', op: 'notContains', text: 'x' },
      { kind: 'text', op: 'startsWith', text: 'ab' },
      { kind: 'text', op: 'endsWith', text: 'yz' },
      { kind: 'blank' },
    ]);
    expect(warnings.join(' ')).toMatch(/expression/); // the last, free-form one is reported
  });
});
