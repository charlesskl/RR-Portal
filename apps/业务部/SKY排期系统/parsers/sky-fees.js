function appendRemarks(...parts) {
  return [...new Set(parts.flatMap(part => String(part || '').split('；')).map(s => s.trim()).filter(Boolean))].join('；');
}

function normalizeServiceRows(po) {
  const items = [], fees = [...(po.fees || [])];
  for (const item of po.items || []) {
    // Previously saved previews may have treated the service placeholder as a product.
    if (/^zzOther$/i.test(item.partNo) && /^(?:Other\s+)?Importer Label Cost$/i.test(String(item.description || '').trim())) {
      fees.push({...item, kind:'importerLabel'});
    } else {
      items.push(item);
    }
  }
  return {...po, fees, items:itemsWithFeeRemarks(items, fees)};
}

function itemsWithFeeRemarks(items, fees) {
  if (!fees?.length || !items.length) return items;
  const rows = items.map(item => ({...item}));
  const labels = fees.filter(f => f.kind === 'importerLabel');
  if (labels.length) {
    const count = labels.reduce((sum, fee) => sum + fee.quantity, 0);
    const quantity = rows.reduce((sum, row) => sum + row.quantity, 0);
    if (count !== quantity || new Set(labels.map(fee => fee.unitPrice)).size !== 1) {
      throw Error('进口商贴纸数量或单价无法对应各货号，请核对需贴纸的货号及数量');
    }
    for (const row of rows) {
      row.remark = appendRemarks(row.remark, 'Importer Label Cost:$' + labels[0].unitPrice + '一张');
    }
  }
  // A rework charge belongs to the PO. Record its total once, even for a multi-SKU order.
  for (const fee of fees.filter(f => /^Rework Cost\b/i.test(f.description))) {
    rows[0].remark = appendRemarks(rows[0].remark, fee.description + ':$' + fee.amount);
  }
  return rows;
}
module.exports = {appendRemarks, itemsWithFeeRemarks, normalizeServiceRows};
