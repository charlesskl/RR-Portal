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
