// @vitest-environment node
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { BOOKS, generateOther } from '../src/lib/otherGuests.js';
import { templateBuffer } from './fixtures.js';

const cases = [
  { name: 'normal discounted invoice', book: 'hk', tpl: 'Zanzoon', kind: 'normal', dataEnd: 45, factor: 0.967, pct: 1, subtotalRef: 'I46', totalFormula: 'SUM(I24:I45)' },
  { name: 'TOMY 50% deposit', book: 'hk', tpl: 'TOMY (9)', kind: 'deposit', dataEnd: 40, factor: 1, pct: 0.5, subtotalRef: 'I41', adjustedRef: 'I43', totalFormula: 'I43' },
  { name: 'John Adams 70% balance', book: 'hk', tpl: 'John Adams (5)', kind: 'balance70', dataEnd: 40, factor: 0.967, pct: 0.7, subtotalRef: 'I41', adjustedRef: 'I43', totalFormula: 'I43' },
  { name: 'John Adams 30% deposit', book: 'hk2', tpl: 'John Adams出货 定金', kind: 'balance30', dataEnd: 41, factor: 0.967, pct: 0.3, subtotalRef: 'I42', adjustedRef: 'I44', totalFormula: 'I44' },
  { name: 'Tigerhead 50% tooling balance', book: 'hk2', tpl: 'Tigerhead模费50%', kind: 'fee50', dataEnd: 41, factor: 1, pct: 0.5, subtotalRef: 'I42', adjustedRef: 'I44', totalFormula: 'I44' },
  { name: 'Far East 100% tooling deposit', book: 'yd', tpl: 'Tigerhead (2)', kind: 'deposit100', dataEnd: 41, factor: 1, pct: 1, subtotalRef: 'I42', adjustedRef: 'I44', totalFormula: 'I44' },
  { name: 'Far East 50% tooling balance', book: 'yd', tpl: 'Tokidos', kind: 'balance50', dataEnd: 41, factor: 1, pct: 0.5, subtotalRef: 'I42', adjustedRef: 'I44', totalFormula: 'I44' },
];

async function generateCase(spec, unit = 200, templateOverride) {
  const total = unit * spec.factor * spec.pct;
  const output = await generateOther({
    bookBuffers: { [spec.book]: templateOverride || templateBuffer(BOOKS[spec.book].file.slice(1)) },
    plans: [{ sheetName: 'Synthetic', label: 'Synthetic', chunks: [{
      book: spec.book, tpl: spec.tpl, kindEff: spec.kind, dataEnd: spec.dataEnd,
      outName: '99001', date: new Date(2026, 9, 1), ctx: { pct: spec.pct }, total, flags: [],
      lines: [{ kind: 'item', po: 'TEST-PO', code: 'TEST-SKU', desc: 'Synthetic item', qty: 1, unit }],
    }] }], timestamp: 'synthetic-cache-test',
  });
  const sheet = XLSX.read(output.files[0].buffer, { type: 'array' }).Sheets['99001'];
  return { sheet, total, report: output.report[0] };
}

describe('other-customer exported total caches', () => {
  it.each(cases)('$name is readable before Excel recalculates', async (spec) => {
    const { sheet, total, report } = await generateCase(spec);
    expect(sheet.I46.f).toBe(spec.totalFormula);
    expect(sheet.I46.v).toBeCloseTo(total, 10);
    expect(sheet.I46.v).toBeCloseTo(report.total, 10);
    expect(sheet[spec.subtotalRef].v).toBeCloseTo(200 * spec.factor, 10);
    if (spec.adjustedRef) expect(sheet[spec.adjustedRef].v).toBeCloseTo(total, 10);
    expect(sheet.L24).toMatchObject({ f: 'I46' });
    expect(sheet.L24.v).toBeCloseTo(total, 10);
    expect(sheet.L46.v).toBeCloseTo(total, 10);
  });

  it.each([0, -20.125])('retains a valid zero or negative amount (%s)', async (unit) => {
    const { sheet, total } = await generateCase(cases[3], unit);
    expect(sheet.I46.v).toBeCloseTo(total, 10);
    expect(sheet.I42.v).toBeCloseTo(unit * 0.967, 10);
    expect(sheet.I44.v).toBeCloseTo(total, 10);
  });

  it('replaces stale custom-template caches without rewriting formulas', async () => {
    const spec = cases[3];
    const zip = await JSZip.loadAsync(templateBuffer(BOOKS[spec.book].file.slice(1)));
    for (const [name, entry] of Object.entries(zip.files)) {
      if (!/^xl\/worksheets\/sheet\d+\.xml$/.test(name)) continue;
      zip.file(name, (await entry.async('string'))
        .replace(/(<f>[^<]*<\/f>)<v>[^<]*<\/v>/g, '$1<v>999999</v>')
        .replace(/<c\b([^>]*r="L25"[^>]*?)(?:\/>|>[\s\S]*?<\/c>)/, '<c$1><f>I46</f><v>999999</v></c>'));
    }
    const template = await zip.generateAsync({ type: 'arraybuffer' });
    const { sheet, total } = await generateCase(spec, 200, template);
    expect(sheet.I42).toMatchObject({ f: 'SUM(I24:I41)' });
    expect(sheet.I44).toMatchObject({ f: 'I42*30%' });
    expect(sheet.I46).toMatchObject({ f: 'I44' });
    expect(sheet.I42.v).toBeCloseTo(193.4, 10);
    expect(sheet.I44.v).toBeCloseTo(total, 10);
    expect(sheet.I46.v).toBeCloseTo(total, 10);
    expect(sheet.L25?.v).toBeUndefined();
    expect(sheet.L46.v).toBeCloseTo(total, 10);
  });
});
