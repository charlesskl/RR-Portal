'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadElectronicAllocation() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'workbench.js'), 'utf8');
  const start = source.indexOf('function elecTaxedCore');
  const end = source.indexOf('function renderHierElectronics', start);
  assert.ok(start >= 0 && end > start, 'electronic allocation functions must be present');
  const context = {
    num: value => Number(value) || 0,
    sum: (rows, fn) => rows.reduce((total, row) => total + (fn(row) || 0), 0),
  };
  vm.runInNewContext(`${source.slice(start, end)}\nthis.elecSplitRows = elecSplitRows; this.upgradeLegacyElecSplit = upgradeLegacyElecSplit;`, context);
  return context;
}

function loadElectronicCurrencyHelpers() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'workbench.js'), 'utf8');
  const start = source.indexOf('function electronicSourceToRmb');
  const end = source.indexOf('function ensureElecRmbPrices', start);
  assert.ok(start >= 0 && end > start, 'electronic currency helpers must be present');
  const context = { num: value => Number(value) || 0 };
  vm.runInNewContext(`${source.slice(start, end)}\nthis.normalizeElectronicImport = normalizeElectronicImport;`, context);
  return context;
}

test('USD electronic import keeps source amounts and normalizes calculation values to RMB', () => {
  const { normalizeElectronicImport } = loadElectronicCurrencyHelpers();
  const source = {
    source_currency: 'USD',
    parts: [{ name: 'IC', qty: 1, unit_price: 0, source_unit_price: 0 }, { name: 'PCB', qty: 1, unit_price: 0.25, source_unit_price: 0.25 }],
    extras: { parts_cost: 0.25, labor_cost: 0.1, profit_pct: 12, mold_fees: [{ name: 'PCB模费', amount: 354, currency: 'USD' }] },
  };

  const result = normalizeElectronicImport(source, 0.85, 7.8);

  assert.equal(result.source_currency, 'USD');
  assert.equal(result.normalized_currency, 'RMB');
  assert.equal(result.parts[0].unit_price, 0);
  assert.equal(result.parts[1].source_unit_price, 0.25);
  assert.equal(result.parts[1].unit_price, 1.6575);
  assert.equal(result.extras.labor_cost, 0.663);
  assert.equal(result.source_extras.labor_cost, 0.1);
  assert.equal(result.source_extras.mold_fees[0].amount, 354);
});

test('IC only receives its direct cost, profit and proportional tax', () => {
  const { elecSplitRows: split } = loadElectronicAllocation();
  const parts = [
    { name: 'IC', qty: 1, unit_price: 0.8 },
    { name: 'PCB及其他电子', qty: 1, unit_price: 1.2581044 },
  ];
  const extras = {
    bonding_cost: 0,
    smt_cost: 0.09,
    labor_cost: 0.39,
    test_repair: 0.105,
    packing_shipping: 0.015,
    profit_pct: 10,
    tax_diff: 0.142854894690266,
  };

  const rows = split(parts, extras, 0.85);

  assert.equal(rows.ic.unit_price_rmb, 0.927294);
  assert.equal(rows.pacb.unit_price_rmb, 2.153761);
  assert.equal(rows.ic._unit_price_pretax, 0.88);
  assert.equal(rows.pacb._unit_price_pretax, 2.043915);
  assert.equal(
    +(rows.ic.unit_price_rmb + rows.pacb.unit_price_rmb).toFixed(6),
    3.081055,
  );
});

test('all processing costs remain in PACB when no IC exists', () => {
  const { elecSplitRows: split } = loadElectronicAllocation();
  const rows = split([{ name: 'PCB', qty: 1, unit_price: 2 }], { labor_cost: 1, profit_pct: 10 }, 0.85);

  assert.equal(rows.ic.unit_price_rmb, 0);
  assert.equal(rows.pacb.unit_price_rmb, 3.3);
});

test('legacy automatic split upgrades but manual prices are preserved', () => {
  const { upgradeLegacyElecSplit } = loadElectronicAllocation();
  const payload = {
    electronics: [
      { name: 'IC', unit_price_rmb: 1.197628 },
      { name: 'PACB电子', unit_price_rmb: 1.883427 },
    ],
    electronics_doc: {
      source_format: 'dengxin',
      parts: [
        { name: 'IC', qty: 1, unit_price: 0.8 },
        { name: 'PCB及其他电子', qty: 1, unit_price: 1.2581044 },
      ],
    },
    electronics_extra: {
      smt_cost: 0.09, labor_cost: 0.39, test_repair: 0.105, packing_shipping: 0.015,
      profit_pct: 10, tax_diff: 0.142854894690266,
    },
  };

  assert.equal(upgradeLegacyElecSplit(payload, 0.85), true);
  assert.equal(payload.electronics[0].unit_price_rmb, 0.927294);
  assert.equal(payload.electronics[1].unit_price_rmb, 2.153761);

  payload.electronics[0].unit_price_rmb = 1;
  assert.equal(upgradeLegacyElecSplit(payload, 0.85), false);
  assert.equal(payload.electronics[0].unit_price_rmb, 1);
});
