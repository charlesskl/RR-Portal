'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const ExcelJS = require('exceljs');

const {
  buildSpinTransportRows,
  exportSpin,
  sectionsToSpinData,
} = require('../backend/services/exportSpin');

test('SPIN data preserves named customer-supplied products for misc-cost rows', () => {
  const data = sectionsToSpinData({
    quote: { id: 400, quote_no: 'SPIN-CUSTOMER-PRODUCTS', product_name: 'Toy', customer: 'SPIN', qty: 1000 },
    sections: [{
      dept: 'sales',
      payload_json: JSON.stringify({
        shipping: {
          customer_supplied_products: [
            { name: '控制器', amount_usd: 2.5 },
            { name: '充电线', amount_usd: 1.25 },
          ],
        },
      }),
    }],
  });
  assert.deepEqual(data.customerSuppliedProducts.map(item => [item.name, item.amount_usd]), [
    ['控制器', 2.5],
    ['充电线', 1.25],
  ]);
});

test('SPIN VQ writes up to five customer-supplied products and expands the misc subtotal formula', async () => {
  const products = [
    { name: '控制器', amount_usd: 2.5 },
    { name: '充电线', amount_usd: 1.25 },
    { name: '电池', amount_usd: 0.5 },
    { name: '说明书', amount_usd: 0.2 },
    { name: '贴纸', amount_usd: 0.1 },
  ];
  const buffer = await exportSpin({
    quote: { id: 401, quote_no: 'SPIN-CUSTOMER-EXPORT', product_name: 'Toy', customer: 'SPIN', qty: 1000 },
    sections: [{ dept: 'sales', payload_json: JSON.stringify({
      shipping: { customer_supplied_products: products },
    }) }],
  });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const worksheet = workbook.getWorksheet('Toy');
  let testingRow = 0;
  worksheet.eachRow(row => {
    if (row.getCell(2).value === 'testing fee') testingRow = row.number;
  });
  assert.ok(testingRow);
  products.forEach((product, index) => {
    const row = testingRow + index + 1;
    assert.match(String(worksheet.getCell(row, 2).value), new RegExp(product.name));
    assert.equal(worksheet.getCell(row, 10).value, product.amount_usd);
    assert.equal(worksheet.getCell(row, 12).value.formula, `J${row}*K${row}`);
  });
  const subtotalRow = testingRow + 6;
  assert.equal(worksheet.getCell(subtotalRow, 13).value.formula, `SUM(L${testingRow}:L${subtotalRow - 1})`);
  assert.equal(worksheet.getCell(subtotalRow, 13).value.result, 4.55);
});
const { buildWorkbook } = require('../backend/services/exportInternal');

const carton = { cuft: 0.62, qty: 12 };
const freight = {
  cap_40: 1980,
  cap_20: 883,
  hk40: 8000,
  hk20: 7100,
  yt40: 7200,
  yt20: 6000,
};
const spinConfig = {
  fx_hkd_usd: 7.75,
  lcl_divisor: 0.98,
  china_lcl: [
    { label: '盐田散货 3吨', capacity_cuft: 450, unit_hkd: 16.8 },
    { label: '盐田散货 5吨', capacity_cuft: 850, unit_hkd: 11.24 },
    { label: '盐田散货 8吨', capacity_cuft: 1000, unit_hkd: 9.67 },
  ],
};

test('SPIN transport follows actual-carton-quantity formulas', () => {
  const rows = buildSpinTransportRows({
    cartonCuft: carton.cuft,
    pcsPerCarton: carton.qty,
    freightCalc: freight,
    spinConfig,
  });
  const chinaFcl = rows.find(row => row.code === 'CHINA FCL');
  const chinaLcl1 = rows.find(row => row.code === 'CHINA LCL1');

  assert.equal(chinaFcl.qty_20, Math.floor(883 / 0.62) * 12);
  assert.equal(chinaFcl.qty_40, Math.floor(1980 / 0.62) * 12);
  assert.equal(chinaFcl.usd_per_toy, 7200 / 7.75 / chinaFcl.qty_40);
  assert.equal(chinaLcl1.qty_40, Math.floor(450 / 0.62) * 12);
  assert.equal(chinaLcl1.usd_per_toy, 16.8 * 0.62 / 12 / 0.98 / 7.75);
});

test('SPIN VQ uses the shared paper rate instead of stale legacy carton prices', () => {
  const data = sectionsToSpinData({
    quote: {
      id: 328,
      quote_no: 'SPIN-CARTON-RATE',
      product_name: 'Carton Plush',
      customer: 'SPIN',
      qty: 1000,
    },
    sections: [
      {
        dept: 'engineering',
        payload_json: JSON.stringify({
          carton_calc: {
            paper_rate: 3,
            carton_price: 96,
            price: 97,
            box_price: 98,
            cartons: [{
              name: '主纸箱',
              cl: 48,
              cw: 20,
              ch: 43,
              qty: 10,
              carton_price: 99,
              price: 100,
              box_price: 101,
              flat_cards: [],
            }],
          },
        }),
      },
      {
        dept: 'sales',
        payload_json: JSON.stringify({
          header: { fx_hkd_usd: 7.8 },
        }),
      },
    ],
  });

  const masterCarton = data.packagingItems.find(item =>
    item.pkg_section === 'carton' && /^Master carton/.test(item.name)
  );
  assert.equal(masterCarton.new_price, 26.88 / 7.75);
});

test('SPIN VQ preserves an explicit legacy carton price when paper rate is absent', () => {
  const data = sectionsToSpinData({
    quote: {
      id: 329,
      quote_no: 'SPIN-LEGACY-CARTON',
      product_name: 'Legacy Carton Plush',
      customer: 'SPIN',
      qty: 1000,
    },
    sections: [
      {
        dept: 'engineering',
        payload_json: JSON.stringify({
          carton_calc: {
            cartons: [{
              name: '主纸箱',
              cl: 48,
              cw: 20,
              ch: 43,
              qty: 10,
              carton_price: 99,
              flat_cards: [],
            }],
          },
        }),
      },
      {
        dept: 'sales',
        payload_json: JSON.stringify({}),
      },
    ],
  });

  const masterCarton = data.packagingItems.find(item =>
    item.pkg_section === 'carton' && /^Master carton/.test(item.name)
  );
  assert.equal(masterCarton.new_price, 99 / 7.75);
});

test('SPIN VQ does not create a master-carton cost without dimensions or price', () => {
  const data = sectionsToSpinData({
    quote: {
      id: 330,
      quote_no: 'SPIN-NO-CARTON',
      product_name: 'No Carton Plush',
      customer: 'SPIN',
      qty: 1000,
    },
    sections: [
      {
        dept: 'engineering',
        payload_json: JSON.stringify({}),
      },
      {
        dept: 'sales',
        payload_json: JSON.stringify({}),
      },
    ],
  });

  const masterCarton = data.packagingItems.find(item =>
    item.pkg_section === 'carton' && /^Master carton/.test(item.name)
  );
  assert.equal(masterCarton, undefined);
});

test('SPIN VQ exports transportation as Excel formulas with cached results', async () => {
  const buffer = await exportSpin({
    quote: {
      id: 1,
      quote_no: 'SPIN-FORMULA',
      product_name: 'Formula Plush',
      customer: 'SPIN',
      version: 'V1',
    },
    sections: [
      {
        dept: 'engineering',
        payload_json: JSON.stringify({ carton_calc: carton }),
      },
      {
        dept: 'sales',
        payload_json: JSON.stringify({
          freight_calc: freight,
          spin_transport: spinConfig,
        }),
      },
    ],
  });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const worksheet = workbook.worksheets.find(sheet => sheet.name !== 'Summary');
  let chinaFclRow = 0;
  for (let row = 150; row <= worksheet.rowCount; row++) {
    if (String(worksheet.getCell(row, 2).value || '').includes('CHINA FCL')) {
      chinaFclRow = row;
      break;
    }
  }
  assert.ok(chinaFclRow, 'CHINA FCL row should exist');
  assert.equal(workbook.getWorksheet('Summary').getCell(52, 2).value, carton.cuft);
  assert.match(worksheet.getCell(chinaFclRow, 3).value.formula, /INT\(883\/'Summary'!B52\)\*'Summary'!E45/);
  assert.match(worksheet.getCell(chinaFclRow, 9).value.formula, /INT\(1980\/'Summary'!B52\)\*'Summary'!E45/);
  assert.match(worksheet.getCell(chinaFclRow, 12).value.formula, /7200\/7\.75\/I/);

  const lclRow = chinaFclRow + 4;
  assert.match(worksheet.getCell(lclRow, 9).value.formula, /INT\(450\/'Summary'!B52\)\*'Summary'!E45/);
  assert.match(worksheet.getCell(lclRow, 12).value.formula, /16\.8\*'Summary'!B52\/'Summary'!E45\/0\.98\/7\.75/);
  assert.ok(worksheet.getCell(lclRow, 12).value.result > 0);
});

test('SPIN VQ clears electronic amount formulas from unused template rows', async () => {
  const buffer = await exportSpin({
    quote: {
      id: 2,
      quote_no: 'SPIN-ELECTRONIC',
      product_name: 'Electronic Plush',
      customer: 'SPIN',
      version: 'V1',
    },
    sections: [
      {
        dept: 'electronic',
        payload_json: JSON.stringify({
          electronics: [
            { name: 'IC', qty: 1, unit_price: 0.3671 },
            { name: 'PACB电子', qty: 1, unit_price: 3.9498 },
          ],
        }),
      },
      {
        dept: 'sales',
        payload_json: JSON.stringify({
          header: { fx_hkd_usd: 7.75 },
          freight_calc: freight,
          spin_transport: spinConfig,
        }),
      },
    ],
  });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const worksheet = workbook.worksheets.find(sheet => sheet.name !== 'Summary');
  let electronicHeaderRow = 0;
  worksheet.eachRow(row => {
    if (String(row.getCell(3).value || '').includes('Electronic Parts Cost')) {
      electronicHeaderRow = row.number;
    }
  });
  assert.ok(electronicHeaderRow, 'Electronic Parts Cost section should exist');

  const firstDataRow = electronicHeaderRow + 1;
  assert.equal(worksheet.getCell(firstDataRow, 3).value, 'IC');
  assert.equal(worksheet.getCell(firstDataRow + 1, 3).value, 'PACB Electronics');
  assert.equal(worksheet.getCell(firstDataRow + 1, 4).value, 'PACB电子');
  assert.ok(worksheet.getCell(firstDataRow, 12).value.formula);
  assert.ok(worksheet.getCell(firstDataRow + 1, 12).value.formula);
  for (let row = firstDataRow + 2; row < firstDataRow + 10; row++) {
    assert.equal(worksheet.getCell(row, 12).value, null);
  }
});

test('SPIN VQ displays English and Chinese in separate description columns', async () => {
  const buffer = await exportSpin({
    quote: {
      id: 22,
      quote_no: 'SPIN-BILINGUAL',
      product_name: '红色艾摩',
      customer: 'SPIN',
      version: 'V1',
    },
    sections: [
      {
        dept: 'sewing',
        payload_json: JSON.stringify({
          sewing_groups: [{
            name: '红色艾摩',
            items: [
              { fabric: '58"白色细纹莱卡布', part: '面部', usage: 0.1, mat_price: 10 },
              { fabric: '布标', part: '', usage: 1, mat_price: 0.2 },
            ],
          }],
        }),
      },
      {
        dept: 'engineering',
        payload_json: JSON.stringify({
          hardware: [{ name: '胶针', qty: 1, unit_price: 0.2 }],
        }),
      },
      {
        dept: 'electronic',
        payload_json: JSON.stringify({
          electronics: [{ name: 'PACB电子', qty: 1, unit_price: 3.9 }],
        }),
      },
      {
        dept: 'sales',
        payload_json: JSON.stringify({
          header: { fx_hkd_usd: 7.75 },
          freight_calc: freight,
          spin_transport: spinConfig,
        }),
      },
    ],
  });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const worksheet = workbook.worksheets.find(sheet => sheet.name !== 'Summary');
  const sectionRows = {};
  worksheet.eachRow(row => {
    const title = String(row.getCell(3).value || '');
    for (const section of ['Fabric Cost', 'Metal Parts Cost', 'Electronic Parts Cost', 'Others Cost']) {
      if (title.includes(section)) sectionRows[section] = row.number;
    }
  });

  assert.equal(worksheet.getCell(sectionRows['Fabric Cost'] + 1, 3).value, '58" White Fine-texture Lycra Fabric');
  assert.equal(worksheet.getCell(sectionRows['Fabric Cost'] + 1, 4).value, '58"白色细纹莱卡布');
  assert.equal(worksheet.getCell(sectionRows['Metal Parts Cost'] + 1, 3).value, 'Dennison Tag');
  assert.equal(worksheet.getCell(sectionRows['Metal Parts Cost'] + 1, 4).value, '胶针');
  assert.equal(worksheet.getCell(sectionRows['Electronic Parts Cost'] + 1, 3).value, 'PACB Electronics');
  assert.equal(worksheet.getCell(sectionRows['Electronic Parts Cost'] + 1, 4).value, 'PACB电子');
  assert.equal(worksheet.getCell(sectionRows['Others Cost'] + 1, 3).value, 'Woven Label');
  assert.equal(worksheet.getCell(sectionRows['Others Cost'] + 1, 4).value, '布标');
});

test('SPIN VQ exports labor amounts as Excel formulas', async () => {
  const buffer = await exportSpin({
    quote: {
      id: 3,
      quote_no: 'SPIN-LABOR',
      product_name: 'Labor Plush',
      customer: 'SPIN',
      version: 'V1',
    },
    sections: [
      {
        dept: 'sewing',
        payload_json: JSON.stringify({
          sewing_groups: [{
            name: 'Main',
            items: [
              { fabric: '车缝', usage: 1, mat_price: 20.15 },
              { fabric: '裁床', usage: 1, mat_price: 4.04 },
              { fabric: '手工', usage: 1, mat_price: 9.43 },
            ],
          }],
        }),
      },
      {
        dept: 'assembly',
        payload_json: JSON.stringify({
          assembly_base_rate: 275,
          packaging_labor: [{ name: '包装人工', qty: 1, unit_price: 11.67 }],
        }),
      },
      {
        dept: 'sales',
        payload_json: JSON.stringify({
          header: { fx_rmb_hkd: 0.85 },
          freight_calc: freight,
          spin_transport: spinConfig,
        }),
      },
    ],
  });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const worksheet = workbook.worksheets.find(sheet => sheet.name !== 'Summary');
  const laborRows = new Map();
  worksheet.eachRow(row => {
    const label = String(row.getCell(3).value || '').trim();
    if (['Sewing', 'Packing', 'Cutting', 'Stuffing and manual time'].includes(label)) {
      laborRows.set(label, row.number);
    }
  });

  for (const [label, row] of laborRows) {
    const amount = worksheet.getCell(row, 12).value;
    assert.equal(amount.formula, `J${row}*K${row}`, `${label} should use a formula`);
    assert.equal(amount.result, Math.round(
      Number(worksheet.getCell(row, 10).value) * Number(worksheet.getCell(row, 11).value) * 10000
    ) / 10000);
  }
  assert.equal(laborRows.size, 4);

  const subtotalRow = Math.max(...laborRows.values()) + 1;
  assert.equal(worksheet.getCell(subtotalRow, 13).value.formula, `SUM(L${subtotalRow - 8}:L${subtotalRow - 1})`);
  const expectedSubtotal = [...laborRows.values()].reduce(
    (sum, row) => sum + worksheet.getCell(row, 12).value.result,
    0
  );
  assert.equal(
    worksheet.getCell(subtotalRow, 13).value.result,
    Math.round(expectedSubtotal * 10000) / 10000
  );
});

test('internal quotation export includes the SPIN transportation formula table', async () => {
  const workbook = await buildWorkbook({
    quote: {
      id: 1,
      quote_no: 'SPIN-INTERNAL',
      product_name: 'Formula Plush',
      customer: 'SPIN',
    },
    sections: [
      {
        dept: 'engineering',
        payload_json: JSON.stringify({
          carton_calc: {
            cartons: [{ name: '主纸箱', cl: 22, cw: 16, ch: 3.059, cuft: carton.cuft, qty: carton.qty }],
          },
        }),
      },
      {
        dept: 'sales',
        payload_json: JSON.stringify({
          freight_calc: freight,
          spin_transport: spinConfig,
        }),
      },
    ],
  });
  const worksheet = workbook.getWorksheet('报价明细');
  let titleRow = 0;
  worksheet.eachRow(row => {
    if (row.getCell(1).value === 'SPIN 报客表运费计算（公式）') titleRow = row.number;
  });
  assert.ok(titleRow, 'SPIN transportation table should exist');

  const firstDataRow = titleRow + 2;
  assert.equal(worksheet.getCell(firstDataRow, 1).value, '盐田 40HQ');
  assert.match(worksheet.getCell(firstDataRow, 2).value.formula, /B\d+/);
  assert.match(worksheet.getCell(firstDataRow, 3).value.formula, /C\d+/);
  assert.match(worksheet.getCell(firstDataRow, 8).value.formula, /IFERROR\(INT\(B\d+\/F\d+\),0\)/);
  assert.match(worksheet.getCell(firstDataRow, 9).value.formula, /H\d+\*G\d+/);
  assert.match(worksheet.getCell(firstDataRow, 10).value.formula, /C\d+\/D\d+\/I\d+/);

  const firstLclRow = firstDataRow + 4;
  assert.equal(worksheet.getCell(firstLclRow, 1).value, '盐田散货 3吨');
  assert.equal(worksheet.getCell(firstLclRow, 2).value.formula, `L${firstLclRow}`);
  assert.equal(worksheet.getCell(firstLclRow, 3).value.formula, `M${firstLclRow}`);
  assert.match(worksheet.getCell(firstLclRow, 10).value.formula, /C\d+\*F\d+\/G\d+\/E\d+\/D\d+/);

  const spacerRow = firstDataRow + 7;
  for (let column = 1; column <= 13; column += 1) {
    const border = worksheet.getCell(spacerRow, column).border;
    assert.equal(border.top.style, 'thin');
    assert.equal(border.bottom.style, 'thin');
    assert.equal(border.left.style, 'thin');
    assert.equal(border.right.style, 'thin');
  }
});
