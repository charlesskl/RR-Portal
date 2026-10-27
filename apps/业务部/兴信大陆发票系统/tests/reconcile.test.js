// @vitest-environment node
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { buildReportBuffer, DISCOUNT, normInvKey, parseInvName, parseInvoiceBook, parseMiandanBook, RATE, reconcile } from '../src/lib/reconcile.js';
import { workbookBuffer } from './fixtures.js';

const rowsFor = (entries) => entries.map(([inv, amount]) => ({ key: parseInvName(inv).key, inv, year: 2026, month: 10, dateStr: '10/12', sheetName: '合成面单', dUsd: amount / DISCOUNT, jUsd: amount, kHk: amount * RATE }));
const invoicesFor = (entries) => new Map(entries.map(([inv, usd]) => [parseInvName(inv).key, { inv, usd, seg: 1, sheetName: inv }]));

describe('invoice reconciliation', () => {
  it('normalizes prefixes, whitespace, revisions, and segment numbers', () => {
    expect(normInvKey(' A94001（REV1） ')).toBe('94001REV1');
    expect(parseInvName('94001-2(REV1)')).toEqual({ key: '94001REV1', rev: 1, seg: 2 });
    expect(parseInvName(' zb94002 ')).toEqual({ key: 'ZB94002', rev: 0, seg: 1 });
  });

  it('falls back from missing J/K cached values and reports duplicate cover-sheet keys', () => {
    const buffer = workbookBuffer({ '合成面单': [
      ['兴信2026年10月份(华登制品亚洲香港发票)'],
      ['日期', '客名', '发票NO:', '金额(USD)'],
      ['10/12', 'Synthetic', 'A94003', 100],
      ['10/13', 'Synthetic', '94003', 200],
    ] });
    const parsed = parseMiandanBook(buffer);
    expect(parsed.dupKeys).toEqual(['94003']);
    expect(parsed.rows[0]).toMatchObject({ key: '94003', year: 2026, month: 10, jUsd: 96.7 });
    expect(parsed.rows[0].kHk).toBeCloseTo(96.7 * 7.75, 10);
    expect(() => parseMiandanBook(workbookBuffer({ '说明': [['not a cover sheet']] }))).toThrow('面单里没有识别到任何发票行');
  });

  it('reads REV from the new H9 field and preserves legacy H10 and sheet-name fallback', () => {
    const invoiceSheet = (header) => {
      const sheet = XLSX.utils.aoa_to_sheet([['Synthetic invoice']]);
      for (const [ref, value] of Object.entries(header)) sheet[ref] = { t: 's', v: value };
      sheet.H44 = { t: 's', v: 'USD' };
      sheet.I44 = { t: 'n', v: 96.7 };
      sheet['!ref'] = 'A1:I44';
      return sheet;
    };
    const result = parseInvoiceBook(workbookBuffer({
      '94013': invoiceSheet({ H9: '94013(REV2)' }),
      '94014': invoiceSheet({ H9: 'INVOICE NO.', H10: '94014(REV1)' }),
      '94015': invoiceSheet({ H9: 'INVOICE NO.' }),
    }));
    expect([...result.map.keys()]).toEqual(['94013REV2', '94014REV1', '94015']);
    expect(result.map.get('94013REV2')).toMatchObject({ inv: '94013(REV2)', usd: 96.7 });
  });

  it('distinguishes tolerance, mismatches, missing sides, and unique revision matches', () => {
    const result = reconcile(rowsFor([['94004', 100], ['94005', 200], ['94006', 300], ['94008', 500]]), invoicesFor([['94004', 100.019], ['94005', 200.03], ['94007', 400], ['94008REV1', 500]]));
    expect(result.rows.map((r) => [r.key, r.result])).toEqual([
      ['94004', '一致'], ['94005', '差异'], ['94006', '仅面单有'], ['94007', '仅发票有'], ['94008', '一致'],
    ]);
    expect(result.summary).toMatchObject({ match: 2, diff: 1, onlyMiandan: 1, onlyInvoice: 1, revFallback: 1 });
    expect(result.rows[1].diffUsd).toBeCloseTo(-0.03, 10);
  });

  it('does not guess a revision match when multiple candidates exist', () => {
    const result = reconcile(rowsFor([['94009', 100], ['94009REV1', 200]]), invoicesFor([['94009REV2', 100]]));
    expect(result.summary).toMatchObject({ match: 0, onlyMiandan: 2, onlyInvoice: 1, revFallback: 0 });
  });

  it('exports a readable report with difference and missing-side styles', async () => {
    const checked = reconcile(rowsFor([['94010', 100], ['94011', 200], ['94012', 300]]), invoicesFor([['94010', 100], ['94011', 190]]));
    const output = await buildReportBuffer(checked, new Date('2026-10-12T00:00:00Z'));
    const book = XLSX.read(output, { type: 'array' });
    expect(book.SheetNames).toEqual(['核对分析']);
    const sheet = book.Sheets['核对分析'];
    expect(sheet.A2.v).toContain('一致 1 · 差异 1 · 仅面单有 1');
    expect(sheet.I5.v).toBe('一致');
    expect(sheet.I6.v).toBe('差异');
    expect(sheet.I7.v).toBe('仅面单有');
    const zip = await JSZip.loadAsync(output);
    const xml = await zip.file('xl/worksheets/sheet1.xml').async('string');
    expect(xml).toContain('<c r="A6" s="3"');
    expect(xml).toContain('<c r="D6" s="4"');
    expect(xml).toContain('<c r="A7" s="5"');
  });
});
