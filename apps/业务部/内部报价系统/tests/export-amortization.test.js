'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { buildWorkbook, adaptSurtaxForBase } = require('../backend/services/exportInternal');

test('surtax is stored and exported as a direct HKD amount', async () => {
  const args = {
    quote: { quote_no: 'SURTAX-HKD', product_name: '附加税港币', qty: 1000 },
    sections: [{
      dept: 'sales',
      payload_json: JSON.stringify({
        header: { fx_rmb_hkd: 0.85, fx_hkd_usd: 7.8 },
        pricing_summary: { surtax: 0.1 },
        shipping: { scenarios: [] },
      }),
    }],
  };

  const adapted = adaptSurtaxForBase(args);
  const adaptedSales = JSON.parse(adapted.sections[0].payload_json);
  assert.equal(adaptedSales.pricing_summary.surtax, 0.085);
  assert.equal(JSON.parse(args.sections[0].payload_json).pricing_summary.surtax, 0.1);

  const workbook = await buildWorkbook(args);
  const worksheet = workbook.getWorksheet('报价明细');
  let summaryRow = 0;
  worksheet.eachRow(row => {
    if (row.getCell(1).value === '十、合计') summaryRow = row.number + 2;
  });
  assert.ok(summaryRow);
  assert.equal(worksheet.getCell(summaryRow, 13).value, 0.1);
  assert.match(worksheet.getCell(summaryRow, 14).value.formula, new RegExp(`\\+M${summaryRow}$`));
});

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

test('export calculates pre-tax markup as base price divided by total cost', async () => {
  const workbook = await buildWorkbook({
    quote: { quote_no: 'ZERO-MARKUP', product_name: '零码点', qty: 1000, factory_code: 'qingxi' },
    sections: [
      { dept: 'sales', payload_json: JSON.stringify({
        header: { fx_rmb_hkd: 0.85, fx_hkd_usd: 7.8 },
        shipping: {
          markup_x: 1.2,
          scenarios: [{ name: '出厂价', is_factory: true, base_rmb: 1 }],
        },
        pricing_summary: {
          t1: { base_price: 51.3 },
          t2: { color_box: 42.75 },
          t3: {},
          t4: {},
          overrides: { 't1.base_price': true, 't2.color_box': true },
        },
      }) },
    ],
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

  const formulaMatch = markupCell && markupCell.value && markupCell.value.formula
    && markupCell.value.formula.match(/^IFERROR\(([A-Z]+\d+)\/(K\d+),0\)$/);
  assert.ok(formulaMatch);
  const resultOf = (addr) => {
    const value = worksheet.getCell(addr).value;
    return Number(value && typeof value === 'object' ? value.result : value) || 0;
  };
  const expected = resultOf(formulaMatch[1]) / resultOf(formulaMatch[2]);
  assert.equal(Number(markupCell.value.result.toFixed(4)), Number(expected.toFixed(4)));
  assert.ok(labels.includes('码点 × 1.2'));
});

test('export tax-summary base price uses the live page formula result instead of a stale snapshot', async () => {
  const workbook = await buildWorkbook({
    quote: { quote_no: 'LIVE-BASE', product_name: '实时货价', qty: 1000, factory_code: 'qingxi' },
    sections: [
      { dept: 'painting', payload_json: JSON.stringify({
        painting_items: [{ name: 'UV件', position: '正面', uv_qty: 2, uv_unit: 1.25 }],
      }) },
      { dept: 'sales', payload_json: JSON.stringify({
        header: { fx_rmb_hkd: 0.85, fx_hkd_usd: 7.8 },
        shipping: {
          markup_x: 1.2,
          divisor: 0.98,
          freight_pct: 48,
          lifting_pct: 52,
          scenarios: [{ name: '盐田40柜', _freight_rate: 1 }],
        },
        pricing_summary: {
          t1: { base_price: 999 },
          t2: {},
          t3: {},
          t4: {},
          overrides: {},
        },
      }) },
    ],
  });

  const worksheet = workbook.worksheets[0];
  let titleRow;
  worksheet.eachRow(row => {
    if (row.getCell(1).value === '一、出厂货价核') titleRow = row.number;
  });
  const basePriceCell = worksheet.getCell(titleRow + 2, 1).value;

  assert.equal(Number(basePriceCell.result.toFixed(4)), 4.2);
  assert.doesNotMatch(basePriceCell.formula, /SUM/);
});

test('page base price uses customer TOTAL HKD multiplied by divisor', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'workbench.js'), 'utf8');
  assert.match(source, /customerBeforeDivisorHkd\s*=\s*customerTotalHkd\s*\*\s*num\(s\.divisor\)/);
  assert.match(source, /base_price:\s*shippingCalc\.customerBeforeDivisorHkd/);
  assert.match(source, /codeBefore\s*=\s*totalCost\s*>\s*0\s*\?\s*basePrice\s*\/\s*totalCost\s*:\s*0/);
});

test('export tax-summary base price preserves a manual page override', async () => {
  const workbook = await buildWorkbook({
    quote: { quote_no: 'OVERRIDE-BASE', product_name: '手填货价', qty: 1000, factory_code: 'qingxi' },
    sections: [{ dept: 'sales', payload_json: JSON.stringify({
      header: { fx_rmb_hkd: 0.85, fx_hkd_usd: 7.8 },
      shipping: { markup_x: 1.2, scenarios: [] },
      pricing_summary: {
        t1: { base_price: 8.7836 },
        t2: {},
        t3: {},
        t4: {},
        overrides: { 't1.base_price': true },
      },
    }) }],
  });

  const worksheet = workbook.worksheets[0];
  let titleRow;
  worksheet.eachRow(row => {
    if (row.getCell(1).value === '一、出厂货价核') titleRow = row.number;
  });

  assert.equal(worksheet.getCell(titleRow + 2, 1).value, 8.7836);
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

test('internal export lists Indonesian freight by department and links its total into quotation summary', async () => {
  const workbook = await buildWorkbook({
    quote: { quote_no: 'INDO-DETAIL', product_name: '印尼运费明细', qty: 1000, factory_code: 'qingxi' },
    sections: [
      { dept: 'engineering', payload_json: JSON.stringify({
        indo_pct: 10,
        hardware: [{ name: '五金', qty: 1, unit_price: 10 }],
        aux_materials: [{ name: '辅助', qty: 1, unit_price: 20 }],
        packaging_materials: [{ name: '包装', qty: 1, unit_price: 30 }],
      }) },
      { dept: 'electronic', payload_json: JSON.stringify({
        indo_pct: 5,
        electronics: [{ name: '电子', qty: 1, unit_price: 40 }],
      }) },
      { dept: 'molding', payload_json: JSON.stringify({
        indo_pct: 2,
        injection: [{ name: '注塑', weight_g: 0, material_unit_price: 0, shot_price: 50 }],
        blow_items: [{ name: '吹气', weight_g: 0, blow_labor: 20, flash: 0, profit_x: 1 }],
      }) },
      { dept: 'slush', payload_json: JSON.stringify({
        indo_pct: 3,
        slush_items: [{ name: '搪胶', qty: 1, unit_price_hkd: 10 }],
      }) },
      { dept: 'sewing', payload_json: JSON.stringify({
        indo_pct: 4,
        sewing_groups: [{
          name: '角色',
          product_qty: 1,
          items: [
            { fabric: '面料', usage: 1, mat_price: 8, markup: 1 },
            { fabric: '车缝人工', usage: 1, mat_price: 100, markup: 1 },
          ],
        }],
      }) },
      { dept: 'painting', payload_json: JSON.stringify({
        indo_pct: 6,
        painting_items: [{ name: '喷油', clamp_qty: 1, clamp_unit: 100 }],
      }) },
      { dept: 'sales', payload_json: JSON.stringify({
        header: { fx_rmb_hkd: 0.8, fx_hkd_usd: 7.8 },
        shipping: { scenarios: [] },
      }) },
    ],
  });

  const worksheet = workbook.getWorksheet('报价明细');
  let detailTitleRow = 0;
  let summaryRow = 0;
  const indoHeaderRows = [];
  worksheet.eachRow(row => {
    if (row.getCell(1).value === '印尼运费明细（各部门基数 × 点数%）') detailTitleRow = row.number;
    if (row.getCell(1).value === '十、合计') summaryRow = row.number + 2;
    if (String(row.getCell(11).value || '').startsWith('印尼运费 ')) indoHeaderRows.push(row.number);
  });
  assert.ok(detailTitleRow);
  const firstDataRow = detailTitleRow + 2;
  const totalRow = firstDataRow + 6;
  assert.equal(worksheet.getCell(firstDataRow, 1).value, '工程：五金＋辅助＋包装');
  assert.match(worksheet.getCell(firstDataRow, 2).value.formula, /\+/);
  assert.equal(worksheet.getCell(firstDataRow, 4).value.formula, `B${firstDataRow}*C${firstDataRow}/100`);
  assert.equal(worksheet.getCell(firstDataRow + 4, 1).value, '车缝材料（不含人工）');
  assert.equal(Number(worksheet.getCell(firstDataRow + 4, 2).value.result.toFixed(4)), 10);
  assert.match(worksheet.getCell(firstDataRow + 5, 2).value.formula, /\*30%/);
  assert.equal(Number(worksheet.getCell(totalRow, 4).value.result.toFixed(4)), 11.9);
  assert.equal(worksheet.getCell(summaryRow, 9).value.formula, `D${totalRow}`);
  assert.deepEqual(
    indoHeaderRows.map(row => worksheet.getCell(row, 11).value),
    ['印尼运费 5%', '印尼运费 10%', '印尼运费 10%', '印尼运费 10%']
  );
  const electronicHeaderRow = indoHeaderRows[0];
  assert.equal(
    worksheet.getCell(electronicHeaderRow + 1, 11).value.formula,
    `J${electronicHeaderRow + 1}*5/100`
  );
});

test('internal export mirrors UI formulas for slush and each departmental Indonesian freight', async () => {
  const workbook = await buildWorkbook({
    quote: { quote_no: 'UI-FORMULAS', product_name: '部门公式', qty: 1000, factory_code: 'qingxi' },
    sections: [
      { dept: 'molding', payload_json: JSON.stringify({
        indo_pct: 2,
        injection: [{ name: '注塑', weight_g: 10, material_unit_price: 0.01, shot_price: 0.5 }],
        blow_items: [{ name: '吹气', weight_g: 454, material_price_lb: 1, blow_labor: 1, flash: 0.5, profit_x: 2 }],
      }) },
      { dept: 'slush', payload_json: JSON.stringify({
        indo_pct: 3,
        slush_items: [{
          name: '搪胶',
          qty: 2,
          weight_g: 454,
          material_price_lb: 2,
          slush_labor_24h: 100,
          batch_labor_12h: 50,
          diesel_24h: 30,
          electricity_24h: 20,
          pigment_price: 25,
          daily_output: 100,
          batch_output_12h: 50,
          shipping_bag: 0.5,
          markup_x: 1.2,
        }],
      }) },
      { dept: 'sewing', payload_json: JSON.stringify({
        indo_pct: 4,
        sewing_groups: [{
          name: '角色',
          product_qty: 1,
          items: [
            { fabric: '面料', usage: 2, mat_price: 4, markup: 1.5 },
            { fabric: '车缝人工', usage: 1, mat_price: 100, markup: 1 },
          ],
        }],
      }) },
      { dept: 'painting', payload_json: JSON.stringify({
        indo_pct: 6,
        painting_items: [{ name: '喷油', clamp_qty: 2, clamp_unit: 5 }],
      }) },
      { dept: 'sales', payload_json: JSON.stringify({
        header: { fx_rmb_hkd: 0.8, fx_hkd_usd: 7.8 },
        shipping: { scenarios: [] },
      }) },
    ],
  });

  const worksheet = workbook.getWorksheet('报价明细');
  const sectionRows = {};
  worksheet.eachRow(row => {
    const value = row.getCell(1).value;
    if (typeof value === 'string') sectionRows[value] = row.number;
  });

  const injectionHeader = sectionRows['二、注塑部分'] + 1;
  assert.equal(worksheet.getCell(injectionHeader, 17).value, '印尼运费 2%');
  assert.equal(worksheet.getCell(injectionHeader + 1, 17).value.formula, `P${injectionHeader + 1}*2/100`);

  const blowHeader = sectionRows['二·B、吹气部分 (HKD)'] + 1;
  assert.equal(worksheet.getCell(blowHeader, 14).value, '印尼运费 2%');
  assert.equal(worksheet.getCell(blowHeader + 1, 14).value.formula, `K${blowHeader + 1}*2/100`);

  const slushHeader = sectionRows['二·C、搪胶部分'] + 1;
  const slushRow = slushHeader + 1;
  assert.equal(worksheet.getCell(slushHeader, 7).value, '料价 HK$/lb');
  assert.equal(worksheet.getCell(slushHeader, 30).value, '印尼运费 3%');
  assert.equal(worksheet.getCell(slushRow, 19).value.formula, `F${slushRow}*G${slushRow}/454`);
  assert.equal(worksheet.getCell(slushRow, 26).value.formula, `SUM(S${slushRow}:X${slushRow})+R${slushRow}`);
  assert.equal(worksheet.getCell(slushRow, 28).value.formula, `Z${slushRow}*Y${slushRow}`);
  assert.equal(worksheet.getCell(slushRow, 29).value.formula, `AA${slushRow}*AB${slushRow}`);
  assert.equal(worksheet.getCell(slushRow, 30).value.formula, `AC${slushRow}*3/100`);
  assert.equal(Number(worksheet.getCell(slushRow, 29).value.result.toFixed(4)), 13.0896);

  const paintingHeader = sectionRows['三、二次加工（印喷报价）'] + 1;
  assert.equal(worksheet.getCell(paintingHeader, 23).value, '印尼运费 6%');
  assert.equal(worksheet.getCell(paintingHeader + 2, 23).value.formula, `V${paintingHeader + 2}*30%*6/100`);

  const sewingDetail = workbook.getWorksheet('车缝明细');
  assert.equal(sewingDetail.getCell(3, 12).value, '印尼运费 4%');
  assert.equal(sewingDetail.getCell(4, 12).value.formula, 'J4*4/100');
  assert.equal(sewingDetail.getCell(5, 12).value, 0);
});
