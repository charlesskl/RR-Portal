'use strict';

function num(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function productKey(row) {
  return String((row && (row.product_group_id || row.product_group_name)) || '').trim();
}

function productRatio(payload, key) {
  const ratios = (payload && payload.product_mix_ratios) || {};
  if (!Object.prototype.hasOwnProperty.call(ratios, key) || ratios[key] === '') return 1;
  return Math.max(0, num(ratios[key]));
}

function injectionProductGroups(payload) {
  const rows = (payload && payload.injection) || [];
  if (!rows.some(row => productKey(row))) return [];
  const groups = new Map();
  rows.forEach((row, index) => {
    const key = productKey(row) || '__ungrouped__';
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        name: row.product_group_name || (key === '__ungrouped__' ? '未分组产品' : key),
        ratio: productRatio(payload, key),
        rows: [],
      });
    }
    groups.get(key).rows.push({ row, index });
  });
  return [...groups.values()];
}

function weightedInjectionSum(payload, getter) {
  const rows = (payload && payload.injection) || [];
  const groups = injectionProductGroups(payload);
  if (groups.length <= 1) return rows.reduce((total, row, index) => total + num(getter(row, index)), 0);
  const totalRatio = groups.reduce((total, group) => total + group.ratio, 0);
  if (totalRatio <= 0) return 0;
  return groups.reduce((total, group) => {
    const subtotal = group.rows.reduce((value, item) => value + num(getter(item.row, item.index)), 0);
    return total + subtotal * group.ratio;
  }, 0) / totalRatio;
}

function weightedColumnFormula(payload, dataStartRow, columnLetter) {
  const groups = injectionProductGroups(payload);
  const rows = (payload && payload.injection) || [];
  if (groups.length <= 1) return `SUM(${columnLetter}${dataStartRow}:${columnLetter}${dataStartRow + rows.length - 1})`;
  const totalRatio = groups.reduce((total, group) => total + group.ratio, 0);
  if (totalRatio <= 0) return '0';
  const terms = groups.map(group => {
    const cells = group.rows.map(item => `${columnLetter}${dataStartRow + item.index}`);
    return `(${cells.join('+')})*${group.ratio}`;
  });
  return `(${terms.join('+')})/${totalRatio}`;
}

module.exports = {
  productKey,
  productRatio,
  injectionProductGroups,
  weightedInjectionSum,
  weightedColumnFormula,
};
