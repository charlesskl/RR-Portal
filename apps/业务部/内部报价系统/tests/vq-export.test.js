'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const ExcelJS = require('exceljs');

const { exportVQ, sectionsToData } = require('../backend/services/exportVQ');
const { customerEnglish } = require('../backend/services/vqEnglish');

test('TOMY VQ converts internal electronic prices from HKD to USD', () => {
  const data = sectionsToData({
    quote: {
      id: 326,
      quote_no: 'TOMY-ELECTRONIC',
      product_name: 'Electronic Toy',
      customer: 'TOMY',
      qty: 1000,
    },
    sections: [
      {
        dept: 'electronic',
        payload_json: JSON.stringify({
          electronics: [{ name: 'IC', qty: 2, unit_price: 7.8 }],
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

  assert.equal(data.electronicItems[0].unit_price_usd, 1);
});

test('TOMY VQ uses the shared paper rate instead of stale legacy carton prices', () => {
  const data = sectionsToData({
    quote: {
      id: 328,
      quote_no: 'TOMY-CARTON-RATE',
      product_name: 'Carton Toy',
      customer: 'TOMY',
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

  assert.equal(data.productDim.carton_price, 26.88);
});

test('TOMY VQ preserves an explicit legacy carton price when paper rate is absent', () => {
  const data = sectionsToData({
    quote: {
      id: 329,
      quote_no: 'TOMY-LEGACY-CARTON',
      product_name: 'Legacy Carton Toy',
      customer: 'TOMY',
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
        payload_json: JSON.stringify({
          header: { fx_hkd_usd: 7.8 },
        }),
      },
    ],
  });

  assert.equal(data.productDim.carton_price, 99);
});

test('TOMY VQ translates common internal quotation names to English', () => {
  const data = sectionsToData({
    quote: {
      id: 327,
      quote_no: 'TOMY-ENGLISH',
      product_name: 'Movie Plush',
      customer: 'TOMY',
      qty: 1000,
    },
    sections: [
      {
        dept: 'electronic',
        payload_json: JSON.stringify({
          electronics: [{ name: 'PACB电子', qty: 1, unit_price: 7.8 }],
        }),
      },
      {
        dept: 'assembly',
        payload_json: JSON.stringify({
          assembly_labor: [{ name: '装配人工', qty: 1, unit_price: 2 }],
        }),
      },
      {
        dept: 'engineering',
        payload_json: JSON.stringify({
          packaging_materials: [{ name: '胶袋', qty: 1, unit_price: 0.2 }],
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

  assert.equal(data.electronicItems[0].part_name, 'PACB电子');
  assert.equal(data.electronicItems[0].eng_name, 'PACB Electronics');
  assert.equal(data.assemblyLaborItems[0].name, 'Assembly');
  assert.equal(data.packagingItems[0].name, '胶袋');
  assert.equal(data.packagingItems[0].eng_name, 'Polybag');
});

test('TOMY VQ displays translated English together with the original Chinese', async () => {
  const buffer = await exportVQ({
    quote: {
      id: 328,
      quote_no: 'TOMY-BILINGUAL',
      product_name: '红色公仔',
      customer: 'TOMY',
      qty: 1000,
    },
    sections: [
      {
        dept: 'electronic',
        payload_json: JSON.stringify({
          electronics: [{ name: 'PACB电子', qty: 1, unit_price: 7.8 }],
        }),
      },
      {
        dept: 'engineering',
        payload_json: JSON.stringify({
          packaging_materials: [{ name: '胶袋', qty: 1, unit_price: 0.2 }],
        }),
      },
      {
        dept: 'sales',
        payload_json: JSON.stringify({
          header: { fx_hkd_usd: 7.8 },
          vq_english: { product_name: 'Red Figure' },
        }),
      },
    ],
  });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const vq = workbook.worksheets[0];
  const bcd = workbook.worksheets[1];

  assert.equal(vq.getCell(4, 3).value, 'Red Figure\n红色公仔');
  assert.equal(bcd.getCell(7, 2).value, 'Red Figure\n红色公仔');

  const workbookText = workbook.worksheets.flatMap(sheet =>
    sheet._rows.flatMap(row => row ? row.values : [])
  ).filter(value => typeof value === 'string');
  assert.ok(workbookText.includes('PACB Electronics\nPACB电子'));
  assert.ok(workbookText.includes('Polybag\n胶袋'));
});

test('SPIN VQ translates fabric descriptions used by the costing sheet', () => {
  const examples = [
    ['1--机芯红色艾摩（北极绒）', '1-- Mechanism Red Elmo (Polar Fleece)'],
    ['63"300G 10MM红色弹力北极绒', '63"300G 10MM Red Stretch Polar Fleece'],
    ['58"320G 3MM橙色水晶超柔', '58"320G 3MM Orange Crystal Super-soft Plush'],
    ['58"白色细纹莱卡布定位印黑色眼珠', '58" White Fine-texture Lycra Fabric Positioned Print Black Eyes'],
    ['58"白色细纹莱卡布', '58" White Fine-texture Lycra Fabric'],
    ['58"黑色细纹莱卡布', '58" Black Fine-texture Lycra Fabric'],
    ['58" 180G白色边纶布', '58" 180G White Tricot Fabric'],
    ['58"320G 1MM白色水晶超柔，数码定位', '58"320G 1MM White Crystal Super-soft Plush, Digital Positioning'],
    ['4"进口透明公木毛', '4" Imported Transparent Loop Side'],
    ['4"进口透明公木勾', '4" Imported Transparent Hook Side'],
  ];

  for (const [source, expected] of examples) {
    assert.equal(customerEnglish(source), expected);
    assert.doesNotMatch(customerEnglish(source), /[\u4e00-\u9fff]/);
  }
});
