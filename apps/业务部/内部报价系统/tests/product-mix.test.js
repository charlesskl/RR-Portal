'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  weightedInjectionSum,
  weightedColumnFormula,
} = require('../backend/services/productMix');

function payload(ratios = { p1: 2, p2: 1 }) {
  return {
    product_mix_ratios: ratios,
    injection: [
      { product_group_id: 'p1', value: 10 },
      { product_group_id: 'p1', value: 20 },
      { product_group_id: 'p2', value: 40 },
    ],
  };
}

test('product subtotals are averaged by editable product ratios', () => {
  assert.equal(weightedInjectionSum(payload(), row => row.value), (30 * 2 + 40) / 3);
  assert.equal(weightedInjectionSum(payload({ p1: 0, p2: 1 }), row => row.value), 40);
});

test('rows without product groups keep the original sum behavior', () => {
  assert.equal(weightedInjectionSum({ injection: [{ value: 10 }, { value: 20 }] }, row => row.value), 30);
});

test('exported weighted total remains an editable Excel formula', () => {
  assert.equal(weightedColumnFormula(payload(), 23, 'P'), '((P23+P24)*2+(P25)*1)/3');
});
