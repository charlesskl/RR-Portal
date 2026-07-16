'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { buildWorkbook } = require('../backend/services/exportXlsx');

test('export keeps prototype and testing amortization when mold items are empty', async () => {
  const workbook = await buildWorkbook({
    quote: { quote_no: 'TEST-264', product_name: '分摊测试', qty: 10000 },
    sections: [
      {
        dept: 'engineering',
        payload_json: JSON.stringify({
          mold_costs: {
            items: [],
            fx_rmb_usd: 7.75,
            prototype_fee_usd: 1000,
            prototype_amortization_qty: 50000,
            testing_fee_usd: 500,
            testing_amortization_qty: 2000,
          },
        }),
      },
      {
        dept: 'sales',
        payload_json: JSON.stringify({
          header: { fx_rmb_hkd: 0.85, fx_hkd_usd: 7.8 },
          shipping: { scenarios: [] },
        }),
      },
    ],
  });

  const worksheet = workbook.worksheets[0];
  const labels = [];
  worksheet.eachRow(row => {
    row.eachCell(cell => {
      if (typeof cell.value === 'string') labels.push(cell.value);
    });
  });

  assert.ok(labels.some(value => value.includes('手板费分摊')));
  assert.ok(labels.some(value => value.includes('测试费分摊')));
});

test('Heyuan export defaults assembly labor base rate to 260', async () => {
  const workbook = await buildWorkbook({
    quote: { quote_no: 'HY-ASM', product_name: '河源装配', qty: 1000, factory_code: 'heyuan' },
    sections: [
      {
        dept: 'assembly',
        payload_json: JSON.stringify({
          assembly_step_groups: [{
            product: '测试产品',
            qty: 100,
            team: 1,
            steps: [{ name: '装配', count: 2 }],
          }],
        }),
      },
      {
        dept: 'sales',
        payload_json: JSON.stringify({
          header: { fx_rmb_hkd: 0.85, fx_hkd_usd: 7.8 },
          shipping: { scenarios: [] },
        }),
      },
    ],
  });

  const detail = workbook.getWorksheet('装配明细');
  const values = [];
  detail.eachRow(row => row.eachCell(cell => values.push(cell.value)));
  assert.ok(values.some(value => typeof value === 'string' && value.includes('基数：260 HKD')));
});

test('export keeps an explicit zero markup in tax summary', async () => {
  const workbook = await buildWorkbook({
    quote: { quote_no: 'ZERO-MARKUP', product_name: '零码点', qty: 1000, factory_code: 'qingxi' },
    sections: [{
      dept: 'sales',
      payload_json: JSON.stringify({
        header: { fx_rmb_hkd: 0.85, fx_hkd_usd: 7.8 },
        shipping: {
          markup_x: 0,
          scenarios: [{ name: '出厂价', is_factory: true, base_rmb: 1 }],
        },
        pricing_summary: { t1: {}, t2: {}, t3: {}, t4: {}, overrides: {} },
      }),
    }],
  });

  const worksheet = workbook.worksheets[0];
  let markupCell = null;
  const labels = [];
  worksheet.eachRow(row => {
    row.eachCell((cell, colNumber) => {
      if (typeof cell.value === 'string') labels.push(cell.value);
      if (cell.value === '未减税前码数') {
        markupCell = worksheet.getCell(row.number + 1, colNumber);
      }
    });
  });

  assert.equal(markupCell && markupCell.value && markupCell.value.formula, '0');
  assert.ok(labels.includes('码点 × 0'));
});
