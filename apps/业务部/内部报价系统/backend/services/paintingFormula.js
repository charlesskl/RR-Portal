const {parseFormulaInput} = require('../../frontend/formula-input');
function normalize(payload) {
  for (const row of payload.painting_items || []) {
    for (const key of Object.keys(row)) {
      if (!/_(qty|unit)_raw$/.test(key)) continue;
      const raw = String(row[key] ?? '').trim();
      const value = parseFormulaInput(raw);
      if (raw && (value == null || value < 0)) throw new Error((row.name || '喷油明细') + ' 数量或单价算式无效，请检查算式或除零');
      row[key.slice(0, -4)] = value;
    }
  }
  for (const child of Object.values(payload.mixed_products || {})) normalize(child);
  if (payload.mixed_shared) normalize(payload.mixed_shared);
  return payload;
}
module.exports = {normalize};
