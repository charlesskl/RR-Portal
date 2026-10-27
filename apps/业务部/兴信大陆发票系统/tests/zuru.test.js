// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { buildJobs, extractInvoices, invoiceTotal, parseWorkbook } from '../src/lib/invoice.js';
import { generate } from '../src/lib/engine.js';
import { XlsxPackage } from '../src/lib/xlsxPackage.js';
import { ZuruSheetBuilder } from '../src/lib/zuruSheetBuilder.js';
import { cellOf, emptyBase, intlSheet, templateBuffer, usSheet, workbookBuffer } from './fixtures.js';

const parse = (sheets) => extractInvoices(parseWorkbook(workbookBuffer(sheets)));
let template;
let builder;
beforeAll(async () => {
  template = templateBuffer('zuru-tpl/兴信-zuru.xlsx');
  const pkg = await XlsxPackage.load(template);
  builder = new ZuruSheetBuilder(await pkg.getTemplateParts('兴信-zuru'));
});

describe('ZURU source parsing and amounts', () => {
  it('recognizes international and US inputs and applies 0.967 once', () => {
    const invoices = parse({ '91001': intlSheet(), 'ZB91002折': usSheet({ inv: 'ZB91002' }), '使用说明': [['not an invoice']] });
    expect(invoices).toHaveLength(2);
    expect(invoices[0]).toMatchObject({ outSheetName: '91001', invNo: '91001', format: 'intl', po: 'TEST-PO' });
    expect(invoices[1]).toMatchObject({ outSheetName: 'ZB91002', invNo: 'ZB91002', format: 'us' });
    expect(invoiceTotal(invoices[0])).toBeCloseTo(24.175, 10);
    expect(invoiceTotal(invoices[1])).toBeCloseTo(19.34, 10);
    expect(invoices.unrecognized).toEqual([]);
  });

  it('uses the final source total for a segmented invoice and leaves earlier totals blank', () => {
    const invoices = parse({
      '91003': intlSheet({ inv: '91003', total: 25 }),
      '91003-2': intlSheet({ inv: '91003-2', total: 55 }),
    });
    const jobs = buildJobs(invoices);
    expect(jobs[0]).toMatchObject({ totalValue: null, partCount: 2, partIndex: 0 });
    expect(jobs[1]).toMatchObject({ totalFromSrc: true, partCount: 2, partIndex: 1 });
    expect(jobs[1].totalValue).toBeCloseTo(55 * 0.967, 10);
    expect(jobs[1].linesTotal).toBeCloseTo(50 * 0.967, 10);
    invoices[1].srcTotal = null;
    expect(buildJobs(invoices)[1].totalValue).toBeCloseTo(50 * 0.967, 10);
  });

  it('reports an invoice-like sheet that lacks required source fields', () => {
    const invoices = parse({ '91004': [['incomplete invoice']], '说明': [['help']] });
    expect(invoices).toHaveLength(0);
    expect(invoices.unrecognized).toEqual(['91004']);
  });
});

describe('new Xingxin ZURU layout', () => {
  it('writes invoice number to H9, clears H11, and writes code with Times 12 centered style', async () => {
    const [invoice] = parse({ '91005': intlSheet({ inv: '91005' }) });
    const xml = builder.build(invoice, invoiceTotal(invoice));
    expect(cellOf(xml, 'H9')).toContain('<v>91005</v>');
    expect(cellOf(xml, 'H11')).not.toMatch(/<(?:v|t|f)[ >]/);
    expect(cellOf(xml, 'H11')).toMatch(/s="\d+"/);
    expect(cellOf(xml, 'C19')).toContain('TEST-SKU');
    expect(cellOf(xml, 'C19')).toContain(`s="${builder.cGoodsStyle}"`);
    expect(xml).not.toContain('Synthetic long description');
    expect(xml).not.toContain('ref="C19:C20"');
    expect(cellOf(xml, 'G19')).toContain('K19*0.967');
    expect(cellOf(xml, 'I19')).toContain('G19*D19');
    const zip = await JSZip.loadAsync(template);
    const styles = await zip.file('xl/styles.xml').async('string');
    const xfs = styles.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)[1].match(/<xf\b[^>]*(?:\/>|>[\s\S]*?<\/xf>)/g);
    const xf = xfs[Number(builder.cGoodsStyle)];
    const fontId = Number(xf.match(/fontId="(\d+)"/)[1]);
    const fonts = styles.match(/<fonts\b[^>]*>([\s\S]*?)<\/fonts>/)[1].match(/<font>[\s\S]*?<\/font>/g);
    expect(fonts[fontId]).toContain('name val="Times New Roman"');
    expect(fonts[fontId]).toContain('sz val="12"');
    expect(fonts[fontId]).not.toMatch(/<b(?:\s|\/|>)/);
    expect(xf).toContain('horizontal="center"');
  });

  it('keeps an unnumbered deduction blank in C and treats zero-price rows as quantity-only', () => {
    const [invoice] = parse({ '91006': intlSheet({ lines: [
      ['TEST-SKU', 'Synthetic goods', null, 10, null, null, 2.5],
      [null, 'Synthetic deduction', null, 10, null, null, -0.1],
      [null, 'Synthetic zero-price row', null, 10, null, null, 0],
    ], total: 24 }) });
    const xml = builder.build(invoice, invoiceTotal(invoice));
    expect(cellOf(xml, 'C20')).not.toContain('<v>');
    expect(cellOf(xml, 'C20')).not.toContain('<t');
    expect(cellOf(xml, 'K20')).toContain('-0.1');
    expect(cellOf(xml, 'D21')).toContain('<v>10</v>');
    for (const column of ['F', 'G', 'H', 'I', 'K']) expect(cellOf(xml, `${column}21`)).not.toMatch(/<(?:v|t|f)[ >]/);
  });

  it('moves total, merged cells, and print area when more than 25 lines are generated', async () => {
    const lines = Array.from({ length: 27 }, (_, i) => [`TEST-${i}`, 'Synthetic', null, 1, null, null, 2]);
    const invoices = parse({ '91007': intlSheet({ lines, total: 54 }) });
    const result = await generate({ baseBuffer: emptyBase(), invoices, selected: new Set(['91007']), zuruTplBuffer: template });
    const wb = XLSX.read(result.output, { type: 'array' });
    expect(wb.SheetNames).toEqual(['91007']);
    expect(wb.Sheets['91007'].C45.v).toBe('TEST-26');
    expect(wb.Sheets['91007'].I46.v).toBe(52.21);
    const zip = await JSZip.loadAsync(result.output);
    const workbookXml = await zip.file('xl/workbook.xml').async('string');
    expect(workbookXml).toContain('!$A$1:$I$46');
    const pkg = await XlsxPackage.load(result.output);
    expect((await pkg.getTemplateParts('91007')).sheetXml).toContain('ref="A46:G46"');
  });

  it('exports readable sheets with cumulative totals and warns when source and detail sums differ', async () => {
    const invoices = parse({ '91008': intlSheet({ inv: '91008' }), '91008-2': intlSheet({ inv: '91008-2', total: 55 }) });
    const result = await generate({ baseBuffer: emptyBase(), invoices, selected: new Set(invoices.map((i) => i.outSheetName)), zuruTplBuffer: template });
    const wb = XLSX.read(result.output, { type: 'array' });
    expect(wb.SheetNames).toEqual(['91008', '91008-2']);
    expect(wb.Sheets['91008'].I44?.v).toBeUndefined();
    expect(wb.Sheets['91008-2'].I44.v).toBe(53.18);
    expect(wb.Sheets['91008'].G19).toMatchObject({ f: 'K19*0.967', v: 2.4175 });
    expect(result.report.map((r) => r.status)).toEqual(['ok', 'warn']);
    expect(result.report[1].note).toContain('明细行合计');
  });

  it('skips a selected invoice already present in the supplied base workbook', async () => {
    const invoices = parse({ '91009': intlSheet({ inv: '91009' }), '91010': intlSheet({ inv: '91010' }) });
    const result = await generate({ baseBuffer: workbookBuffer({ '91009': [['existing']] }), invoices, selected: new Set(['91009', '91010']), zuruTplBuffer: template });
    expect(result.skipped).toEqual(['91009']);
    expect(XLSX.read(result.output, { type: 'array' }).SheetNames).toEqual(['91010']);
  });

  it('does not treat the bundled blank template sheet number as an existing invoice', async () => {
    // 98631 identifies the legacy layout, rather than a transaction in the bundled blank base.
    const invoices = parse({ '98631': intlSheet({ inv: '98631' }) });
    const result = await generate({
      baseBuffer: templateBuffer('base-master.xlsx'), baseIsTemplate: true,
      invoices, selected: new Set(['98631']), zuruTplBuffer: template,
    });
    expect(result.skipped).toEqual([]);
    expect(result.report[0].status).toBe('ok');
    expect(XLSX.read(result.output, { type: 'array' }).Sheets['98631'].H9.v).toBe(98631);
  });
});
