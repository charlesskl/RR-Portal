const validCount = n => [1,2,3].includes(n);
const validRate = n => typeof n === 'number' && Number.isFinite(n) && n >= 0;
const rows = d => Object.values(d?.records || {}).flatMap(day => day.items || []);
function prepare(data, previous) {
  const oldById = new Map(rows(previous).map(row => [row._id, row]));
  for (const product of data.products || []) {
    if (product.fdmLaborCount !== undefined && !validCount(product.fdmLaborCount)) throw Error('FDM 人工人数只能为1、2或3人');
  }
  for (const row of rows(data)) {
    const old = oldById.get(row._id);
    if (row.fdmLaborCount !== undefined && !validCount(row.fdmLaborCount)) throw Error('FDM 人工人数只能为1、2或3人');
    if (row.fdmLaborCount === undefined) {
      const product = (data.products || []).find(p => p.name === row.productName);
      if(old){if(validCount(old.fdmLaborCount))row.fdmLaborCount=old.fdmLaborCount;}
      else row.fdmLaborCount=validCount(product?.fdmLaborCount)?product.fdmLaborCount:3;
    }
    if (Number(row.machine) !== 21) continue;
    if (old && Number(old.machine) === 21) {
      if(validRate(old.resinQuotePerGram)||row.resinQuotePerGram!==undefined)row.resinQuotePerGram=validRate(old.resinQuotePerGram)?old.resinQuotePerGram:0.8;
    }
    else if (!validRate(row.resinQuotePerGram)) row.resinQuotePerGram = validRate(data.settings?.resinQuotePerGram) ? data.settings.resinQuotePerGram : 0.8;
  }
}
module.exports = {prepare};
