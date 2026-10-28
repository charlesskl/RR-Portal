// @vitest-environment node
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { BOOKS, generateOther, planSheet } from '../src/lib/otherGuests.js';
import { generateMiandan, parseAnySourceBook } from '../src/lib/miandan.js';
import { generate } from '../src/lib/engine.js';
import { extractInvoices, parseWorkbook } from '../src/lib/invoice.js';
import { detailHeader, detailRow, emptyBase, intlSheet, templateBuffer, usSheet, workbookBuffer } from './fixtures.js';

describe('reviewed invoice boundaries', () => {
  it.each([4, 0, -2])('keeps Tigerhead 50%% tooling formulas consistent for quantity %s', async (qty) => {
    const row = detailRow({ inv: null, qty, unit: 100 });
    row[9] = '99001'; row[11] = '尾期50%';
    const plan = planSheet('Tigerhead其他费用', [detailHeader, row]);
    const output = await generateOther({
      bookBuffers: { hk2: templateBuffer(BOOKS.hk2.file.slice(1)) },
      plans: [plan], timestamp: 'synthetic-review',
    });
    const sheet = XLSX.read(output.files[0].buffer).Sheets['99001'];
    expect(sheet.I24).toMatchObject({ f: 'K24*D24', v: 100 * qty });
    // Evaluate the actual emitted formula chain, independently of total caches.
    const recalculated = sheet.K24.v * sheet.D24.v * 0.5;
    expect(sheet.I46.v).toBe(recalculated);
    expect(output.report[0].total).toBe(recalculated);
  });

  it('retains direct-amount tooling fee rows without inventing a quantity', async () => {
    const row = detailRow({ inv: null, qty: null, unit: null, amount: 400 });
    row[9] = '99001'; row[11] = '尾期50%';
    const plan = planSheet('Tigerhead其他费用', [detailHeader, row]);
    const output = await generateOther({
      bookBuffers: { hk2: templateBuffer(BOOKS.hk2.file.slice(1)) },
      plans: [plan], timestamp: 'synthetic-review',
    });
    const sheet = XLSX.read(output.files[0].buffer).Sheets['99001'];
    expect(sheet.I24).toMatchObject({ f: 'K24', v: 400 });
    expect(sheet.D24?.v).toBeUndefined();
    expect(sheet.I46.v).toBe(200);
  });

  it.each(['us', 'intl'])('reads %s source labels stored as shared, direct, or inline rich text', async (kind) => {
    const book = XLSX.utils.book_new();
    const name = kind === 'us' ? 'ZB91001折' : '91001';
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(kind === 'us' ? usSheet() : intlSheet()), name);
    for (const representation of ['shared', 'direct', 'inline']) {
      let buffer = XLSX.write(book, { type: 'array', bookType: 'xlsx', bookSST: representation === 'shared' });
      if (representation === 'inline') {
        const zip = await JSZip.loadAsync(buffer);
        const path = 'xl/worksheets/sheet1.xml';
        const xml = await zip.file(path).async('string');
        zip.file(path, xml.replace(/<c\b([^>]*?)\bt="str"([^>]*?)><v>([\s\S]*?)<\/v><\/c>/g,
          (_, a, b, text) => `<c${a}t="inlineStr"${b}><is><r><t>${text.slice(0, 2)}</t></r><r><t>${text.slice(2)}</t></r></is></c>`));
        buffer = await zip.generateAsync({ type: 'arraybuffer' });
      }
      const parsed = await parseAnySourceBook(buffer, 'synthetic-review.xlsx');
      expect(parsed.bases.size, representation).toBe(1);
      expect(parsed.skipped).toEqual([]);
      const source = parsed.bases.values().next().value;
      expect(source.total).toBe(kind === 'us' ? 20 : 25);
      expect(source.date).toEqual({ y: 2026, m: 10, d: 12 });
      if (kind === 'intl') expect(source.customer).toBe('ZURU INC');
      const generated = await generateMiandan({ tplBuffer: templateBuffer('miandan-tpl.xlsx'), parsedList: [parsed] });
      expect(generated.sheets[0].selfCheck.fails).toEqual([]);
    }
  });
});

describe('reviewed multipart invoice boundaries', () => {
  const legacy = (unit) => {
    const rows = []; rows[23] = [];
    rows[23][2] = 'SYNTHETIC'; rows[23][3] = 1; rows[23][10] = unit;
    return rows;
  };
  const run = (invoices, baseBuffer = emptyBase()) => generate({
    baseBuffer, invoices, selected: new Set(invoices.map((v) => v.outSheetName)),
    zuruTplBuffer: templateBuffer('zuru-tpl/兴信-zuru.xlsx'),
  });
  const parts = (sheets, clearTotal = true) => {
    const invoices = extractInvoices(parseWorkbook(workbookBuffer(sheets)));
    if (clearTotal) for (const invoice of invoices) invoice.srcTotal = null;
    return invoices;
  };

  it('adds only preceding historical parts and excludes a later saved segment', async () => {
    const result = await run(parts({ '99001-2': intlSheet({ inv: '99001-2' }) }),
      workbookBuffer({ '99001': legacy(10), '99001-3': legacy(1000) }));
    expect(result.report[0].total).toBeCloseTo(35 * 0.967, 10);
    const sheet = XLSX.read(result.output).Sheets['99001-2'];
    expect(sheet.I44.v).toBe(33.84);
  });

  it('adds a missing historical middle segment even when the first segment is selected', async () => {
    const result = await run(parts({ '99001': intlSheet({ inv: '99001' }), '99001-3': intlSheet({ inv: '99001-3' }) }),
      workbookBuffer({ '99001-2': legacy(100) }));
    expect(result.report.at(-1).total).toBeCloseTo(150 * 0.967, 10);
    const sheets = XLSX.read(result.output).Sheets;
    expect(sheets['99001'].I44?.v).toBeUndefined();
    expect(sheets['99001-3'].I44.v).toBe(145.05);
  });

  it('uses numeric segment order through the tenth part and preserves source cumulative totals', async () => {
    const sheets = {};
    for (let i = 1; i <= 10; i++) {
      const name = '99002' + (i === 1 ? '' : `-${i}`);
      sheets[name] = intlSheet({ inv: name, total: i * 10 });
    }
    const result = await run(parts(sheets, false));
    expect(result.report.filter((r) => r.total !== null).map((r) => r.name)).toEqual(['99002-10']);
    expect(result.report.at(-1).total).toBe(96.7);
    expect(XLSX.read(result.output).SheetNames.at(-1)).toBe('99002-10');
  });

  it('rejects selected normalized worksheet-name collisions before producing an invalid workbook', async () => {
    const invoices = parts({ '99003': intlSheet({ inv: '99003' }), '99003折': intlSheet({ inv: '99003' }) });
    await expect(run(invoices)).rejects.toThrow('发票工作表名称冲突：99003');
  });

  it.each([
    { name: 'a direct-amount fee', lines: [{ kind: 'item', code: 'TEST', qty: 1, unit: 10 }, { kind: 'fee', code: 'TEST FEE', qty: 1, unit: 100 }], own: 110 },
    { name: 'a negative deduction without a goods code', lines: [{ kind: 'ma', code: null, qty: 10, unit: -1 }], own: -10 },
    { name: 'extended lines past the old 24-row and 60-row limits', lines: Array.from({ length: 45 }, () => ({ kind: 'item', code: 'TEST', qty: 1, unit: 10 })), own: 450 },
  ])('retains $name when an actually exported historical invoice becomes the next base', async ({ lines, own }) => {
    const invoice = { srcSheetName: '99010', outSheetName: '99010', invNo: '99010', invNoIsNumber: true,
      date: new Date(Date.UTC(2026, 9, 12)), po: 'TEST-PO', lines, srcTotal: null };
    const history = await generate({ baseBuffer: templateBuffer('base-master.xlsx'), baseIsTemplate: true,
      invoices: [invoice], selected: new Set(['99010']), slimOutput: true });
    const result = await run(parts({ '99010-2': intlSheet({ inv: '99010-2' }) }), history.output);
    expect(result.report[0].total).toBeCloseTo((own + 25) * 0.967, 10);
  });

  it('sums each modern historical part own rows rather than its cumulative total', async () => {
    const invoices = parts({ '99011': intlSheet({ inv: '99011' }), '99011-2': intlSheet({ inv: '99011-2' }) });
    const history = await run(invoices);
    const result = await run(parts({ '99011-3': intlSheet({ inv: '99011-3' }) }), history.output);
    expect(result.report[0].total).toBeCloseTo(75 * 0.967, 10);
  });
});
