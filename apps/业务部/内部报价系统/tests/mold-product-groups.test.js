'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const JSZip = require('jszip');
const XLSX = require('xlsx');

const { parseWorkbook } = require('../backend/services/parseMoldSheet');
const { extractImagesByRow } = require('../backend/services/extractXlsxImages');

test('mold import separates products by merged image row ranges', () => {
  const workbook = XLSX.utils.book_new();
  const rows = [
    ['模号', '', '名称', '', '', '料型', '料重(G)', '料重(G)含损耗', '料价(G)', '机型（A）', '件数', '套数', '目标数', '啤工', '料金额', '图片'],
    ['NO.01', '', '产品一外壳', '', '', 'PP', 10, 10, 0.01, 10, 1, 1, 3000, 0.1, 0.1, ''],
    ['NO.02', '', '产品一配件', '', '', 'PVC', 5, 5, 0.02, 10, 2, 2, 2500, 0.1, 0.1, ''],
    ['NO.03', '', '产品二外壳', '', '', 'PP', 12, 12, 0.01, 14, 1, 1, 3000, 0.1, 0.1, ''],
    ['NO.04', '', '产品二配件', '', '', 'PVC', 6, 6, 0.02, 10, 2, 2, 2500, 0.1, 0.1, ''],
  ];
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 1 } },
    { s: { r: 0, c: 2 }, e: { r: 0, c: 4 } },
    { s: { r: 0, c: 15 }, e: { r: 0, c: 17 } },
    { s: { r: 1, c: 15 }, e: { r: 2, c: 17 } },
    { s: { r: 3, c: 15 }, e: { r: 4, c: 17 } },
  ];
  XLSX.utils.book_append_sheet(workbook, sheet, 'Sheet1');

  const result = parseWorkbook(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }));
  assert.deepEqual(result.product_groups.map(group => group.source_rows), [[2, 3], [4, 5]]);
  assert.deepEqual(
    result.molds.map(mold => mold.product_group_name),
    ['产品1', '产品1', '产品2', '产品2']
  );
});

test('mold import treats each product mold worksheet as a separate product', () => {
  const workbook = XLSX.utils.book_new();
  const makeRows = (prefix, count) => [
    ['模号', '', '名称', '', '', '料型', '料重(G)', '料重(G)含损耗', '料价(G)', '机型（A）', '件数', '套数', '目标数', '啤工', '料金额', '图片'],
    ...Array.from({ length: count }, (_, index) => [
      `NO.${String(index + 1).padStart(2, '0')}`, '', `${prefix}配件${index + 1}`, '', '',
      'PP', 10, 10.3, 0.01, index === 0 ? 18 : 10, 1, 1,
      index === 0 ? 3400 : 3000, index === 0 ? 0.565 : 0.1, 0.1,
      index === 0 ? `=DISPIMG("ID_${prefix}",1)` : '',
    ]),
  ];
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(makeRows('一', 2)), '1#产品模具');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(makeRows('二', 3)), '2#产品模具');

  const result = parseWorkbook(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }));
  assert.deepEqual(result.sheets_used, ['1#产品模具', '2#产品模具']);
  assert.deepEqual(result.product_groups.map(group => group.name), ['1#产品', '2#产品']);
  assert.deepEqual(result.product_groups.map(group => group.sheet_index), [0, 1]);
  assert.deepEqual(
    result.molds.map(mold => [mold.product_group_name, mold._sheet_index]),
    [
      ['1#产品', 0], ['1#产品', 0],
      ['2#产品', 1], ['2#产品', 1], ['2#产品', 1],
    ]
  );
  assert.equal(result.molds[0].machine, '18A');
  assert.equal(result.molds[0].machine_model, '18A');
  assert.equal(result.molds[0].target, 3400);
  assert.equal(result.molds[0].shot_price, 0.565);
});

test('WPS DISPIMG cell images are extracted at their worksheet rows', async () => {
  const zip = new JSZip();
  zip.file('xl/media/image1.png', Buffer.from('89504e470d0a1a0a', 'hex'));
  zip.file('xl/_rels/cellimages.xml.rels', `<?xml version="1.0"?>
    <Relationships>
      <Relationship Id="rId1" Target="media/image1.png"/>
    </Relationships>`);
  zip.file('xl/cellimages.xml', `<?xml version="1.0"?>
    <etc:cellImages xmlns:etc="x" xmlns:xdr="y" xmlns:a="z">
      <etc:cellImage><xdr:pic>
        <xdr:nvPicPr><xdr:cNvPr name="ID_TEST"/></xdr:nvPicPr>
        <xdr:blipFill><a:blip r:embed="rId1"/></xdr:blipFill>
      </xdr:pic></etc:cellImage>
    </etc:cellImages>`);
  zip.file('xl/worksheets/sheet1.xml', `<?xml version="1.0"?>
    <worksheet><sheetData><row r="8">
      <c r="P8" t="str"><f>_xlfn.DISPIMG(&quot;ID_TEST&quot;,1)</f></c>
    </row></sheetData></worksheet>`);
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mold-cell-image-'));
  const images = await extractImagesByRow(await zip.generateAsync({ type: 'nodebuffer' }), outputDir);
  assert.equal(images.length, 1);
  assert.equal(images[0].row, 7);
  assert.equal(images[0].col, 15);
  assert.equal(images[0].sheetIndex, 0);
  assert.ok(fs.existsSync(path.join(outputDir, images[0].file)));
});

test('mold UI renders product headers and per-product subtotals', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'frontend', 'workbench.js'),
    'utf8'
  );
  assert.match(source, /data-product-group-name/);
  assert.match(source, /共 \$\{groupMolds\.length\} 副模具/);
  assert.match(source, /groupRmb\s*=\s*sum\(groupMolds/);
  assert.match(source, /product_group_name \|\| ''\)\}\s*小计/);
  assert.match(source, /key: 'product_group_name', label: '产品'/);
  assert.match(source, /product_group_id \|\| row\.product_group_name/);
  assert.match(source, /原料 \$\{formatNum\(groupRaw\)\} \+ 啤价/);
  assert.match(source, /class="product-mix-ratio"/);
  assert.match(source, /product_mix_ratios/);
  assert.match(source, /weightedInjectionSum/);
});
