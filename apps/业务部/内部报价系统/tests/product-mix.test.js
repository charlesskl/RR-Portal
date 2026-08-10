'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  ensureExplicitProductGroups,
  weightedRowsSum,
  weightedRowsFormula,
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

test('a single product keeps direct totals and does not apply its saved ratio', () => {
  const single = {
    product_mix_ratios: { p1: 9 },
    injection: [
      { product_group_id: 'p1', value: 10 },
      { product_group_id: 'p1', value: 20 },
    ],
  };
  assert.equal(weightedInjectionSum(single, row => row.value), 30);
  assert.equal(weightedColumnFormula(single, 23, 'P'), 'SUM(P23:P24)');
});

test('exported weighted total remains an editable Excel formula', () => {
  assert.equal(weightedColumnFormula(payload(), 23, 'P'), '((P23+P24)*2+(P25)*1)/3');
});

test('painting rows use the same multi-product weighted-average rules', () => {
  const painting = {
    product_mix_ratios: { 'product-1': 1, 'product-2': 3 },
    painting_items: [
      { product_group_id: 'product-1', amount: 10 },
      { product_group_id: 'product-1', amount: 5 },
      { product_group_id: 'product-2', amount: 25 },
    ],
  };
  assert.equal(
    weightedRowsSum(painting, painting.painting_items, row => row.amount),
    (15 * 1 + 25 * 3) / 4,
  );
  assert.equal(
    weightedRowsFormula(painting, painting.painting_items, 10, 'V'),
    '((V10+V11)*1+(V12)*3)/4',
  );
});

test('legacy painting rows recover product groups from explicit numbered names', () => {
  const rows = [
    { name: '1#公仔', value: 10 },
    { name: '', value: 5 },
    { name: '2#公仔', value: 20 },
  ];
  ensureExplicitProductGroups(rows);
  assert.deepEqual(rows.map(row => row.product_group_id), ['product-1', 'product-1', 'product-2']);
});

test('molding UI visually separates multiple product groups', () => {
  const source = fs.readFileSync(path.join(__dirname, '../frontend/workbench.js'), 'utf8');
  assert.match(source, /className: 'injection-product-group'/);
  assert.match(source, /产品 \$\{group\.index \+ 1\}\/\$\{injectionGroupsForTable\.length\}/);
  assert.match(source, /rowStyle: showInjectionGroups/);
});

test('electronic IC rows are excluded only from Indonesian freight', () => {
  const source = fs.readFileSync(path.join(__dirname, '../frontend/workbench.js'), 'utf8');
  assert.match(source, /function isIcElectronicRow\(row\)/);
  assert.match(source, /const elecIndoRaw = sum\(elecSrc/);
  assert.match(source, /electronicIndoAmount\(row, fxRmbHkd/);
  assert.match(source, /\+ elecIndoRaw \* num\(electronic\.indo_pct\)/);
});

test('shipping UI supports named customer-supplied products in final USD', () => {
  const source = fs.readFileSync(path.join(__dirname, '../frontend/workbench.js'), 'utf8');
  assert.match(source, /customer_supplied_products/);
  assert.match(source, /\+ customerSuppliedUSD/);
  assert.match(source, /customer-supplied-name/);
  assert.match(source, /\+ 客供成品/);
});
