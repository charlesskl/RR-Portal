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

function isBlankRefItem(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
  const values = Object.values(item);
  return values.length === 0 || values.every((value) => value === '' || value === null || value === undefined);
}

function mergeMissingRefDefaultsWithStats(existing, defaults, tableKey = 'material_prices') {
  const rows = Array.isArray(existing) ? existing.slice() : [];
  let added = 0;
  let changed = false;
  for (const item of defaults || []) {
    const key = refItemKey(tableKey, item);
    const existingIndex = rows.findIndex((row) => !isBlankRefItem(row) && refItemKey(tableKey, row) === key);
    const blankIndex = rows.findIndex(isBlankRefItem);
    if (existingIndex >= 0) {
      if (blankIndex >= 0 && blankIndex < existingIndex) {
        rows[blankIndex] = rows[existingIndex];
        rows.splice(existingIndex, 1);
        changed = true;
      }
    } else {
      if (blankIndex >= 0) rows[blankIndex] = { ...item };
      else rows.push({ ...item });
      added += 1;
      changed = true;
    }
  }
  return { rows, added, changed };
}

function mergeMissingRefDefaults(existing, defaults, tableKey = 'material_prices') {
  return mergeMissingRefDefaultsWithStats(existing, defaults, tableKey).rows;
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
  const { rows: merged, added, changed } = mergeMissingRefDefaultsWithStats(existing, defaults, tableKey);
  if (changed) {
    db.prepare(`
      UPDATE ref_tables
      SET data_json = ?, updated_at = datetime('now'), updated_by = ?
      WHERE key = ?
    `).run(JSON.stringify(merged), '[seed-upgrade]', tableKey);
  }
  return added;
}

function parseSectionPayload(raw) {
  try {
    const payload = JSON.parse(raw || '{}');
    return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  } catch {
    return {};
  }
}

function appendMissingRefDefaultsToSectionPayloads(db, dept, tableKey, defaults) {
  const rows = db.prepare('SELECT id, payload_json FROM quote_sections WHERE dept = ?').all(dept);
  const update = db.prepare('UPDATE quote_sections SET payload_json = ? WHERE id = ?');
  let rowsChanged = 0;
  let itemsAdded = 0;

  for (const row of rows) {
    const payload = parseSectionPayload(row.payload_json);
    const existing = payload[tableKey];
    if (!Array.isArray(existing) || existing.length === 0) continue;

    const { rows: merged, added, changed } = mergeMissingRefDefaultsWithStats(existing, defaults, tableKey);
    if (changed) {
      payload[tableKey] = merged;
      update.run(JSON.stringify(payload), row.id);
      rowsChanged += 1;
      itemsAdded += added;
    }
  }

  return { rowsChanged, itemsAdded };
}

module.exports = {
  appendMissingRefDefaultsToSectionPayloads,
  refSeedUpgrades,
  mergeMissingRefDefaults,
  appendMissingRefDefaults,
};
