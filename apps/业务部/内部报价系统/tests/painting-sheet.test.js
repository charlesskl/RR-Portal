'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ExcelJS = require('exceljs');

const { parseWorkbook } = require('../backend/services/parsePaintingSheet');

test('painting UI includes UV in the shared process calculation list', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'workbench.js'), 'utf8');
  assert.match(source, /\{\s*key:\s*'uv',\s*label:\s*'UV'\s*\}/);
  assert.match(source, /PAINTING_PROCS\.reduce\(\(s,\s*p\)\s*=>\s*s\s*\+\s*num\(r\[p\.key\s*\+\s*'_qty'\]\)\s*\*\s*num\(r\[p\.key\s*\+\s*'_unit'\]\)/);
});

test('painting import reads UV quantity and unit price from the new template', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('喷油0923');
  sheet.addRow(['报价模式']);
  sheet.addRow([
    '图片', '名称', '位置',
    '夹模', '夹模单价', '移印', '移印单价', '散枪', '散枪单价',
    '边模', '边模单价', '油色', '油色价格', '浸油', '浸油单价',
    '抹油', '抹油单价', '擦PP水', '擦PP水单价', 'UV', 'UV单价',
    '总报价', '备注',
  ]);
  sheet.addRow([null, 'UV测试件', '正面', null, null, null, null, null, null,
    null, null, null, null, null, null, null, null, null, null, 2, 1.25, 2.5, '测试']);

  const result = await parseWorkbook(await workbook.xlsx.writeBuffer());

  assert.equal(result.error, undefined);
  assert.equal(result.count, 1);
  assert.equal(result.sheet_used, '喷油0923');
  assert.equal(result.items[0].name, 'UV测试件');
  assert.equal(result.items[0].position, '正面');
  assert.equal(result.items[0].uv_qty, 2);
  assert.equal(result.items[0].uv_unit, 1.25);
  assert.equal(result.items[0].note, '测试');
});
