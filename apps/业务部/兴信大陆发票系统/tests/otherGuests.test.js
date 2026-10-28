// @vitest-environment node
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { BOOKS, bookTemplateNeeds, filterPlanByDate, generateOther, inspectTemplateBook, parseDetailWorkbook, planSheet, scanDetailSheets } from '../src/lib/otherGuests.js';
import { normRange } from '../src/lib/dateRange.js';
import { mergeWorkbookBuffers } from '../src/lib/mergeBooks.js';
import { date, detailHeader, detailRow, templateBuffer, workbookBuffer } from './fixtures.js';

describe('other-customer template matching', () => {
  it.each(Object.keys(BOOKS))('includes every required template for %s', async (key) => {
    const info = await inspectTemplateBook(templateBuffer(BOOKS[key].file.slice(1)));
    expect(info.matches[key]).toEqual({ need: bookTemplateNeeds()[key].length, hit: bookTemplateNeeds()[key].length, missing: [] });
  });

  it('reports missing templates for an unrelated uploaded workbook', async () => {
    const info = await inspectTemplateBook(workbookBuffer({ '合成工作簿': [['test']] }));
    for (const match of Object.values(info.matches)) {
      expect(match.hit).toBe(0);
      expect(match.missing).toHaveLength(match.need);
    }
  });
});

describe('other-customer planning and generation', () => {
  it('fills merged invoice identifiers without duplicating amounts, and splits at template capacity', () => {
    const rows = [detailHeader, ...Array.from({ length: 23 }, (_, index) => detailRow({ inv: index ? null : '92001', code: `TEST-${index}` }))];
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    sheet['!merges'] = [{ s: { r: 1, c: 8 }, e: { r: 23, c: 8 } }];
    const parsed = parseDetailWorkbook(workbookBuffer({ 'Zanzoon出货': sheet }));
    const plan = planSheet('Zanzoon出货', parsed['Zanzoon出货']);
    expect(plan.invoices).toHaveLength(1);
    expect(plan.invoices[0].total).toBeCloseTo(23 * 20 * 0.967, 10);
    expect(plan.chunks.map((c) => c.outName)).toEqual(['92001', '92001-2']);
    expect(plan.chunks.map((c) => c.lines.length)).toEqual([22, 1]);
    expect(plan.skippedNoInv).toEqual([]);
  });

  it('categorizes unsupported currency, excluded customers, and Indonesia sheets', () => {
    const scan = scanDetailSheets({
      'Zanzoon出货': [detailHeader, detailRow()],
      '合成客人出货': [detailHeader, detailRow()],
      '合成人民币出货': [detailHeader.map((h) => h?.replace('USD', 'RMB')), detailRow()],
      '龙昌出货': [detailHeader, detailRow({ inv: 'FE92002' })],
      '合成印尼出货': [detailHeader, detailRow()],
    });
    expect(scan.supported.map((s) => [s.name, s.guess])).toEqual([['Zanzoon出货', false], ['合成客人出货', true]]);
    expect(scan.unsupported[0].reason).toContain('RMB');
    expect(scan.excluded[0].invoices).toEqual(['92002']);
    expect(scan.indonesia).toHaveLength(1);
  });

  it('retains dated anomaly reports and filters invoice plans at inclusive date boundaries', () => {
    const rows = [detailHeader,
      detailRow({ inv: '92003', when: date(2026, 9, 30) }),
      detailRow({ inv: '92004', when: date(2026, 10, 1) }),
      detailRow({ inv: '92005', when: null }),
      detailRow({ inv: null, when: date(2026, 10, 2) }),
      detailRow({ inv: '92006', unit: null, amount: 10, when: date(2026, 10, 3) }),
    ];
    const plan = planSheet('Zanzoon出货', rows);
    expect(plan.skippedNoInv[0]).toMatchObject({ row: 5, date: date(2026, 10, 2) });
    expect(plan.anomalies[0]).toMatchObject({ row: 6, issue: '缺单价', date: date(2026, 10, 3) });
    const filtered = filterPlanByDate(plan, normRange('2026-10-01', '2026-10-31'));
    expect(filtered.plan.chunks.map((c) => c.outName)).toEqual(['92004']);
    expect(filtered.kept).toBe(1);
    expect(filtered.noDate).toBe(2);
  });

  it('generates readable normal invoices with discounted formulas and bounded print areas', async () => {
    const plan = planSheet('Zanzoon出货', [detailHeader, detailRow({ inv: '92007' }), detailRow({ inv: '92008', qty: 3, unit: 5 })]);
    const output = await generateOther({ bookBuffers: { hk: templateBuffer('other-tpl/兴信香港.xlsx') }, plans: [plan], timestamp: 'synthetic-test' });
    expect(output.files).toHaveLength(1);
    expect(output.files[0]).toMatchObject({ sheetCount: 2, cat: 'hk' });
    expect(output.report[0].total).toBeCloseTo(19.34, 10);
    expect(output.report[1].total).toBeCloseTo(14.505, 10);
    const workbook = XLSX.read(output.files[0].buffer, { type: 'array' });
    expect(workbook.SheetNames).toEqual(['92007', '92008']);
    expect(workbook.Sheets['92007'].C24.v).toBe('TEST-OTHER-SKU');
    expect(workbook.Sheets['92007'].H10.v).toBe(92007);
    expect(workbook.Sheets['92007'].G24).toMatchObject({ f: 'K24*0.967', v: 9.67 });
    expect(workbook.Sheets['92007'].I24).toMatchObject({ f: 'D24*G24', v: 19.34 });
    expect(workbook.Sheets['92007'].L24).toMatchObject({ f: 'I46', v: 19.34 });
    expect(workbook.Sheets['92007'].C25?.v).toBeUndefined();
    const zip = await JSZip.loadAsync(output.files[0].buffer);
    const xml = await zip.file('xl/workbook.xml').async('string');
    expect(xml.match(/!\$A\$8:\$I\$46/g)).toHaveLength(2);
    expect(xml).toMatch(/fullCalcOnLoad="1"/);
  });

  it('chooses the 30% deposit template from a John Adams note and retains its amount rule', async () => {
    const row = detailRow({ inv: null, qty: 10, unit: 20 });
    row[10] = '92009';
    row[11] = '定金30%';
    const plan = planSheet('John Adams出货 ', [detailHeader, row]);
    expect(plan.chunks[0]).toMatchObject({ book: 'hk2', tpl: 'John Adams出货 定金', kindEff: 'balance30' });
    expect(plan.invoices[0].total).toBeCloseTo(200 * 0.967 * 0.3, 10);
    const result = await generateOther({ bookBuffers: { hk2: templateBuffer('other-tpl/兴信香港新模板.xlsx') }, plans: [plan], timestamp: 'synthetic-test' });
    const sheet = XLSX.read(result.files[0].buffer, { type: 'array' }).Sheets['92009'];
    expect(sheet.G24).toMatchObject({ f: 'K24*0.967', v: 19.34 });
    expect(sheet.L24.v).toBeCloseTo(58.02, 10);
  });

  it('merges different template books without losing sheets, print areas, or style references', async () => {
    const normal = planSheet('Zanzoon出货', [detailHeader, detailRow({ inv: '92010' })]);
    const depositRow = detailRow({ inv: null, qty: 10, unit: 20 });
    depositRow[10] = '92010';
    depositRow[11] = '定金30%';
    const deposit = planSheet('John Adams出货 ', [detailHeader, depositRow]);
    const output = await generateOther({
      bookBuffers: { hk: templateBuffer('other-tpl/兴信香港.xlsx'), hk2: templateBuffer('other-tpl/兴信香港新模板.xlsx') },
      plans: [normal, deposit], timestamp: 'synthetic-test',
    });
    const merged = await mergeWorkbookBuffers(output.files.map((file) => ({ buffer: file.buffer, tag: file.label })));
    expect(merged.renames).toEqual([{ from: '92010', to: '92010-JohnAdams' }]);
    const book = XLSX.read(merged.buffer, { type: 'array' });
    expect(book.SheetNames).toEqual(['92010', '92010-JohnAdams']);
    expect(book.Sheets['92010'].L24.v).toBeCloseTo(19.34, 10);
    expect(book.Sheets['92010-JohnAdams'].L24.v).toBeCloseTo(58.02, 10);
    const zip = await JSZip.loadAsync(merged.buffer);
    const workbookXml = await zip.file('xl/workbook.xml').async('string');
    expect(workbookXml.match(/!\$A\$8:\$I\$46/g)).toHaveLength(2);
    const styles = await zip.file('xl/styles.xml').async('string');
    const styleCount = Number(styles.match(/<cellXfs count="(\d+)"/)[1]);
    for (const [path, entry] of Object.entries(zip.files)) {
      if (!/^xl\/worksheets\/sheet\d+\.xml$/.test(path)) continue;
      const xml = await entry.async('string');
      for (const match of xml.matchAll(/\bs="(\d+)"/g)) expect(Number(match[1])).toBeLessThan(styleCount);
    }
  });
});
