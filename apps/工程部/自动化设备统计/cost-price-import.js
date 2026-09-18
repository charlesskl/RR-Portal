const source = require('./cost-prices-from-workbook.json');
const migration = 'cost-prices-workbook-20260918';

// Only fill missing prices. Keep production totals, savings and existing user prices intact.
function importCostPrices(data) {
  if (data.migrations?.includes(migration)) return false;
  for (const equipment of data.equipment) {
    const matches = source.items.filter(item => item.factories.includes(equipment.factory) &&
      item.workshop === equipment.workshop && item.names.includes(equipment.name));
    if (matches.length !== 1) continue;
    for (const key of ['manualPrice', 'machinePrice']) {
      if (equipment[key] == null && typeof matches[0][key] === 'number') equipment[key] = matches[0][key];
    }
  }
  data.migrations = [...(data.migrations || []), migration];
  return true;
}
module.exports = { importCostPrices };
