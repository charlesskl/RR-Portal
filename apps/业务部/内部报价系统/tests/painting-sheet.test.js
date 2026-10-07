'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ExcelJS = require('exceljs');

const { parseWorkbook } = require('../backend/services/parsePaintingSheet');

test('painting UI includes roast and UV in the shared process calculation list', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'workbench.js'), 'utf8');
  assert.match(source, /\{\s*key:\s*'roast',\s*label:\s*'炒货'\s*\}/);
  assert.match(source, /\{\s*key:\s*'uv',\s*label:\s*'UV'\s*\}/);
  assert.match(source, /PAINTING_PROCS\.reduce\(\(s,\s*p\)\s*=>\s*s\s*\+\s*num\(r\[p\.key\s*\+\s*'_qty'\]\)\s*\*\s*num\(r\[p\.key\s*\+\s*'_unit'\]\)/);
});

test('painting import reads roast and UV prices from the new template', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('喷油0923');
  sheet.addRow(['报价模式']);
  sheet.addRow([
    '图片', '名称', '位置',
    '夹模', '夹模单价', '移印', '移印单价', '炒货', '炒货单价', '散枪', '散枪单价',
    '边模', '边模单价', '油色', '油色价格', '浸油', '浸油单价',
    '抹油', '抹油单价', '擦PP水', '擦PP水单价', 'UV', 'UV单价',
    '总报价', '备注',
  ]);
  sheet.addRow([null, 'UV测试件', '正面', null, null, null, null, 3, 0.2, null, null,
    null, null, null, null, null, null, null, null, null, null, 2, 1.25, 3.1, '测试']);

  const result = await parseWorkbook(await workbook.xlsx.writeBuffer());

  assert.equal(result.error, undefined);
  assert.equal(result.count, 1);
  assert.equal(result.sheet_used, '喷油0923');
  assert.equal(result.items[0].name, 'UV测试件');
  assert.equal(result.items[0].position, '正面');
  assert.equal(result.items[0].roast_qty, 3);
  assert.equal(result.items[0].roast_unit, 0.2);
  assert.equal(result.items[0].uv_qty, 2);
  assert.equal(result.items[0].uv_unit, 1.25);
  assert.equal(result.items[0].note, '测试');
});

test('painting import enables product ratios only for two or more explicit numbered products', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('多产品喷油');
  sheet.addRow(['图片', '名称', '位置', '移印', '移印单价']);
  sheet.addRow([null, '1#公仔', '正面', 2, 0.15]);
  sheet.addRow([null, null, '背面', 1, 0.10]);
  sheet.addRow([null, '2#公仔', '头部', 3, 0.20]);
  sheet.addRow([null, null, '身体', 2, 0.20]);

  const result = await parseWorkbook(await workbook.xlsx.writeBuffer());

  assert.equal(result.error, undefined);
  assert.equal(result.multi_product, true);
  assert.deepEqual(result.product_groups.map(group => group.id), ['product-1', 'product-2']);
  assert.deepEqual(
    result.items.map(item => item.product_group_id),
    ['product-1', 'product-1', 'product-2', 'product-2'],
  );
});

test('separate images and blank divider rows stay as one product without explicit product numbers', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('单产品多个组件');
  sheet.addRow(['图片', '名称', '位置', '移印', '移印单价', '浸油', '浸油单价']);
  sheet.addRow(['图1', '', '盒板', 2, 0.15]);
  sheet.addRow([]);
  sheet.addRow(['图2', '', '牙齿', 2, 0.05]);
  sheet.addRow(['图3', '', '洞穴', null, null, 1, 0.1]);

  const result = await parseWorkbook(await workbook.xlsx.writeBuffer());

  assert.equal(result.error, undefined);
  assert.equal(result.multi_product, false);
  assert.deepEqual(result.product_groups, []);
  assert.equal(result.items.some(item => item.product_group_id), false);
});


test('部门导出控件保留喷油、电子导入按钮和文件框，其他部门继续隐藏导入', () => {
  const vm = require('node:vm');
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '../frontend/workbench.js'), 'utf8');
  const start = source.indexOf('function installDepartmentExport(');
  const end = source.indexOf('// 按产品分组的人工表', start);
  const context = { DEPARTMENT_EXPORT_NAMES: { painting:'喷油部', molding:'啤机部', electronic:'电子部' } };
  vm.runInNewContext(source.slice(start, end), context);
  for (const dept of ['painting', 'molding', 'electronic']) {
    const removed = [];
    const host = {
      querySelectorAll: selector => selector === 'button'
        ? [{ textContent:'导入报价', remove:()=>removed.push('button') }]
        : [{ remove:()=>removed.push('file') }],
      querySelector: () => ({}), _departmentExportObserver: true,
    };
    context.installDepartmentExport(host, dept, 9);
    assert.equal(removed.length, ['painting', 'electronic'].includes(dept) ? 0 : 2);
  }
});

test('heat transfer imports quantity and price and participates in painting cost', async () => {
 const workbook = new ExcelJS.Workbook();
 const sheet = workbook.addWorksheet('喷油');
 sheet.addRow(['名称','位置','热转印','热转印单价','备注']);
 sheet.addRow(['转印件','正面',3,0.25,'测试']);
 const result = await parseWorkbook(await workbook.xlsx.writeBuffer());
 assert.equal(result.error,undefined);
 assert.equal(result.items[0].heat_transfer_qty,3);
 assert.equal(result.items[0].heat_transfer_unit,0.25);
 const source = fs.readFileSync(path.join(__dirname,'../frontend/workbench.js'),'utf8');
 const vm = require('node:vm');
 const start=source.indexOf('const PAINTING_PROCS =');
 const end=source.indexOf('];',start)+2;
 const fnStart=source.indexOf('function paintingRowAmount(');
 const fnEnd=source.indexOf('function renamePaintingProductGroup(',fnStart);
 const context=vm.createContext({num:v=>Number(v)||0});
 vm.runInContext(source.slice(start,end)+'\n'+source.slice(fnStart,fnEnd),context);
 assert.equal(context.paintingRowAmount(result.items[0]),0.75);
});
