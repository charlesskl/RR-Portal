const refSeedUpgrades = {
  material_prices: [
    { name: 'ABS', model: '抽粒料', price: 4.60 },
  ],
};

function normalizeRefValue(value) {
  return String(value ?? '').trim().toLowerCase();
}

function refItemKey(tableKey, item) {
  if (tableKey === 'material_prices') {
    return `${normalizeRefValue(item.name)}\u0000${normalizeRefValue(item.model)}`;
  }
  if (tableKey === 'machine_prices') {
    return `${normalizeRefValue(item.model)}`;
  }
  return JSON.stringify(item);
}

function mergeMissingRefDefaults(existing, defaults, tableKey = 'material_prices') {
  const rows = Array.isArray(existing) ? existing.slice() : [];
  const seen = new Set(rows.map((item) => refItemKey(tableKey, item)));
  for (const item of defaults || []) {
    const key = refItemKey(tableKey, item);
    if (!seen.has(key)) {
      rows.push({ ...item });
      seen.add(key);
    }
  }
  return rows;
}

function parseRefRows(raw) {
  try {
    const rows = JSON.parse(raw || '[]');
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

function appendMissingRefDefaults(db, tableKey, defaults) {
  const row = db.prepare('SELECT data_json FROM ref_tables WHERE key = ?').get(tableKey);
  if (!row) return 0;
  const existing = parseRefRows(row.data_json);
  const merged = mergeMissingRefDefaults(existing, defaults, tableKey);
  const added = merged.length - existing.length;
  if (added > 0) {
    db.prepare(`
      UPDATE ref_tables
      SET data_json = ?, updated_at = datetime('now'), updated_by = ?
      WHERE key = ?
    `).run(JSON.stringify(merged), '[seed-upgrade]', tableKey);
  }
  return added;
}

module.exports = {
  refSeedUpgrades,
  mergeMissingRefDefaults,
  appendMissingRefDefaults,
};
