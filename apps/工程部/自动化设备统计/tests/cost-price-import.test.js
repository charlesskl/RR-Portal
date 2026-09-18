const { test } = require('node:test');
const assert = require('node:assert/strict');
const { importCostPrices } = require('../cost-price-import');

test('workbook matching respects merged cells, renamed equipment, and existing prices', () => {
  const data = { equipment: [
    { factory:'兴信B', workshop:'装配', name:'蜘蛛手+视觉贴标机', orders:6075.625, saved:862.13, balance:609.54 },
    { factory:'兴信B', workshop:'装配', name:'蜘蛛手' },
    { factory:'湖南', workshop:'装配', name:'称重机' },
    { factory:'华登', workshop:'装配', name:'方珠摆盘机' },
    { factory:'河源', workshop:'装配', name:'点胶机', manualPrice:0 },
    { factory:'未知', workshop:'装配', name:'点胶机' },
  ] };
  assert.equal(importCostPrices(data), true);
  assert.deepEqual(data.equipment.map(e=>[e.manualPrice,e.machinePrice]), [[.214,.0721],[.214,.0721],[.01,.005],[.68,.44],[0,.28],[undefined,undefined]]);
  assert.equal(data.equipment[0].orders,6075.625);
  assert.equal(data.equipment[0].saved,862.13);
  assert.equal(data.equipment[0].balance,609.54);
  data.equipment[0].manualPrice=null;
  assert.equal(importCostPrices(data),false);
  assert.equal(data.equipment[0].manualPrice,null);
});
