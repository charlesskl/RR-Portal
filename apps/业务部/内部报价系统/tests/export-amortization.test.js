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

test('export separates electronic and sewing pricing and keeps weighted sewing formulas', async () => {
  const workbook = await buildWorkbook({
    quote: { quote_no: 'WEIGHTED', product_name: '加权测试', qty: 1000, factory_code: 'qingxi' },
    sections: [
      { dept: 'electronic', payload_json: JSON.stringify({ electronics: [{ name: 'IC', qty: 1, unit_price_rmb: 8.5 }] }) },
      { dept: 'sewing', payload_json: JSON.stringify({
        sewing_groups: [
          { name: '角色1', product_qty: 1, items: [{ fabric: '布1', usage: 1, mat_price: 10, markup: 1 }] },
          { name: '角色2', product_qty: 3, items: [{ fabric: '布2', usage: 1, mat_price: 20, markup: 1 }] },
        ],
      }) },
      { dept: 'sales', payload_json: JSON.stringify({
        header: { fx_rmb_hkd: 0.85, fx_hkd_usd: 7.8 },
        shipping: { markup_x: 1.2, sew_markup_x: 1.3, elec_markup_x: 1.4, divisor: 0.98,
          scenarios: [{ name: '出厂价', is_factory: true }] },
        pricing_summary: { t1: {}, t2: {}, t3: {}, t4: {}, overrides: {} },
      }) },
    ],
  });

  const worksheet = workbook.worksheets[0];
  let summaryHeaderRow;
  const labels = [];
  worksheet.eachRow(row => row.eachCell(cell => {
    if (typeof cell.value === 'string') labels.push(cell.value);
    if (cell.value === '注塑+吹气' && row.values.includes('出货底价 HKD')) summaryHeaderRow = row.number;
  }));

  assert.ok(summaryHeaderRow);
  assert.equal(worksheet.getCell(summaryHeaderRow, 3).value, '电子');
  assert.equal(worksheet.getCell(summaryHeaderRow, 4).value, '五金');
  assert.equal(worksheet.getCell(summaryHeaderRow, 11).value, '车缝');
  assert.equal(worksheet.getCell(summaryHeaderRow, 14).value, '出货底价 HKD');
  assert.match(worksheet.getCell(summaryHeaderRow + 1, 14).value.formula, /SUM\(A\d+:L\d+\)-C\d+-K\d+\+M\d+/);
  assert.ok(labels.includes('车缝'));
  assert.ok(labels.includes('电子'));
  assert.ok(labels.includes('码点 × 1.3'));
  assert.ok(labels.includes('码点 × 1.4'));

  const sewingDetail = workbook.getWorksheet('车缝明细');
  let weightedFormula;
  sewingDetail.eachRow(row => row.eachCell(cell => {
    if (typeof cell.value === 'string' && cell.value.startsWith('配套合计 RMB')) {
      weightedFormula = sewingDetail.getCell(row.number, 10).value.formula;
    }
  }));
  assert.match(weightedFormula, /\*1.*\*3/);
  assert.match(weightedFormula, /\/4$/);
});

test('export combines mold RMB and USD display prices and converts production mold fees through HKD', async () => {
  const workbook = await buildWorkbook({
    quote: { quote_no: 'MOLD-FX', product_name: '模具汇率', qty: 1000, factory_code: 'qingxi' },
    sections: [
      { dept: 'engineering', payload_json: JSON.stringify({
        molds: [{ name: '测试模具', price_rmb: 8500, price_usd: 100 }],
        mold_costs: { items: [{ name: '生产模具', price_rmb: 100 }], fx_rmb_usd: 7.75, amortization_qty: 1000 },
      }) },
      { dept: 'sales', payload_json: JSON.stringify({
        header: { fx_rmb_hkd: 0.85, fx_hkd_usd: 7.8 },
        shipping: { scenarios: [] },
      }) },
    ],
  });

  const worksheet = workbook.worksheets[0];
  let moldDisplayHkd;
  let productionMoldUsd;
  worksheet.eachRow(row => row.eachCell(cell => {
    if (cell.value === '测试模具') moldDisplayHkd = worksheet.getCell(row.number, 17).value;
    if (cell.value === '生产模具') productionMoldUsd = worksheet.getCell(row.number, 13).value;
  }));

  assert.equal(moldDisplayHkd.result, 10780);
  assert.match(moldDisplayHkd.formula, /O\d+\/0\.85\+P\d+\*7\.8/);
  assert.equal(Number(productionMoldUsd.result.toFixed(2)), 15.18);
  assert.match(productionMoldUsd.formula, /K\d+\/0\.85\/7\.75/);
});

test('export includes UV in painting detail and total quotation formula', async () => {
  const workbook = await buildWorkbook({
    quote: { quote_no: 'PAINT-UV', product_name: 'UV喷油测试', qty: 1000, factory_code: 'qingxi' },
    sections: [
      { dept: 'painting', payload_json: JSON.stringify({
        painting_items: [{
          name: 'UV测试件',
          position: '正面',
          uv_qty: 2,
          uv_unit: 1.25,
        }],
      }) },
      { dept: 'sales', payload_json: JSON.stringify({
        header: { fx_rmb_hkd: 0.85, fx_hkd_usd: 7.8 },
        shipping: { scenarios: [] },
      }) },
    ],
  });

  const worksheet = workbook.worksheets[0];
  let uvHeaderFound = false;
  let uvQuoteCell;
  worksheet.eachRow(row => row.eachCell(cell => {
    if (cell.value === 'UV') uvHeaderFound = true;
    if (cell.value === 'UV测试件') uvQuoteCell = worksheet.getCell(row.number, 22).value;
  }));

  assert.equal(uvHeaderFound, true);
  assert.equal(uvQuoteCell.result, 2.5);
  assert.match(uvQuoteCell.formula, /T\d+\*U\d+/);
});
