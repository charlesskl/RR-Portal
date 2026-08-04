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

function ensureExplicitProductGroups(rows) {
  const sourceRows = rows || [];
  if (sourceRows.some(row => productKey(row))) return sourceRows;
  const markers = new Map();
  sourceRows.forEach(row => {
    const text = String((row && row.name) || '').replace(/\s+/g, ' ').trim();
    const match = text.match(/^(\d+)\s*[#＃号]\s*(.*)$/);
    if (!match) return;
    const number = Number(match[1]);
    markers.set(`product-${number}`, { id: `product-${number}`, name: text, number });
  });
  if (markers.size <= 1) return sourceRows;
  let current = null;
  sourceRows.forEach(row => {
    const text = String((row && row.name) || '').replace(/\s+/g, ' ').trim();
    const match = text.match(/^(\d+)\s*[#＃号]\s*(.*)$/);
    if (match) current = markers.get(`product-${Number(match[1])}`) || current;
    if (!current) return;
    row.product_group_id = current.id;
    row.product_group_name = current.name;
  });
  return sourceRows;
}

function productGroups(payload, rows) {
  const sourceRows = rows || [];
  if (!sourceRows.some(row => productKey(row))) return [];
  const groups = new Map();
  sourceRows.forEach((row, index) => {
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

function injectionProductGroups(payload) {
  return productGroups(payload, (payload && payload.injection) || []);
}

function weightedRowsSum(payload, rows, getter) {
  const sourceRows = rows || [];
  const groups = productGroups(payload, sourceRows);
  if (groups.length <= 1) return sourceRows.reduce((total, row, index) => total + num(getter(row, index)), 0);
  const totalRatio = groups.reduce((total, group) => total + group.ratio, 0);
  if (totalRatio <= 0) return 0;
  return groups.reduce((total, group) => {
    const subtotal = group.rows.reduce((value, item) => value + num(getter(item.row, item.index)), 0);
    return total + subtotal * group.ratio;
  }, 0) / totalRatio;
}

function weightedInjectionSum(payload, getter) {
  const rows = (payload && payload.injection) || [];
  return weightedRowsSum(payload, rows, getter);
}

function weightedRowsFormula(payload, rows, dataStartRow, columnLetter) {
  const sourceRows = rows || [];
  if (!sourceRows.length) return '0';
  const groups = productGroups(payload, sourceRows);
  if (groups.length <= 1) return `SUM(${columnLetter}${dataStartRow}:${columnLetter}${dataStartRow + sourceRows.length - 1})`;
  const totalRatio = groups.reduce((total, group) => total + group.ratio, 0);
  if (totalRatio <= 0) return '0';
  const terms = groups.map(group => {
    const cells = group.rows.map(item => `${columnLetter}${dataStartRow + item.index}`);
    return `(${cells.join('+')})*${group.ratio}`;
  });
  return `(${terms.join('+')})/${totalRatio}`;
}

function weightedColumnFormula(payload, dataStartRow, columnLetter) {
  const rows = (payload && payload.injection) || [];
  return weightedRowsFormula(payload, rows, dataStartRow, columnLetter);
}

module.exports = {
  productKey,
  productRatio,
  ensureExplicitProductGroups,
  productGroups,
  injectionProductGroups,
  weightedRowsSum,
  weightedInjectionSum,
  weightedRowsFormula,
  weightedColumnFormula,
};
