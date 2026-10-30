'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { parsePdf } = require('../backend/services/parseSupplierPdf');

// Real text PDF bytes: the parser must account for pages, not just mocked rows.
function pdf(pages) {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const escape = text => String(text).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  for (const [index, cells] of pages.entries()) {
    const content = cells.map(([x, y, text]) => `BT /F1 10 Tf 1 0 0 1 ${x} ${y} Tm (${escape(text)}) Tj ET`).join('\n') + '\n';
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + index * 2} 0 R >>`,
      `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`);
  }
  let body = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(body)); body += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  body += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  body += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body);
}
const quotedPage = (name, price) => [
  [20, 740, 'No'], [80, 740, 'Product code'], [190, 740, 'Product name'], [330, 740, 'MOQ'], [420, 740, 'Unit Price RMB EXCL'],
  [20, 710, '1'], [80, 710, 'A'], [190, 710, name], [330, 710, '5K'], [420, 710, price],
];
const unreadableQuotePage = [[190, 740, 'Product name'], [330, 740, 'Qty'], [420, 740, 'Unit Price RMB EXCL'],
  [190, 710, 'Nut'], [330, 710, '2']];

function hardwareHandler(parser = parsePdf) {
  const source = fs.readFileSync(path.join(__dirname, '../backend/routes/uploads.js'), 'utf8');
  const code = source.slice(source.indexOf("router.post('/hardware-sheet'"), source.indexOf('// POST /api/uploads/sewing-sheet'));
  let handler;
  const context = vm.createContext({ router: { post(_path, _auth, _upload, callback) { handler = callback; } },
    requireAuth() {}, memUpload: { single() { return () => {}; } }, parseSupplierPdf: parser,
    parseHardwareWorkbook() { throw Error('This test sends only PDF'); } });
  vm.runInContext(code, context);
  return async (buffer, full = true) => {
    let status = 200, body;
    await handler({ user: { role: 'admin', dept: 'engineering' }, file: { originalname: 'synthetic.pdf', buffer },
      body: { target_qty: '5000', ...(full ? { full_supplier_snapshot: '1' } : {}) } },
    { status(value) { status = value; return this; }, json(value) { body = value; return this; } });
    return { status, body };
  };
}

test('full supplier snapshot rejects an unreadable PDF page instead of certifying a partial list', async () => {
  const result = await hardwareHandler()(pdf([quotedPage('Bolt', '.1'), unreadableQuotePage]));
  assert.equal(result.status, 422);
  assert.match(result.body.error, /PDF 第 2 页.*不能作为供应商完整清单/);
  assert.equal(result.body.supplier_snapshot_version, undefined);
});
test('ordinary PDF import retains partial extraction without advertising a complete supplier snapshot', async () => {
  const result = await hardwareHandler()(pdf([quotedPage('Bolt', '.1'), unreadableQuotePage]), false);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.items.map(item => item.name), ['Bolt']);
  assert.equal(result.body.supplier_snapshot_version, undefined);
});
test('full readable multi-page PDF preserves every material and page before capability is issued', async () => {
  const result = await hardwareHandler()(pdf([quotedPage('Bolt', '.1'), quotedPage('Nut', '.2')]));
  assert.equal(result.status, 200);
  assert.equal(result.body.complete_sheet_scan, true);
  assert.equal(result.body.supplier_snapshot_version, 1);
  assert.deepEqual(result.body.items.map(item => item.name), ['Bolt', 'Nut']);
  assert.deepEqual(result.body.items.map(item => item.source_sheet), ['PDF 第 1 页', 'PDF 第 2 页']);
});
test('single readable PDF page is scanned too; blank trailing pages cannot authorize deletions', async () => {
  const route = hardwareHandler();
  const single = await route(pdf([quotedPage('Bolt', '.1')]));
  assert.equal(single.status, 200);
  assert.equal(single.body.complete_sheet_scan, true);
  assert.equal(single.body.supplier_snapshot_version, 1);
  const incomplete = await route(pdf([quotedPage('Bolt', '.1'), []]));
  assert.equal(incomplete.status, 422);
  assert.equal(incomplete.body.supplier_snapshot_version, undefined);
});
test('upload route does not stamp snapshot capability on a parser result lacking scan evidence', async () => {
  const parser = async () => ({ items: [{ name: 'Bolt', unit_price_rmb: .1 }], count: 1, unpriced_items: [] });
  const full = await hardwareHandler(parser)(Buffer.from('parser stub input'));
  assert.equal(full.status, 422);
  assert.match(full.body.error, /未能完整核对/);
  assert.equal(full.body.supplier_snapshot_version, undefined);
  const ordinary = await hardwareHandler(parser)(Buffer.from('parser stub input'), false);
  assert.equal(ordinary.status, 200);
});
