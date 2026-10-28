// @vitest-environment node
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { extractInvoices, parseWorkbook } from '../src/lib/invoice.js';
import { generate } from '../src/lib/engine.js';
import { generateMiandan, parseAnySourceBook } from '../src/lib/miandan.js';
import { parseInvoiceBook, parseMiandanBook, reconcile } from '../src/lib/reconcile.js';
import { normRange } from '../src/lib/dateRange.js';
import { date, emptyBase, intlSheet, templateBuffer, usSheet, workbookBuffer } from './fixtures.js';

describe('cover-sheet generation and reconciliation', () => {
  it('takes the last US revision, reports cancelled/incomplete sheets, and truncates cents', async () => {
    const source = workbookBuffer({
      'ZB93001折': usSheet({ inv: 'ZB93001', total: 20 }),
      'ZB93001折-2': usSheet({ inv: 'ZB93001', total: 30.129 }),
      'ZB93002折取消': usSheet({ inv: 'ZB93002' }),
      'ZB93003折': [['incomplete']],
    });
    const parsed = await parseAnySourceBook(source, 'synthetic-us.xlsx');
    expect(parsed.kind).toBe('us');
    expect(parsed.bases.get('ZB93001')).toMatchObject({ total: 30.129, versions: 2, sheetName: 'ZB93001折-2' });
    expect(parsed.cancelled).toEqual(['ZB93002折取消']);
    expect(parsed.skipped).toHaveLength(1);
    const result = await generateMiandan({ tplBuffer: templateBuffer('miandan-tpl.xlsx'), parsedList: [parsed] });
    expect(result.sheets[0].selfCheck.fails).toEqual([]);
    expect(result.sheets[0].selfCheck.checks).toBeGreaterThan(0);
    expect(result.warnings).toHaveLength(2);
    const workbook = XLSX.read(result.buffer, { type: 'array' });
    expect(workbook.SheetNames).toEqual(['华登亚洲1-12月']);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    expect(sheet.C3.v).toBe('ZB93001');
    expect(sheet.D3.v).toBe(30.12);
    expect(sheet.J3).toMatchObject({ f: 'D3*0.967' });
    expect(sheet.J3.v).toBeCloseTo(30.12 * 0.967, 10);
    expect(sheet.K3.f).toBe('E3*0.967');
  });

  it('generates both monthly sheets and reconciles every amount against independently exported invoices', async () => {
    const intlSource = workbookBuffer({
      '93004': intlSheet({ inv: '93004', when: date(2026, 9, 30), total: 25 }),
      '93004-2': intlSheet({ inv: '93004-2', when: date(2026, 9, 30), total: 50 }),
      '93005': intlSheet({ inv: '93005', when: date(2026, 10, 1) }),
    });
    const usSource = workbookBuffer({ 'ZB93006折': usSheet({ inv: 'ZB93006', when: date(2026, 10, 2) }) });
    const parsedList = await Promise.all([parseAnySourceBook(intlSource, 'synthetic-intl.xlsx'), parseAnySourceBook(usSource, 'synthetic-us.xlsx')]);
    const covers = await generateMiandan({ tplBuffer: templateBuffer('miandan-tpl.xlsx'), parsedList });
    expect(covers.sheets.map((s) => s.kind)).toEqual(['us', 'intl']);
    for (const sheet of covers.sheets) expect(sheet.selfCheck.fails).toEqual([]);
    expect(covers.sheets.find((s) => s.kind === 'intl').blocks.map((b) => b.month)).toEqual([9, 10]);
    const { rows } = parseMiandanBook(covers.buffer);
    expect(rows).toHaveLength(3);
    const invoices = [...extractInvoices(parseWorkbook(intlSource)), ...extractInvoices(parseWorkbook(usSource))];
    const generated = await generate({ baseBuffer: emptyBase(), invoices, selected: new Set(invoices.map((i) => i.outSheetName)), zuruTplBuffer: templateBuffer('zuru-tpl/兴信-zuru.xlsx') });
    const invoiceBook = parseInvoiceBook(generated.output);
    expect(invoiceBook.map.get('93004')).toMatchObject({ usd: 48.35, seg: 2 });
    const checked = reconcile(rows, invoiceBook.map);
    expect(checked.summary).toMatchObject({ match: 3, diff: 0, onlyInvoice: 0, onlyMiandan: 0 });
    const coverBook = XLSX.read(covers.buffer, { type: 'array' });
    const international = coverBook.Sheets['华登（国际）1-12月'];
    expect(international.K3.f).toBe('7.75*J3');
    expect(international.M3.f).toBe('G3');
    expect(international.D13.f).toBe('SUM(D3:D12)');
  });

  it('filters by inclusive dates and rejects a range containing no invoices', async () => {
    const source = workbookBuffer({
      '93007': intlSheet({ inv: '93007', when: date(2026, 9, 30) }),
      '93008': intlSheet({ inv: '93008', when: date(2026, 10, 1) }),
    });
    const parsedList = [await parseAnySourceBook(source)];
    const tplBuffer = templateBuffer('miandan-tpl.xlsx');
    const generated = await generateMiandan({ tplBuffer, parsedList, dateRange: normRange('2026-10-01', '2026-10-01') });
    expect(generated.filter).toEqual({ active: true, kept: 1, dropped: 1 });
    expect(parseMiandanBook(generated.buffer).rows.map((r) => r.inv)).toEqual(['93008']);
    await expect(generateMiandan({ tplBuffer, parsedList, dateRange: normRange('2027-01-01', '') })).rejects.toThrow('筛选日期范围内没有发票');
  });
});
