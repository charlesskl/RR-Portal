// @vitest-environment node
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { BOOKS, generateOther, planSheet } from '../src/lib/otherGuests.js';
import { generateMiandan, parseAnySourceBook } from '../src/lib/miandan.js';
import { detailHeader, detailRow, intlSheet, templateBuffer, usSheet } from './fixtures.js';

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
