'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { sectionsToData } = require('../backend/services/exportVQ');

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
