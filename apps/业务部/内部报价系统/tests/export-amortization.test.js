'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { buildWorkbook, adaptSurtaxForBase } = require('../backend/services/exportInternal');

test('electronic detail export preserves the original USD currency and formulas', async () => {
  const workbook = await buildWorkbook({
    quote: { quote_no: 'USD-ELECTRONIC', product_name: '美金电子报价', qty: 5000 },
    sections: [
      { dept: 'electronic', payload_json: JSON.stringify({
        electronics: [],
        electronics_doc: {
          source_currency: 'USD',
          source_extras: {
            parts_cost: 0.25, total_cost: 0.25, profit_pct: 12, profit_price: 0.28,
            mold_fees: [{ name: 'PCB模费', amount: 354, currency: 'USD' }],
          },
          meta: { tax_label: '不含税', moq: 5000 },
          parts: [{ name: 'PCB', spec: '40*35', qty: 1, unit_price: 1.6575, source_unit_price: 0.25, note: '' }],
        },
        electronics_extra: { parts_cost: 1.6575, profit_pct: 12 },
      }) },
      { dept: 'sales', payload_json: JSON.stringify({ header: { fx_rmb_hkd: 0.85, fx_hkd_usd: 7.8 }, shipping: { scenarios: [] } }) },
    ],
  });
  const sheet = workbook.getWorksheet('电子明细');
  assert.equal(sheet.getCell('D5').value, '单价USD');
  assert.equal(sheet.getCell('D6').value, 0.25);
  assert.equal(sheet.getCell('E6').value.formula, 'C6*D6');
  assert.equal(sheet.getCell('E6').value.result, 0.25);
  const values = [];
  sheet.eachRow(row => row.eachCell(cell => values.push(cell.value)));
  assert.ok(values.includes('电子报价单（USD）'));
  assert.ok(values.includes('PCB模费'));
  assert.ok(values.includes(354));
});

test('internal export writes product-ratio weighted injection formulas', async () => {
  const workbook = await buildWorkbook({
    quote: { quote_no: 'PRODUCT-MIX', product_name: '产品配比', qty: 1000 },
    sections: [
      { dept: 'molding', payload_json: JSON.stringify({
        injection_loss_pct: 0,
        indo_pct: 2,
        product_mix_ratios: { p1: 2, p2: 1 },
        injection: [
          { product_group_id: 'p1', product_group_name: '1#产品', name: 'A', weight_g: 0, material_unit_price: 0, shot_price: 10 },
          { product_group_id: 'p1', product_group_name: '1#产品', name: 'B', weight_g: 0, material_unit_price: 0, shot_price: 20 },
          { product_group_id: 'p2', product_group_name: '2#产品', name: 'C', weight_g: 0, material_unit_price: 0, shot_price: 40 },
        ],
      }) },
      { dept: 'sales', payload_json: JSON.stringify({ header: { fx_rmb_hkd: 0.85 }, shipping: { scenarios: [] } }) },
    ],
  });
  const worksheet = workbook.getWorksheet('报价明细');
  let titleRow = 0;
  worksheet.eachRow(row => { if (row.getCell(1).value === '二、注塑部分') titleRow = row.number; });
  const dataStart = titleRow + 2;
  const totalRow = dataStart + 3;
  assert.equal(worksheet.getCell(totalRow, 1).value, '加权合计（总配比 3）');
  const injectionHeaders = worksheet.getRow(titleRow + 1).values.slice(1);
  assert.ok(!injectionHeaders.includes('料型'));
  assert.ok(!injectionHeaders.includes('颜色'));
  assert.equal(worksheet.getCell(totalRow, 14).value.formula, `((N${dataStart}+N${dataStart + 1})*2+(N${dataStart + 2})*1)/3`);
  assert.equal(Number(worksheet.getCell(totalRow, 14).value.result.toFixed(4)), 33.3333);
  assert.equal(worksheet.getCell(totalRow, 15).value.formula, `((O${dataStart}+O${dataStart + 1})*2+(O${dataStart + 2})*1)/3`);
});

test('internal quotation workbook uses print-friendly layouts on every sheet', async () => {
  const workbook = await buildWorkbook({
    quote: { quote_no: 'PRINT-LAYOUT', product_name: '打印版式', customer: 'TOMY', qty: 5000 },
    sections: [
      { dept: 'electronic', payload_json: JSON.stringify({
        electronics_doc: {
          source_currency: 'RMB',
          parts: [{ name: 'IC', specification: 'SOP-8', qty: 1, unit_price: 1.2 }],
        },
      }) },
      { dept: 'sales', payload_json: JSON.stringify({ shipping: { scenarios: [] } }) },
    ],
  });

  for (const worksheet of workbook.worksheets) {
    assert.equal(worksheet.pageSetup.orientation, 'portrait');
    assert.equal(worksheet.pageSetup.fitToPage, true);
    assert.equal(worksheet.pageSetup.fitToWidth, 1);
    assert.equal(worksheet.pageSetup.fitToHeight, 0);
    assert.match(worksheet.pageSetup.printArea, /^A1:[A-Z]+\d+$/);
    assert.equal(worksheet.views[0].showGridLines, false);
    assert.match(worksheet.headerFooter.oddFooter, /第 &P 页/);
  }
  const mainSheet = workbook.getWorksheet('报价明细');
  assert.equal(mainSheet.pageSetup.printTitlesRow, '1:2');
  // 顶部标题与资料栏延伸到 Q 列，R 列及后方空白不进入打印区域。
  assert.equal(mainSheet.pageSetup.printArea, `A1:Q${mainSheet.rowCount}`);
  assert.equal(mainSheet.getCell('Q1').master.address, 'A1');
  assert.equal(mainSheet.getCell('Q2').master.address, 'A2');
  assert.notEqual(mainSheet.getCell('R1').master.address, 'A1');
  assert.equal(mainSheet.getCell(1, 1).font.size, 18);
  assert.ok(mainSheet.getCell(2, 1).font.size >= 12);
  assert.ok(mainSheet.getColumn(7).width >= 20);
  assert.equal(workbook.getWorksheet('电子明细').pageSetup.printTitlesRow, '1:1');
});

test('legacy ultrasonic mold fee is displayed as fixture mold fee', async () => {
  const workbook = await buildWorkbook({
    quote: { quote_no: 'FIXTURE-MOLD-LABEL', product_name: '夹具模费用', qty: 1000 },
    sections: [
      { dept: 'engineering', payload_json: JSON.stringify({
        mold_costs: {
          items: [{ name: '超声模费用', price_rmb: 1300 }],
          fx_rmb_usd: 7.75,
        },
      }) },
      { dept: 'sales', payload_json: JSON.stringify({ header: { fx_rmb_hkd: 0.85 }, shipping: { scenarios: [] } }) },
    ],
  });
  const worksheet = workbook.getWorksheet('报价明细');
  const labels = [];
  worksheet.eachRow(row => row.eachCell(cell => {
    if (typeof cell.value === 'string') labels.push(cell.value);
  }));
  assert.ok(labels.includes('夹具模费用'));
  assert.ok(!labels.includes('超声模费用'));
});

test('carton product dimensions are labeled in inches', async () => {
  const workbook = await buildWorkbook({
    quote: { quote_no: 'CARTON-INCH-LABEL', product_name: '纸箱英寸单位', qty: 1000 },
    sections: [
      { dept: 'engineering', payload_json: JSON.stringify({
        carton_calc: {
          pl: 9, pw: 5, ph: 12,
          cartons: [{
            name: '主纸箱', cl: 17, cw: 14, ch: 12, qty: 6,
            flat_cards: [{ name: '主平卡', l: 15.95, w: 12 }],
          }, { name: '纸箱2', cl: 0, cw: 0, ch: 0, qty: 1, flat_cards: [] }],
        },
      }) },
      { dept: 'sales', payload_json: JSON.stringify({ header: { fx_rmb_hkd: 0.85 }, shipping: { scenarios: [] } }) },
    ],
  });
  const worksheet = workbook.getWorksheet('报价明细');
  const labels = [];
  worksheet.eachRow(row => row.eachCell(cell => {
    if (typeof cell.value === 'string') labels.push(cell.value);
  }));
  assert.ok(labels.includes('产品尺寸（英寸）'));
  assert.ok(!labels.includes('产品尺寸 CM'));
  const titleRow = worksheet.getColumn(1).values.findIndex(value => value === '📦 纸箱 / 运费 计算');
  assert.ok(titleRow > 0);
  assert.deepEqual(worksheet.getRow(titleRow + 1).values.slice(1, 8), ['名称', 'L (inch)', 'W', 'H', '', '', '']);
  assert.deepEqual(worksheet.getRow(titleRow + 2).values.slice(1, 8), ['产品尺寸（英寸）', 9, 5, 12, 'CU.FT', '箱价\n(HK$)', '数量']);
  assert.equal(worksheet.getCell(titleRow, 8).value, null);
  assert.equal(worksheet.getCell(titleRow + 1, 8).value, null);
  assert.equal(worksheet.getCell(titleRow + 1, 8).fill && worksheet.getCell(titleRow + 1, 8).fill.type, undefined);
  assert.equal(worksheet.getCell(titleRow + 3, 1).value, '主纸箱');
  assert.equal(worksheet.getCell(titleRow + 3, 5).numFmt, '0.00');
  assert.equal(worksheet.getCell(titleRow + 4, 1).value, '主平卡');
  assert.ok(!labels.includes('纸箱2'));
  assert.match(worksheet.getCell(titleRow + 4, 6).value.formula, /^\(B\d+\+1\)\*\(C\d+\+1\)\*2\/1000$/);
});

test('carton dimensions accept formulas and preserve them in Excel export', async () => {
  const workbook = await buildWorkbook({
    quote: { quote_no: 'CARTON-FORMULA', product_name: '纸箱尺寸公式', qty: 1000 },
    sections: [
      { dept: 'engineering', payload_json: JSON.stringify({
        carton_calc: {
          cartons: [{
            name: '主纸箱',
            cl: 31.875, cl_raw: '=15.5+16.375',
            cw: 18.25, cw_raw: '=10+8.25',
            ch: 11.375, ch_raw: '=11+0.375',
            qty: 4, flat_cards: [],
          }],
        },
      }) },
      { dept: 'sales', payload_json: JSON.stringify({ header: { fx_rmb_hkd: 0.85 }, shipping: { scenarios: [] } }) },
    ],
  });
  const worksheet = workbook.getWorksheet('报价明细');
  let cartonRow = 0;
  worksheet.eachRow(row => { if (row.getCell(1).value === '主纸箱') cartonRow = row.number; });
  assert.ok(cartonRow > 0);
  assert.deepEqual(worksheet.getCell(cartonRow, 2).value, { formula: '15.5+16.375', result: 31.875 });
  assert.deepEqual(worksheet.getCell(cartonRow, 3).value, { formula: '10+8.25', result: 18.25 });
  assert.deepEqual(worksheet.getCell(cartonRow, 4).value, { formula: '11+0.375', result: 11.375 });
  assert.equal(worksheet.getCell(cartonRow, 5).value.formula, `B${cartonRow}*C${cartonRow}*D${cartonRow}/1728`);

  const source = fs.readFileSync(path.join(__dirname, '../frontend/workbench.js'), 'utf8');
  assert.match(source, /data-formula-dim/);
  assert.match(source, /parseFormulaInput\(el\.value\)/);
});

test('internal export keeps editable spray-product ratios and a weighted-average formula', async () => {
  const workbook = await buildWorkbook({
    quote: { quote_no: 'PAINT-MIX', product_name: '喷油产品配比', qty: 1000 },
    sections: [
      { dept: 'molding', payload_json: JSON.stringify({
        injection_loss_pct: 0,
        injection: [{ name: '占位注塑件', weight_g: 0, material_unit_price: 0, shot_price: 0 }],
      }) },
      { dept: 'painting', payload_json: JSON.stringify({
        indo_pct: 5,
        product_mix_ratios: { 'product-1': 2, 'product-2': 1 },
        painting_items: [
          { name: '1#公仔', position: 'A', clamp_qty: 1, clamp_unit: 10 },
          { name: '1#公仔', position: 'B', pad_qty: 1, pad_unit: 20 },
          { name: '2#公仔', position: 'C', spray_qty: 1, spray_unit: 60 },
        ],
      }) },
      { dept: 'sales', payload_json: JSON.stringify({ header: { fx_rmb_hkd: 0.85 }, shipping: { scenarios: [] } }) },
    ],
  });
  const worksheet = workbook.getWorksheet('喷油明细');
  const labels = {};
  worksheet.eachRow(row => {
    const value = row.getCell(1).value;
    if (typeof value === 'string') labels[value] = row.number;
  });
  const firstSummary = labels['1#公仔 小计 · 配比'];
  const secondSummary = labels['2#公仔 小计 · 配比'];
  const totalRow = secondSummary + 1;
  assert.ok(firstSummary && secondSummary);
  assert.equal(worksheet.getCell(totalRow, 1).value, '合计 HKD');
  assert.equal(worksheet.getCell(firstSummary, 23).value, 2);
  assert.equal(worksheet.getCell(secondSummary, 23).value, 1);
  assert.equal(worksheet.getCell(firstSummary, 24).value.result, 30);
  assert.equal(worksheet.getCell(secondSummary, 24).value.result, 60);
  assert.equal(
    worksheet.getCell(totalRow, 24).value.formula,
    `(IFERROR(SUMPRODUCT(W${firstSummary}:W${secondSummary},X${firstSummary}:X${secondSummary})/SUM(W${firstSummary}:W${secondSummary}),0))`,
  );
  assert.equal(worksheet.getCell(totalRow, 24).value.result, 40);
  assert.equal(worksheet.getCell(totalRow, 25).value.formula, `X${totalRow}*30%*5/100`);
  assert.equal(worksheet.getCell(totalRow, 25).value.result, 0.6);
});

test('empty department Indonesian freight totals do not create circular references', async () => {
  const workbook = await buildWorkbook({
    quote: { quote_no: 'EMPTY-DEPT', product_name: '空部门', qty: 1000 },
    sections: [
      { dept: 'engineering', payload_json: JSON.stringify({ hardware: [], aux_materials: [], packaging_materials: [] }) },
      { dept: 'sales', payload_json: JSON.stringify({ header: { fx_rmb_hkd: 0.85 }, shipping: { scenarios: [] } }) },
    ],
  });
  const worksheet = workbook.getWorksheet('报价明细');
  let totalRow = 0;
  worksheet.eachRow(row => { if (row.getCell(1).value === '合计 HKD') totalRow = row.number; });
  assert.ok(totalRow);
  assert.match(worksheet.getCell(totalRow, 12).value.formula, /^SUM\(L\d+:L\d+\)$/);
  assert.ok(!worksheet.getCell(totalRow, 12).value.formula.includes(`L${totalRow}`));
});

test('USD supplier material keeps USD as source price and converts directly to HKD', async () => {
  const workbook = await buildWorkbook({
    quote: { quote_no: 'USD-MATERIAL', product_name: '美金辅料', qty: 5000 },
    sections: [
      { dept: 'engineering', payload_json: JSON.stringify({
        hardware: [],
        aux_materials: [{
          name: 'USD辅料', spec: 'PCS', qty: 2,
          unit_price_rmb: null, unit_price_usd: 1.2, source_currency: 'USD',
        }],
        packaging_materials: [],
      }) },
      { dept: 'sales', payload_json: JSON.stringify({
        header: { fx_rmb_hkd: 0.85, fx_hkd_usd: 7.75 }, shipping: { scenarios: [] },
      }) },
    ],
  });
  const worksheet = workbook.getWorksheet('报价明细');
  let headerRow = 0;
  let dataRow = 0;
  worksheet.eachRow(row => {
    if (row.getCell(1).value === '序号' && row.getCell(2).value === '类别') headerRow = row.number;
    if (row.getCell(2).value === '辅助材料' && row.getCell(3).value === 'USD辅料') dataRow = row.number;
  });
  assert.equal(worksheet.getCell(headerRow, 9).value, '单价（RMB / USD）');
  assert.equal(worksheet.getCell(dataRow, 9).value, 1.2);
  assert.match(worksheet.getCell(dataRow, 9).numFmt, /US\$/);
  assert.equal(worksheet.getCell(dataRow, 10).value.formula, `I${dataRow}*7.75`);
  assert.ok(Math.abs(worksheet.getCell(dataRow, 10).value.result - 9.3) < 1e-9);
  assert.ok(Math.abs(worksheet.getCell(dataRow, 11).value.result - 18.6) < 1e-9);
});

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

test('manually adjusted carton price is preserved by the shared paper-rate formula', async () => {
  const desiredPrice = 25;
  const carton = { name: '纸箱1', cl: 48, cw: 20, ch: 43, qty: 110, flat_cards: [] };
  const priceBase = (carton.cl + carton.cw + 2) * (carton.cw + carton.ch + 1) * 2 / 1000;
  const paperRate = desiredPrice / priceBase;
  const workbook = await buildWorkbook({
    quote: { quote_no: 'CARTON-MANUAL', product_name: '手调箱价', qty: 1000 },
    sections: [
      {
        dept: 'engineering',
        payload_json: JSON.stringify({
          carton_calc: { paper_rate: paperRate, cartons: [carton] },
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

  const worksheet = workbook.getWorksheet('报价明细');
  let cartonPrice;
  worksheet.eachRow(row => {
    if (row.getCell(1).value === '纸箱1') cartonPrice = row.getCell(6).value;
  });
  assert.ok(cartonPrice);
  assert.equal(Number(cartonPrice.result.toFixed(4)), desiredPrice);
  assert.match(cartonPrice.formula, new RegExp(`\\*${paperRate}`));

  const source = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'vq-extension.js'), 'utf8');
  assert.match(source, /data-carton-price/);
  assert.match(source, /config\.paper_rate\s*=\s*desiredPrice\s*\/\s*currentBase/);
});

test('carton price can be manually adjusted to zero and exports as zero', async () => {
  const carton = { name: '主纸箱', cl: 17, cw: 14, ch: 12, qty: 6, flat_cards: [] };
  const workbook = await buildWorkbook({
    quote: { quote_no: 'CARTON-ZERO', product_name: '零箱价', qty: 1000 },
    sections: [
      {
        dept: 'engineering',
        payload_json: JSON.stringify({
          carton_calc: { paper_rate: 0, box_price: 0, cartons: [carton] },
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

  const worksheet = workbook.getWorksheet('报价明细');
  let cartonPrice;
  let cartonRow;
  worksheet.eachRow(row => {
    if (row.getCell(1).value === '主纸箱') {
      cartonRow = row.number;
      cartonPrice = row.getCell(6).value;
    }
  });
  assert.equal(
    cartonPrice.formula,
    `(B${cartonRow}+C${cartonRow}+2)*(C${cartonRow}+D${cartonRow}+1)*2*0/1000`
  );
  const workbenchSource = fs.readFileSync(
    path.join(__dirname, '..', 'frontend', 'workbench.js'),
    'utf8'
  );
  assert.match(workbenchSource, /ccc\.paper_rate == null \|\| ccc\.paper_rate === ''/);
  assert.match(workbenchSource, /c\.paper_rate == null \|\| c\.paper_rate === ''/);
});

test('explicit formula inputs remain formulas in the internal quotation export', async () => {
  const workbook = await buildWorkbook({
    quote: { quote_no: 'FREE-FORMULA', product_name: '辅助材料公式', qty: 1000 },
    sections: [
      {
        dept: 'engineering',
        payload_json: JSON.stringify({
          aux_materials: [{
            name: '公式杂费',
            qty: 0.5,
            qty_raw: '=1/2',
            unit_price_rmb: 0.1,
            unit_price_rmb_raw: '=(0.05+0.05)',
          }, {
            name: '分数杂费',
            qty: 0.5,
            qty_raw: '1/2',
            unit_price_rmb: 0.25,
            unit_price_rmb_raw: '1/4',
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

  const worksheet = workbook.getWorksheet('报价明细');
  let itemRow = 0;
  worksheet.eachRow(row => {
    if (row.getCell(3).value === '公式杂费') itemRow = row.number;
  });
  assert.ok(itemRow);
  assert.deepEqual(worksheet.getCell(itemRow, 8).value, { formula: '1/2', result: 0.5 });
  assert.deepEqual(worksheet.getCell(itemRow, 9).value, { formula: '(0.05+0.05)', result: 0.1 });
  assert.equal(worksheet.getCell(itemRow, 10).value.formula, `I${itemRow}/0.85`);
  assert.equal(worksheet.getCell(itemRow, 11).value.formula, `H${itemRow}*J${itemRow}`);

  let fractionRow = 0;
  worksheet.eachRow(row => {
    if (row.getCell(3).value === '分数杂费') fractionRow = row.number;
  });
  assert.ok(fractionRow);
  assert.equal(worksheet.getCell(fractionRow, 8).value, 0.5);
  assert.equal(worksheet.getCell(fractionRow, 8).numFmt, '# ?/?');
  assert.equal(worksheet.getCell(fractionRow, 9).value, 0.25);
  assert.equal(worksheet.getCell(fractionRow, 9).numFmt, '# ?/?');
  assert.equal(worksheet.getCell(fractionRow, 11).value.formula, `H${fractionRow}*J${fractionRow}`);
});

test('electronic quantity and unit price accept formulas and preserve them in export', async () => {
  const workbook = await buildWorkbook({
    quote: { quote_no: 'ELECTRONIC-QTY-FORMULA', product_name: '电子用量公式', qty: 1000 },
    sections: [
      {
        dept: 'electronic',
        payload_json: JSON.stringify({
          electronics: [{
            name: 'IC',
            qty: 0.5,
            qty_raw: '=1/2',
            unit_price_rmb: 0.31,
            unit_price_rmb_raw: '=(0.2+0.11)',
            unit_price: 0.364706,
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

  const worksheet = workbook.getWorksheet('报价明细');
  let itemRow = 0;
  worksheet.eachRow(row => {
    if (row.getCell(2).value === '电子' && row.getCell(3).value === 'IC') itemRow = row.number;
  });
  assert.ok(itemRow);
  assert.deepEqual(worksheet.getCell(itemRow, 8).value, { formula: '1/2', result: 0.5 });
  assert.deepEqual(worksheet.getCell(itemRow, 9).value, { formula: '(0.2+0.11)', result: 0.31 });
  assert.equal(worksheet.getCell(itemRow, 11).value.formula, `H${itemRow}*J${itemRow}`);

  const source = fs.readFileSync(
    path.join(__dirname, '..', 'frontend', 'workbench.js'),
    'utf8'
  );
  assert.match(source, /row\.qty\s*=\s*parseFormulaInput\(inpQ\.value\)/);
  assert.match(source, /c\.qty\s*=\s*parseFormulaInput\(i\.value\)/);
  assert.match(source, /row\.unit_price_rmb\s*=\s*sourceValue == null/);
  assert.match(source, /c\.unit_price_rmb\s*=\s*sourceValue == null/);
});

test('internal export keeps mold rows separated by product group', async () => {
  const workbook = await buildWorkbook({
    quote: { quote_no: 'MOLD-PRODUCT-GROUPS', product_name: '多产品模具', qty: 1000 },
    sections: [
      {
        dept: 'engineering',
        payload_json: JSON.stringify({
          molds: [
            { mold_no: 'NO.01', name: '产品一外壳', product_group_id: 'product-1', product_group_name: '产品1' },
            { mold_no: 'NO.02', name: '产品一配件', product_group_id: 'product-1', product_group_name: '产品1' },
            { mold_no: 'NO.03', name: '产品二外壳', product_group_id: 'product-2', product_group_name: '产品2' },
          ],
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

  const worksheet = workbook.getWorksheet('报价明细');
  const rows = {};
  worksheet.eachRow(row => {
    const moldNo = row.getCell(3).value;
    if (moldNo) rows[moldNo] = row;
  });
  assert.equal(rows['NO.01'].getCell(1).value, '产品1\n1.1');
  assert.equal(rows['NO.02'].getCell(1).value, '1.2');
  assert.equal(rows['NO.03'].getCell(1).value, '产品2\n2.1');
  assert.equal(rows['NO.01'].getCell(2).value, '产品一外壳');
  assert.equal(rows['NO.03'].getCell(2).value, '产品二外壳');
  assert.equal(worksheet.getCell(rows['NO.01'].number - 1, 1).value, '产品 / 序号');
  assert.notEqual(rows['NO.01'].getCell(18).fill?.fgColor?.argb, 'FFE0F2FE');
  assert.notEqual(rows['NO.03'].getCell(18).fill?.fgColor?.argb, 'FFE0F2FE');
});

test('internal export keeps molding rows separated by engineering product group', async () => {
  const workbook = await buildWorkbook({
    quote: { quote_no: 'MOLDING-PRODUCT-GROUPS', product_name: '多产品注塑', qty: 1000 },
    sections: [
      {
        dept: 'molding',
        payload_json: JSON.stringify({
          injection: [
            { name: '产品一外壳', product_group_id: 'product-1', product_group_name: '1#产品', weight_g: 10 },
            { name: '产品一配件', product_group_id: 'product-1', product_group_name: '1#产品', weight_g: 5 },
            { name: '产品二外壳', product_group_id: 'product-2', product_group_name: '2#产品', weight_g: 12 },
          ],
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

  const worksheet = workbook.getWorksheet('报价明细');
  const rows = {};
  worksheet.eachRow(row => {
    const name = String(row.getCell(2).value || '');
    if (name) rows[name] = row;
  });
  assert.equal(rows['产品一外壳'].getCell(1).value, '1#产品\n1.1');
  assert.equal(rows['产品一配件'].getCell(1).value, '1.2');
  assert.equal(rows['产品二外壳'].getCell(1).value, '2#产品\n2.1');
  assert.equal(rows['产品一外壳'].getCell(2).value, '产品一外壳');
  assert.equal(rows['产品二外壳'].getCell(2).value, '产品二外壳');
  assert.equal(worksheet.getCell(rows['产品一外壳'].number - 1, 1).value, '产品 / 序号');
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

  const worksheet = workbook.getWorksheet('报价明细');
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

test('SPIN export keeps shifted tax-summary formulas linked to their real rows', async () => {
  const workbook = await buildWorkbook({
    quote: { quote_no: 'SPIN-TAX-SHIFT', customer: 'SPIN', product_name: '公式平移', qty: 1000 },
    sections: [{ dept: 'sales', payload_json: JSON.stringify({
      header: { fx_rmb_hkd: 0.85, fx_hkd_usd: 7.8 },
      shipping: { markup_x: 1.2, divisor: 0.98, scenarios: [] },
      pricing_summary: {
        t1: { base_price: 30 },
        t2: { carton: 1 },
        t3: {},
        t4: { carton: { amt: 1, rate: 10 } },
        overrides: { 't1.base_price': true, 't2.carton': true },
      },
    }) }],
  });

  const worksheet = workbook.getWorksheet('报价明细');
  let deductionRow = 0;
  let summaryRow = 0;
  let afterCostRow = 0;
  worksheet.eachRow(row => {
    const deduction = row.getCell(11).value;
    const summary = row.getCell(7).value;
    if (deduction && typeof deduction === 'object' && /^SUM\(A\d+:J\d+\)$/.test(deduction.formula || '')) {
      deductionRow = row.number;
    }
    if (row.getCell(1).value === '合计减税' && summary && typeof summary === 'object') summaryRow = row.number;
    if (row.getCell(1).value === '减税后成本') afterCostRow = row.number;
  });

  assert.ok(deductionRow);
  assert.ok(summaryRow);
  assert.ok(afterCostRow);
  assert.equal(worksheet.getCell(summaryRow, 7).value.formula, `K${deductionRow}`);
  assert.match(worksheet.getCell(afterCostRow, 7).value.formula, new RegExp(`-K${deductionRow}$`));
  for (const rowNumber of [summaryRow, afterCostRow]) {
    const formula = worksheet.getCell(rowNumber, 7).value.formula;
    const refs = [...formula.matchAll(/[A-Z]+(\d+)/g)].map(match => Number(match[1]));
    assert.ok(refs.every(ref => ref <= worksheet.rowCount), `${formula} 引用了工作表范围外的行`);
  }
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
  assert.equal(worksheet.getCell(summaryHeaderRow, 2).value, '组装人工');
  assert.equal(worksheet.getCell(summaryHeaderRow, 3).value, '包装/混装人工');
  assert.equal(worksheet.getCell(summaryHeaderRow, 4).value, '二次加工（印喷）');
  assert.equal(worksheet.getCell(summaryHeaderRow, 5).value, '电子');
  assert.equal(worksheet.getCell(summaryHeaderRow, 6).value, '五金');
  assert.equal(worksheet.getCell(summaryHeaderRow, 7).value, '包装材料');
  assert.equal(worksheet.getCell(summaryHeaderRow, 8).value, '辅助材料');
  assert.equal(worksheet.getCell(summaryHeaderRow, 11).value, '车缝');
  assert.equal(worksheet.getCell(summaryHeaderRow, 14).value, '出货底价 HKD');
  assert.match(worksheet.getCell(summaryHeaderRow + 1, 14).value.formula, /SUM\(A\d+:L\d+\)-E\d+-K\d+\+M\d+/);
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

test('unified cost table separates sewing material and labor with freight only on material', async () => {
  const workbook = await buildWorkbook({
    quote: { quote_no: 'SEWING-SPLIT', product_name: '车缝拆分', qty: 1000, factory_code: 'qingxi' },
    sections: [
      { dept: 'sewing', payload_json: JSON.stringify({
        indo_pct: 4,
        sewing_groups: [
          { name: '1#产品', product_qty: 1, items: [
            { fabric: '面料', usage: 1, mat_price: 10, markup: 1 },
            { fabric: '裁床人工', usage: 1, mat_price: 2, markup: 1 },
            { fabric: '车缝人工', usage: 1, mat_price: 3, markup: 1 },
            { fabric: '手工人工', usage: 1, mat_price: 4, markup: 1 },
          ] },
          { name: '2#产品', product_qty: 3, items: [
            { fabric: '面料', usage: 1, mat_price: 20, markup: 1 },
            { fabric: '裁床人工', usage: 1, mat_price: 4, markup: 1 },
            { fabric: '车缝人工', usage: 1, mat_price: 6, markup: 1 },
            { fabric: '手工人工', usage: 1, mat_price: 8, markup: 1 },
          ] },
        ],
      }) },
      { dept: 'sales', payload_json: JSON.stringify({
        header: { fx_rmb_hkd: 0.85, fx_hkd_usd: 7.8 },
        shipping: { scenarios: [] },
      }) },
    ],
  });

  const worksheet = workbook.getWorksheet('报价明细');
  const rows = {};
  worksheet.eachRow(row => {
    if (row.getCell(2).value === '车缝') rows[row.getCell(3).value] = row.number;
  });
  assert.deepEqual(Object.keys(rows), ['车缝物料', '裁床人工', '车缝人工', '手工人工']);
  assert.equal(worksheet.getCell(rows['车缝物料'], 9).value.result, 17.5);
  assert.equal(worksheet.getCell(rows['裁床人工'], 9).value.result, 3.5);
  assert.equal(worksheet.getCell(rows['车缝人工'], 9).value.result, 5.25);
  assert.equal(worksheet.getCell(rows['手工人工'], 9).value.result, 7);
  assert.match(worksheet.getCell(rows['车缝物料'], 12).value.formula, /K\d+\*4\/100/);
  for (const name of ['裁床人工', '车缝人工', '手工人工']) {
    assert.equal(worksheet.getCell(rows[name], 12).value, 0);
  }
  const totalHkd = Object.values(rows).reduce((total, row) => total + worksheet.getCell(row, 11).value.result, 0);
  assert.equal(Number(totalHkd.toFixed(4)), Number((33.25 / 0.85).toFixed(4)));
  const labels = [];
  worksheet.eachRow(row => row.eachCell(cell => { if (typeof cell.value === 'string') labels.push(cell.value); }));
  assert.ok(!labels.includes('车缝部分（明细见"车缝明细" sheet）'));
  assert.ok(workbook.getWorksheet('车缝明细'));
});

test('unified cost table prefers assembly step groups and omits legacy placeholder rows', async () => {
  const workbook = await buildWorkbook({
    quote: { quote_no: 'ASSEMBLY-DEDUPE', product_name: '装配去重', qty: 7000, factory_code: 'qingxi' },
    sections: [
      { dept: 'assembly', payload_json: JSON.stringify({
        assembly_base_rate: 310,
        assembly_std_time: 11,
        assembly_labor: [
          { product: '1', step: '1', qty: 1 },
          { product: '1', step: '1', qty: 1 },
          { product: '2', step: '2', qty: 1 },
        ],
        packaging_labor: [{ step: '1=2' }],
        assembly_step_groups: [{
          product: '货号 31641', qty: 7000, team: 2,
          steps: [{ name: '装配', count: 17 }],
        }],
        packaging_step_groups: [{
          product: '货号 31641', qty: 7000, team: 3,
          steps: [{ name: '包装', count: 17 }],
        }],
      }) },
      { dept: 'sales', payload_json: JSON.stringify({
        header: { fx_rmb_hkd: 0.85, fx_hkd_usd: 7.8 },
        shipping: { scenarios: [] },
      }) },
    ],
  });

  const worksheet = workbook.getWorksheet('报价明细');
  const laborRows = [];
  worksheet.eachRow(row => {
    if (typeof row.getCell(1).value === 'number' && ['组装人工', '包装/混装人工'].includes(row.getCell(2).value)) {
      laborRows.push({ row: row.number, category: row.getCell(2).value, name: row.getCell(3).value, amount: row.getCell(11).value });
    }
  });
  assert.deepEqual(laborRows.map(row => [row.category, row.name]), [
    ['组装人工', '货号 31641'],
    ['包装/混装人工', '货号 31641'],
  ]);
  assert.ok(laborRows.every(row => row.amount && row.amount.result > 0));
  assert.ok(laborRows.every(row => worksheet.getCell(row.row, 8).numFmt === 'General'));
  assert.equal(worksheet.getCell(laborRows[0].row, 8).value, 2);
  assert.equal(worksheet.getCell(laborRows[1].row, 8).value, 3);
  assert.equal(worksheet.getCell(laborRows[0].row, 10).value.result, 310 * 17 / 7000);
  assert.equal(worksheet.getCell(laborRows[0].row, 11).value.result, 310 * 17 * 2 / 7000);
  assert.match(worksheet.getCell(laborRows[0].row, 10).value.formula, /^E\d+\*G\d+\/MAX\(F\d+,1\)$/);
  assert.match(worksheet.getCell(laborRows[0].row, 11).value.formula, /^H\d+\*J\d+$/);
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
  let moldRow;
  let productionMoldUsd;
  let productionMoldUsdFmt;
  worksheet.eachRow(row => row.eachCell(cell => {
    if (cell.value === '测试模具') {
      moldRow = row.number;
      moldDisplayHkd = worksheet.getCell(row.number, 16).value;
    }
    if (cell.value === '生产模具' && !productionMoldUsd) {
      const usdCell = worksheet.getCell(row.number, cell.col + 4);
      productionMoldUsd = usdCell.value;
      productionMoldUsdFmt = usdCell.numFmt;
    }
  }));

  const moldHeaders = worksheet.getRow(moldRow - 1).values.slice(1);
  assert.ok(!moldHeaders.includes('颜色'));
  assert.equal(worksheet.getRow(moldRow).height, 32);
  assert.equal(worksheet.getCell(moldRow, 14).numFmt, '"¥"#,##0');
  assert.equal(worksheet.getCell(moldRow, 15).numFmt, '"$"#,##0');
  assert.equal(worksheet.getCell(moldRow, 16).numFmt, '"HK$"#,##0');
  assert.equal(moldDisplayHkd.result, 10780);
  assert.match(moldDisplayHkd.formula, /N\d+\/0\.85\+O\d+\*7\.8/);
  assert.equal(Number(productionMoldUsd.result.toFixed(2)), 15.18);
  assert.equal(productionMoldUsdFmt, '"$"#,##0.00');
  assert.match(productionMoldUsd.formula, /I\d+\/0\.85\/7\.75/);
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

  const worksheet = workbook.getWorksheet('喷油明细');
  let uvHeaderFound = false;
  let uvQuoteCell;
  worksheet.eachRow(row => row.eachCell(cell => {
    if (cell.value === 'UV') uvHeaderFound = true;
    if (cell.value === 'UV测试件') uvQuoteCell = worksheet.getCell(row.number, 24).value;
  }));

  assert.equal(uvHeaderFound, true);
  assert.equal(uvQuoteCell.result, 2.5);
  assert.match(uvQuoteCell.formula, /V\d+\*W\d+/);
});

test('internal export keeps slush and painting details on separate sheets and only summaries on main', async () => {
  const workbook = await buildWorkbook({
    quote: { quote_no: 'DETAIL-SHEETS', product_name: '独立细表', qty: 1000, factory_code: 'qingxi' },
    sections: [
      { dept: 'slush', payload_json: JSON.stringify({
        slush_items: [{ name: '搪胶件', qty: 2, unit_price_hkd: 3 }],
      }) },
      { dept: 'painting', payload_json: JSON.stringify({
        painting_items: [{ name: '喷油件', clamp_qty: 2, clamp_unit: 4 }],
      }) },
      { dept: 'sales', payload_json: JSON.stringify({
        header: { fx_rmb_hkd: 0.85, fx_hkd_usd: 7.8 }, shipping: { scenarios: [] },
      }) },
    ],
  });
  const main = workbook.getWorksheet('报价明细');
  const slushDetail = workbook.getWorksheet('搪胶明细');
  const paintingDetail = workbook.getWorksheet('喷油明细');
  assert.ok(slushDetail);
  assert.ok(paintingDetail);
  const mainValues = [];
  main.eachRow(row => row.eachCell(cell => mainValues.push(cell.value)));
  assert.ok(mainValues.includes('二·C、搪胶部分（汇总）'));
  assert.ok(mainValues.includes('喷油人工+油漆'));
  assert.ok(!mainValues.includes('搪胶件'));
  assert.ok(!mainValues.includes('喷油件'));
  let unifiedHeader = 0;
  let paintingRow = 0;
  main.eachRow(row => {
    if (row.getCell(1).value === '序号' && row.getCell(2).value === '类别') unifiedHeader = row.number;
    if (row.getCell(2).value === '印喷') paintingRow = row.number;
  });
  assert.ok(unifiedHeader);
  assert.ok(paintingRow > unifiedHeader);
  const sheetIncludes = (sheet, expected) => {
    let found = false;
    sheet.eachRow(row => row.eachCell(cell => { if (cell.value === expected) found = true; }));
    return found;
  };
  assert.ok(sheetIncludes(slushDetail, '搪胶件'));
  assert.ok(sheetIncludes(paintingDetail, '喷油件'));
});

test('internal export keeps Indonesian freight only in quotation summary', async () => {
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
        electronics: [
          { name: 'IC', qty: 1, unit_price: 100 },
          { name: 'PACB电子', qty: 1, unit_price: 40 },
        ],
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
  let summaryRow = 0;
  let unifiedHeaderRow = 0;
  let electronicIcRow = 0;
  let electronicPacbRow = 0;
  let unifiedTotalRow = 0;
  worksheet.eachRow(row => {
    if (row.getCell(1).value === '十、合计') summaryRow = row.number + 2;
    if (row.getCell(1).value === '序号' && row.getCell(2).value === '类别') unifiedHeaderRow = row.number;
    if (unifiedHeaderRow && row.getCell(1).value === '合计 HKD') unifiedTotalRow = row.number;
    if (row.getCell(2).value === '电子' && row.getCell(3).value === 'IC') electronicIcRow = row.number;
    if (row.getCell(2).value === '电子' && row.getCell(3).value === 'PACB电子') electronicPacbRow = row.number;
  });
  const labels = [];
  worksheet.eachRow(row => row.eachCell(cell => {
    if (typeof cell.value === 'string') labels.push(cell.value);
  }));
  assert.ok(!labels.includes('印尼运费明细（各部门基数 × 点数%）'));
  assert.ok(unifiedTotalRow);
  const injectionTitleRow = labels.includes('二、注塑部分')
    ? worksheet.getColumn(1).values.findIndex(value => value === '二、注塑部分')
    : 0;
  const blowTitleRow = labels.includes('二·B、吹气部分 (HKD)')
    ? worksheet.getColumn(1).values.findIndex(value => value === '二·B、吹气部分 (HKD)')
    : 0;
  const injectionIndoTotalRow = injectionTitleRow + 3;
  const blowIndoTotalRow = blowTitleRow + 3;
  const slushWorksheet = workbook.getWorksheet('搪胶明细');
  let slushIndoRow = 0;
  slushWorksheet.eachRow(row => {
    if (String(row.getCell(1).value || '').startsWith('搪胶印尼运费合计 HKD')) slushIndoRow = row.number;
  });
  const expectedIndoTotal = worksheet.getCell(unifiedTotalRow, 12).value.result
    + worksheet.getCell(injectionIndoTotalRow, 15).value.result
    + worksheet.getCell(blowIndoTotalRow, 15).value.result
    + slushWorksheet.getCell(slushIndoRow, 7).value.result;
  assert.equal(Number(worksheet.getCell(summaryRow, 9).value.result.toFixed(4)), Number(expectedIndoTotal.toFixed(4)));
  assert.equal(
    worksheet.getCell(summaryRow, 9).value.formula,
    `L${unifiedTotalRow}+O${injectionIndoTotalRow}+O${blowIndoTotalRow}+'搪胶明细'!G${slushIndoRow}`
  );
  assert.ok(unifiedHeaderRow);
  assert.equal(worksheet.getCell(unifiedHeaderRow, 12).value, '印尼运费');
  const icRow = electronicIcRow;
  const pacbRow = electronicPacbRow;
  assert.equal(
    worksheet.getCell(icRow, 12).value,
    0
  );
  assert.equal(worksheet.getCell(pacbRow, 12).value.formula, `K${pacbRow}*5/100`);
  assert.equal(worksheet.getCell(pacbRow, 12).value.result, 2);
});

test('freight scenarios and production mold costs are exported beside quotation scenarios', async () => {
  const workbook = await buildWorkbook({
    quote: { quote_no: 'MOLD-POSITION', product_name: '模具位置', qty: 20000, factory_code: 'qingxi' },
    sections: [
      { dept: 'engineering', payload_json: JSON.stringify({
        mold_costs: {
          items: [{ name: '模具费用', price_rmb: 10000 }],
          amortization_qty: 20000,
          prototype_fee_usd: 3600,
          prototype_amortization_qty: 50000,
          testing_fee_usd: 2500,
          testing_amortization_qty: 10000,
        },
      }) },
      { dept: 'sales', payload_json: JSON.stringify({
        header: { fx_rmb_hkd: 0.85, fx_hkd_usd: 7.8 },
        shipping: { scenarios: [{ name: '盐田40柜', _freight_matched: 'yt40', _freight_rate: 1 }] },
      }) },
    ],
  });
  const worksheet = workbook.getWorksheet('报价明细');
  const cells = {};
  worksheet.eachRow(row => row.eachCell(cell => {
    if (typeof cell.value === 'string' && !cells[cell.value]) cells[cell.value] = { row: row.number, col: cell.col };
  }));
  assert.equal(cells['印尼运费明细（各部门基数 × 点数%）'], undefined);
  assert.ok(cells['十一、出货价算价（多场景）']);
  assert.equal(cells['运费场景'].row, cells['十一、出货价算价（多场景）'].row + 1);
  assert.ok(cells['运费场景'].col > cells['十一、出货价算价（多场景）'].col);
  assert.equal(cells['生产模具名称'].col, cells['运费场景'].col);
  assert.ok(cells['生产模具名称'].row > cells['运费场景'].row);
  const freightFeeCell = worksheet.getCell(cells['运费场景'].row + 1, cells['运费场景'].col + 2);
  assert.equal(freightFeeCell.numFmt, '"HK$"#,##0');
  assert.ok(worksheet.getColumn(cells['运费场景'].col + 2).width >= 18);
  assert.ok(cells['手板费分摊（总额 USD 3600，按 50000 套分摊）'].row > cells['生产模具名称'].row);
  assert.ok(cells['测试费分摊（总额 USD 2500，按 10000 套分摊）'].row > cells['生产模具名称'].row);
});

test('customer-supplied products are named separately and added to exported customer price', async () => {
  const workbook = await buildWorkbook({
    quote: { quote_no: 'CUSTOMER-PRODUCTS', product_name: '客供成品测试', qty: 1000 },
    sections: [{ dept: 'sales', payload_json: JSON.stringify({
      header: { fx_rmb_hkd: 0.85, fx_hkd_usd: 7.8 },
      shipping: {
        markup_x: 1,
        divisor: 1,
        scenarios: [{ name: '盐田40柜', base_rmb: 0 }],
        customer_supplied_products: [
          { name: '控制器', amount_usd: 2.5, amount_usd_raw: '=1+1.5' },
          { name: '充电线', amount_usd: 1.25 },
        ],
      },
    }) }],
  });
  const worksheet = workbook.getWorksheet('报价明细');
  let controllerRow = 0;
  let cableRow = 0;
  let totalUsdRow = 0;
  let customerPriceRow = 0;
  worksheet.eachRow(row => {
    if (row.getCell(1).value === '客供成品：控制器 (USD)') controllerRow = row.number;
    if (row.getCell(1).value === '客供成品：充电线 (USD)') cableRow = row.number;
    if (controllerRow && row.number > cableRow && row.getCell(1).value === 'TOTAL (USD)') totalUsdRow = row.number;
    const value = row.getCell(1).value;
    if (value && typeof value === 'object' && String(value.result || '').startsWith('报客货价:')) customerPriceRow = row.number;
  });
  assert.ok(controllerRow && cableRow && totalUsdRow && customerPriceRow);
  assert.deepEqual(worksheet.getCell(controllerRow, 3).value, { formula: '1+1.5', result: 2.5 });
  assert.equal(worksheet.getCell(cableRow, 3).value, 1.25);
  assert.match(worksheet.getCell(totalUsdRow, 3).value.formula, new RegExp(`C${controllerRow}\\+C${cableRow}`));
  assert.equal(worksheet.getCell(totalUsdRow, 3).value.result, 3.75);
  assert.match(worksheet.getCell(customerPriceRow, 1).value.result, /报客货价: 3\.7500/);
  const source = fs.readFileSync(path.join(__dirname, '../frontend/workbench.js'), 'utf8');
  assert.match(source, /amount_usd_raw/);
  assert.match(source, /customer-supplied-amount[\s\S]*type="text"/);
});

test('internal export mirrors UI formulas for slush and each departmental Indonesian freight', async () => {
  const workbook = await buildWorkbook({
    quote: { quote_no: 'UI-FORMULAS', product_name: '部门公式', qty: 1000, factory_code: 'qingxi' },
    sections: [
      { dept: 'molding', payload_json: JSON.stringify({
        indo_pct: 2,
        injection: [{ name: '注塑', weight_g: 10, material_unit_price: 0.01, shot_price: 0.5 }],
        blow_items: [{ name: '吹气', weight_g: 454, material_price_lb: 1, blow_labor: 1, flash: 0.5, profit_x: 2, usage_qty: 3 }],
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
  assert.equal(worksheet.getCell(injectionHeader, 15).value, '印尼运费 2%');
  assert.equal(worksheet.getCell(injectionHeader + 1, 15).value.formula, `N${injectionHeader + 1}*2/100`);

  const blowHeader = sectionRows['二·B、吹气部分 (HKD)'] + 1;
  const blowRow = blowHeader + 1;
  assert.equal(worksheet.getCell(blowHeader, 11).value, '用量');
  assert.equal(worksheet.getCell(blowRow, 11).value, 3);
  assert.equal(worksheet.getCell(blowRow, 12).value.formula, `I${blowRow}*J${blowRow}*K${blowRow}`);
  assert.equal(worksheet.getCell(blowRow, 12).value.result, 15);
  assert.equal(worksheet.getCell(blowHeader, 15).value, '印尼运费 2%');
  assert.equal(worksheet.getCell(blowRow, 15).value.formula, `L${blowRow}*2/100`);

  const slushWorksheet = workbook.getWorksheet('搪胶明细');
  const slushSectionRows = {};
  slushWorksheet.eachRow(row => {
    const value = row.getCell(1).value;
    if (typeof value === 'string') slushSectionRows[value] = row.number;
  });
  const slushTitle = Object.keys(slushSectionRows).find(value => value.startsWith('搪胶报价 · 1#'));
  const slushCostStart = slushSectionRows[slushTitle] + 3;
  const slushSubtotal = slushSectionRows['成本合计'];
  const slushTotal = slushSectionRows['总价 HKD'];
  const slushIndo = slushSectionRows['印尼运费 3%'];
  assert.ok(slushTitle);
  assert.equal(slushWorksheet.getCell(slushCostStart, 5).value, '料重(g)');
  assert.equal(slushWorksheet.getCell(slushCostStart + 1, 5).value, '料价 HK$/lb');
  assert.equal(slushWorksheet.getCell(slushCostStart, 3).value.formula, `G${slushCostStart}*G${slushCostStart + 1}/454`);
  assert.equal(slushWorksheet.getCell(slushSubtotal, 3).value.formula, `SUM(C${slushCostStart}:C${slushCostStart + 6})`);
  assert.equal(slushWorksheet.getCell(slushSubtotal + 2, 3).value.formula, `C${slushSubtotal}*C${slushSubtotal + 1}`);
  assert.equal(slushWorksheet.getCell(slushTotal, 3).value.formula, `C${slushSubtotal + 2}*C${slushSubtotal + 3}`);
  assert.equal(slushWorksheet.getCell(slushIndo, 3).value.formula, `C${slushTotal}*3/100`);
  assert.equal(Number(slushWorksheet.getCell(slushTotal, 3).value.result.toFixed(4)), 13.0896);

  const paintingWorksheet = workbook.getWorksheet('喷油明细');
  const paintingSectionRows = {};
  paintingWorksheet.eachRow(row => {
    const value = row.getCell(1).value;
    if (typeof value === 'string') paintingSectionRows[value] = row.number;
  });
  const paintingHeader = paintingSectionRows['五、二次加工（印喷报价）'] + 1;
  assert.equal(paintingWorksheet.getCell(paintingHeader, 25).value, '印尼运费 6%');
  assert.equal(paintingWorksheet.getCell(paintingHeader + 2, 25).value.formula, `X${paintingHeader + 2}*30%*6/100`);

  const sewingDetail = workbook.getWorksheet('车缝明细');
  assert.equal(sewingDetail.getCell(3, 12).value, '印尼运费 4%');
  assert.equal(sewingDetail.getCell(4, 12).value.formula, 'J4*4/100');
  assert.equal(sewingDetail.getCell(5, 12).value, 0);
});
