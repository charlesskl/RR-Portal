function appendRemarks(...parts) {
  return [...new Set(parts.flatMap(part => String(part || '').split('；')).map(s => s.trim()).filter(Boolean))].join('；');
}

// The pasted copy may already contain the same charge among hand-written notes.
function mergeFeeRemarks(previous, current, recognized) {
  const key = value => value.trim().toLowerCase();
  const known = new Set(recognized.map(key));

  const tokens = String(previous || '').split(/([,，;；\n])/);
  if (!tokens.some((token, index) => index % 2 === 0 && known.has(key(token)))) {
    return current ? appendRemarks(previous, current) : previous || '';
  }
  const retained = [];
  for (let i = 0; i < tokens.length; i += 2) {
    if (!tokens[i].trim() || known.has(key(tokens[i]))) continue;
    if (retained.length) retained.push(tokens[i - 1]);
    retained.push(tokens[i]);
  }
  return appendRemarks(retained.join(''), current);
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

// Older previews stored one note per tape line. Match only amounts present on this PO.
function tapeLineNotes(fees) {
  return (fees || []).filter(fee => fee.kind === 'tape').map(fee => fee.description + ':$' + fee.amount);
}

function itemsWithFeeRemarks(items, fees) {
  if (!fees?.length || !items.length) return items;
  const rows = items.map(item => ({...item}));
  function note(row, value) {
    row.feeRemarks = [...new Set([...(row.feeRemarks || []), value])];
    row.remark = appendRemarks(row.remark, value);
  }
  const tape = fees.filter(fee => fee.kind === 'tape');
  const tapeCents = tape.reduce((sum, fee) => sum + Math.round(fee.amount * 100), 0);
  if (tape.length > 1) {
    const oldNotes = new Set(tapeLineNotes(tape));
    oldNotes.delete(tape[0].description + ':$' + tapeCents / 100);
    for (const row of rows) {
      const stale = (row.feeRemarks || []).filter(value => oldNotes.has(value));
      if (!stale.length) continue;
      row.feeRemarks = row.feeRemarks.filter(value => !stale.includes(value));
      row.remark = (row.remark || '').split('；').filter(value => !stale.includes(value.trim())).join('；');
    }
  }
  const labels = fees.filter(f => f.kind === 'importerLabel');
  if (labels.length) {
    const count = labels.reduce((sum, fee) => sum + fee.quantity, 0);
    const quantity = rows.reduce((sum, row) => sum + row.quantity, 0);
    if (count !== quantity || new Set(labels.map(fee => fee.unitPrice)).size !== 1) {
      throw Error('进口商贴纸数量或单价无法对应各货号，请核对需贴纸的货号及数量');
    }
    for (const row of rows) {
      note(row, 'Importer Label Cost:$' + labels[0].unitPrice + '一张');
    }
  }
  for (const fee of fees) {
    if (fee.kind === 'upcLabel') {
      const matches = rows.filter(row => row.upcs?.includes(fee.upc));
      if (matches.length !== 1) throw Error('UPC 贴纸费无法唯一对应货号：' + fee.upc);
      const row = matches[0];
      const totalCents = Math.round(fee.amount * 100);
      const rate = row.quantity > 0 && totalCents % row.quantity === 0
        ? '（$' + (totalCents / row.quantity / 100) + '一张）' : '';
      note(row, fee.description + ':$' + fee.amount + rate);
    } else if (fee.kind === 'manual') {
      const matches = fee.codes.map(code => {
        const found = rows.filter(row => row.partNo === code || row.partNo.replace(/CDU-\d+$/i, '') === code);
        if (found.length !== 1) throw Error('说明书费用无法唯一对应货号：' + code);
        return found[0];
      });
      if (new Set(matches).size !== fee.quantity || matches.length !== fee.quantity) {
        throw Error('说明书收费数量与货号数不符');
      }
      for (const row of matches) note(row, 'Customize Collector Manual:$' + fee.unitPrice);
    } else if (fee === tape[0]) {
      note(rows[0], fee.description + ':$' + tapeCents / 100);
    } else if (/^Rework Cost\b/i.test(fee.description)) {
      note(rows[0], fee.description + ':$' + fee.amount);
    }
  }
  return rows;
}
module.exports = {appendRemarks, mergeFeeRemarks, tapeLineNotes, itemsWithFeeRemarks, normalizeServiceRows};
