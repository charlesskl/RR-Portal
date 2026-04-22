const router = require('express').Router();
const { getDb } = require('../services/db');
const { recalculate } = require('../services/calculator');
const crypto = require('crypto');

// Centralized error handler: logs full error server-side, returns sanitized message
function handleError(res, err) {
  console.error('[versions] error:', err);
  res.status(500).json({ error: 'Internal server error' });
}

// Section name → table mapping (list sections)
const LIST_SECTIONS = {
  'mold-parts': 'MoldPart',
  'hardware': 'HardwareItem',
  'electronics': 'ElectronicItem',
  'packaging': 'PackagingItem',
  'body-accessory': 'BodyAccessory',
  'vq-supplement': 'VQSupplement',
  'raw-material': 'RawMaterial',
  'sewing-detail': 'SewingDetail',
  'rotocast': 'RotocastItem',
};

// Singleton sections (one record per version)
const SINGLETON_SECTIONS = {
  'electronic-summary': 'ElectronicSummary',
  'painting': 'PaintingDetail',
  'transport': 'TransportConfig',
  'mold-cost': 'MoldCost',
  'dimensions': 'ProductDimension',
};

// All section tables for full version load
const ALL_SECTION_TABLES = {
  mold_parts: 'MoldPart',
  hardware_items: 'HardwareItem',
  electronic_items: 'ElectronicItem',
  electronic_summary: 'ElectronicSummary',
  painting_detail: 'PaintingDetail',
  packaging_items: 'PackagingItem',
  transport_config: 'TransportConfig',
  mold_cost: 'MoldCost',
  product_dimension: 'ProductDimension',
  material_prices: 'MaterialPrice',
  machine_prices: 'MachinePrice',
  body_accessories: 'BodyAccessory',
  vq_supplements: 'VQSupplement',
  raw_materials: 'RawMaterial',
  sewing_details: 'SewingDetail',
  rotocast_items: 'RotocastItem',
};

// Helper: get columns for a table (excluding id and version_id)
function getEditableColumns(db, table) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  return cols
    .filter(c => c.name !== 'id' && c.name !== 'version_id')
    .map(c => c.name);
}

// Helper: verify version exists
function getVersion(db, id) {
  return db.prepare('SELECT * FROM QuoteVersion WHERE id = ?').get(id);
}

// ─── Version CRUD ────────────────────────────────────────────

// GET /:id — full version data
router.get('/:id', (req, res) => {
  try {
    const db = getDb();
    const version = getVersion(db, req.params.id);
    if (!version) return res.status(404).json({ error: 'Version not found' });

    const params  = db.prepare('SELECT * FROM QuoteParams WHERE version_id = ?').get(req.params.id);
    const product = db.prepare('SELECT * FROM Product WHERE id = ?').get(version.product_id);

    const result = { ...version, product: product || null, params: params || null };
    for (const [key, table] of Object.entries(ALL_SECTION_TABLES)) {
      const rows = db.prepare(`SELECT * FROM ${table} WHERE version_id = ?`).all(req.params.id);
      // Singleton sections return single object or null
      if (['electronic_summary', 'painting_detail', 'transport_config', 'mold_cost', 'product_dimension'].includes(key)) {
        result[key] = rows[0] || null;
      } else {
        result[key] = rows;
      }
    }
    res.json(result);
  } catch (err) {
    handleError(res, err);
  }
});

// PUT /:id — update version metadata
router.put('/:id', (req, res) => {
  try {
    const db = getDb();
    const version = getVersion(db, req.params.id);
    if (!version) return res.status(404).json({ error: 'Version not found' });

    const UPDATABLE = ['status', 'version_name', 'quote_date', 'item_rev', 'prepared_by',
      'quote_rev', 'fty_delivery_date', 'body_no', 'bd_prepared_by', 'bd_date', 'body_cost_revision'];
    const sets = [];
    const vals = [];
    for (const field of UPDATABLE) {
      if (req.body[field] !== undefined) { sets.push(`${field} = ?`); vals.push(req.body[field]); }
    }
    if (sets.length === 0) return res.status(400).json({ error: 'No fields to update' });

    sets.push("updated_at = datetime('now')");
    vals.push(req.params.id);
    db.prepare(`UPDATE QuoteVersion SET ${sets.join(', ')} WHERE id = ?`).run(...vals);

    const updated = getVersion(db, req.params.id);
    res.json(updated);
  } catch (err) {
    handleError(res, err);
  }
});

// DELETE /:id — delete version (CASCADE)
router.delete('/:id', (req, res) => {
  try {
    const db = getDb();
    const version = getVersion(db, req.params.id);
    if (!version) return res.status(404).json({ error: 'Version not found' });

    db.prepare('DELETE FROM QuoteVersion WHERE id = ?').run(req.params.id);
    res.json({ message: 'Version deleted' });
  } catch (err) {
    handleError(res, err);
  }
});

// POST /:id/duplicate — deep copy version
router.post('/:id/duplicate', (req, res) => {
  try {
    const db = getDb();
    const version = getVersion(db, req.params.id);
    if (!version) return res.status(404).json({ error: 'Version not found' });

    const newName = (version.version_name || 'v1') + ' (copy)';

    const dup = db.transaction(() => {
      // Copy QuoteVersion
      const vResult = db.prepare(`
        INSERT INTO QuoteVersion (product_id, version_name, source_sheet, date_code, quote_date, status,
          item_rev, prepared_by, quote_rev, fty_delivery_date, body_no, bd_prepared_by, bd_date, body_cost_revision,
          format_type)
        VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(version.product_id, newName, version.source_sheet, version.date_code, version.quote_date,
        version.item_rev, version.prepared_by, version.quote_rev, version.fty_delivery_date,
        version.body_no, version.bd_prepared_by, version.bd_date, version.body_cost_revision,
        version.format_type);
      const newId = vResult.lastInsertRowid;

      // Copy QuoteParams
      const params = db.prepare('SELECT * FROM QuoteParams WHERE version_id = ?').get(req.params.id);
      if (params) {
        const cols = getEditableColumns(db, 'QuoteParams');
        const vals = cols.map(c => params[c]);
        db.prepare(`INSERT INTO QuoteParams (version_id, ${cols.join(', ')}) VALUES (?, ${cols.map(() => '?').join(', ')})`).run(newId, ...vals);
      }

      // Copy all section tables
      const allTables = { ...ALL_SECTION_TABLES };
      // QuoteParams already handled above, skip MaterialPrice/MachinePrice — they're in ALL_SECTION_TABLES
      for (const [, table] of Object.entries(allTables)) {
        const rows = db.prepare(`SELECT * FROM ${table} WHERE version_id = ?`).all(req.params.id);
        if (rows.length === 0) continue;
        const cols = getEditableColumns(db, table);
        const stmt = db.prepare(`INSERT INTO ${table} (version_id, ${cols.join(', ')}) VALUES (?, ${cols.map(() => '?').join(', ')})`);
        for (const row of rows) {
          stmt.run(newId, ...cols.map(c => row[c]));
        }
      }

      return newId;
    })();

    const newVersion = getVersion(db, dup);
    res.status(201).json(newVersion);
  } catch (err) {
    handleError(res, err);
  }
});

// ─── Params endpoints ────────────────────────────────────────

// GET /:id/params
router.get('/:id/params', (req, res) => {
  try {
    const db = getDb();
    const version = getVersion(db, req.params.id);
    if (!version) return res.status(404).json({ error: 'Version not found' });

    const params = db.prepare('SELECT * FROM QuoteParams WHERE version_id = ?').get(req.params.id);
    const materialPrices = db.prepare('SELECT * FROM MaterialPrice WHERE version_id = ?').all(req.params.id);
    const machinePrices = db.prepare('SELECT * FROM MachinePrice WHERE version_id = ?').all(req.params.id);

    res.json({
      params: params || null,
      material_prices: materialPrices,
      machine_prices: machinePrices,
    });
  } catch (err) {
    handleError(res, err);
  }
});

// PUT /:id/params
router.put('/:id/params', (req, res) => {
  try {
    const db = getDb();
    const version = getVersion(db, req.params.id);
    if (!version) return res.status(404).json({ error: 'Version not found' });

    const existing = db.prepare('SELECT * FROM QuoteParams WHERE version_id = ?').get(req.params.id);
    const cols = getEditableColumns(db, 'QuoteParams');
    const body = req.body;

    if (existing) {
      const sets = [];
      const vals = [];
      for (const col of cols) {
        if (body[col] !== undefined) {
          sets.push(`${col} = ?`);
          vals.push(body[col]);
        }
      }
      if (sets.length > 0) {
        vals.push(req.params.id);
        db.prepare(`UPDATE QuoteParams SET ${sets.join(', ')} WHERE version_id = ?`).run(...vals);
      }
    } else {
      const valArr = cols.map(c => body[c] !== undefined ? body[c] : null);
      db.prepare(`INSERT INTO QuoteParams (version_id, ${cols.join(', ')}) VALUES (?, ${cols.map(() => '?').join(', ')})`).run(req.params.id, ...valArr);
    }

    const updated = db.prepare('SELECT * FROM QuoteParams WHERE version_id = ?').get(req.params.id);
    res.json(updated);
  } catch (err) {
    handleError(res, err);
  }
});

// PUT /:id/material-prices — bulk replace
router.put('/:id/material-prices', (req, res) => {
  try {
    const db = getDb();
    const version = getVersion(db, req.params.id);
    if (!version) return res.status(404).json({ error: 'Version not found' });

    const items = req.body;
    if (!Array.isArray(items)) return res.status(400).json({ error: 'Body must be an array' });

    const cols = getEditableColumns(db, 'MaterialPrice');
    db.transaction(() => {
      db.prepare('DELETE FROM MaterialPrice WHERE version_id = ?').run(req.params.id);
      const stmt = db.prepare(`INSERT INTO MaterialPrice (version_id, ${cols.join(', ')}) VALUES (?, ${cols.map(() => '?').join(', ')})`);
      for (const item of items) {
        stmt.run(req.params.id, ...cols.map(c => item[c] !== undefined ? item[c] : null));
      }
    })();

    const rows = db.prepare('SELECT * FROM MaterialPrice WHERE version_id = ?').all(req.params.id);
    res.json(rows);
  } catch (err) {
    handleError(res, err);
  }
});

// PUT /:id/machine-prices — bulk replace
router.put('/:id/machine-prices', (req, res) => {
  try {
    const db = getDb();
    const version = getVersion(db, req.params.id);
    if (!version) return res.status(404).json({ error: 'Version not found' });

    const items = req.body;
    if (!Array.isArray(items)) return res.status(400).json({ error: 'Body must be an array' });

    const cols = getEditableColumns(db, 'MachinePrice');
    db.transaction(() => {
      db.prepare('DELETE FROM MachinePrice WHERE version_id = ?').run(req.params.id);
      const stmt = db.prepare(`INSERT INTO MachinePrice (version_id, ${cols.join(', ')}) VALUES (?, ${cols.map(() => '?').join(', ')})`);
      for (const item of items) {
        stmt.run(req.params.id, ...cols.map(c => item[c] !== undefined ? item[c] : null));
      }
    })();

    const rows = db.prepare('SELECT * FROM MachinePrice WHERE version_id = ?').all(req.params.id);
    res.json(rows);
  } catch (err) {
    handleError(res, err);
  }
});

// ─── Section data CRUD ───────────────────────────────────────

// GET /:id/sections/:section
router.get('/:id/sections/:section', (req, res) => {
  try {
    const db = getDb();
    const { id, section } = req.params;
    const version = getVersion(db, id);
    if (!version) return res.status(404).json({ error: 'Version not found' });

    const table = LIST_SECTIONS[section] || SINGLETON_SECTIONS[section];
    if (!table) return res.status(400).json({ error: `Unknown section: ${section}` });

    const rows = db.prepare(`SELECT * FROM ${table} WHERE version_id = ?`).all(id);

    if (SINGLETON_SECTIONS[section]) {
      res.json(rows[0] || null);
    } else {
      res.json(rows);
    }
  } catch (err) {
    handleError(res, err);
  }
});

// POST /:id/sections/:section — add item (list sections only)
router.post('/:id/sections/:section', (req, res) => {
  try {
    const db = getDb();
    const { id, section } = req.params;
    const version = getVersion(db, id);
    if (!version) return res.status(404).json({ error: 'Version not found' });

    const table = LIST_SECTIONS[section];
    if (!table) {
      if (SINGLETON_SECTIONS[section]) {
        return res.status(400).json({ error: `${section} is a singleton section, use PUT` });
      }
      return res.status(400).json({ error: `Unknown section: ${section}` });
    }

    const cols = getEditableColumns(db, table);
    const body = req.body;
    const vals = cols.map(c => body[c] !== undefined ? body[c] : null);

    const result = db.prepare(
      `INSERT INTO ${table} (version_id, ${cols.join(', ')}) VALUES (?, ${cols.map(() => '?').join(', ')})`
    ).run(id, ...vals);

    const created = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(result.lastInsertRowid);
    res.status(201).json(created);
  } catch (err) {
    handleError(res, err);
  }
});

// PUT /:id/sections/:section/:itemId — update item
router.put('/:id/sections/:section/:itemId', (req, res) => {
  try {
    const db = getDb();
    const { id, section, itemId } = req.params;
    const version = getVersion(db, id);
    if (!version) return res.status(404).json({ error: 'Version not found' });

    const table = LIST_SECTIONS[section] || SINGLETON_SECTIONS[section];
    if (!table) return res.status(400).json({ error: `Unknown section: ${section}` });

    // For singleton sections, itemId is the record id
    const existing = db.prepare(`SELECT * FROM ${table} WHERE id = ? AND version_id = ?`).get(itemId, id);

    if (!existing && SINGLETON_SECTIONS[section]) {
      // Upsert: create if not exists for singleton
      const cols = getEditableColumns(db, table);
      const body = req.body;
      const vals = cols.map(c => body[c] !== undefined ? body[c] : null);
      const result = db.prepare(
        `INSERT INTO ${table} (version_id, ${cols.join(', ')}) VALUES (?, ${cols.map(() => '?').join(', ')})`
      ).run(id, ...vals);
      const created = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(result.lastInsertRowid);
      return res.json(created);
    }

    if (!existing) return res.status(404).json({ error: 'Item not found' });

    const cols = getEditableColumns(db, table);
    const body = req.body;
    const sets = [];
    const vals = [];
    for (const col of cols) {
      if (body[col] !== undefined) {
        sets.push(`${col} = ?`);
        vals.push(body[col]);
      }
    }
    if (sets.length === 0) return res.status(400).json({ error: 'No fields to update' });

    vals.push(itemId, id);
    db.prepare(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = ? AND version_id = ?`).run(...vals);

    const updated = db.prepare(`SELECT * FROM ${table} WHERE id = ? AND version_id = ?`).get(itemId, id);
    res.json(updated);
  } catch (err) {
    handleError(res, err);
  }
});

// DELETE /:id/sections/:section/:itemId — delete item (list sections only)
router.delete('/:id/sections/:section/:itemId', (req, res) => {
  try {
    const db = getDb();
    const { id, section, itemId } = req.params;
    const version = getVersion(db, id);
    if (!version) return res.status(404).json({ error: 'Version not found' });

    const table = LIST_SECTIONS[section];
    if (!table) {
      if (SINGLETON_SECTIONS[section]) {
        return res.status(400).json({ error: `${section} is a singleton section, cannot delete individual items` });
      }
      return res.status(400).json({ error: `Unknown section: ${section}` });
    }

    const existing = db.prepare(`SELECT * FROM ${table} WHERE id = ? AND version_id = ?`).get(itemId, id);
    if (!existing) return res.status(404).json({ error: 'Item not found' });

    db.prepare(`DELETE FROM ${table} WHERE id = ? AND version_id = ?`).run(itemId, id);
    res.json({ message: 'Item deleted' });
  } catch (err) {
    handleError(res, err);
  }
});

// ─── Singleton section PUT (no itemId needed) ────────────────

// PUT /:id/sections/:section (for singleton sections — upsert)
router.put('/:id/sections/:section', (req, res) => {
  try {
    const db = getDb();
    const { id, section } = req.params;
    const version = getVersion(db, id);
    if (!version) return res.status(404).json({ error: 'Version not found' });

    const table = SINGLETON_SECTIONS[section];
    if (!table) return res.status(400).json({ error: `${section} is not a singleton section` });

    const cols = getEditableColumns(db, table);
    const body = req.body;
    const existing = db.prepare(`SELECT * FROM ${table} WHERE version_id = ?`).get(id);

    if (existing) {
      const sets = [];
      const vals = [];
      for (const col of cols) {
        if (body[col] !== undefined) {
          sets.push(`${col} = ?`);
          vals.push(body[col]);
        }
      }
      if (sets.length > 0) {
        vals.push(id);
        db.prepare(`UPDATE ${table} SET ${sets.join(', ')} WHERE version_id = ?`).run(...vals);
      }
    } else {
      const vals = cols.map(c => body[c] !== undefined ? body[c] : null);
      db.prepare(`INSERT INTO ${table} (version_id, ${cols.join(', ')}) VALUES (?, ${cols.map(() => '?').join(', ')})`).run(id, ...vals);
    }

    const updated = db.prepare(`SELECT * FROM ${table} WHERE version_id = ?`).get(id);
    res.json(updated);
  } catch (err) {
    handleError(res, err);
  }
});

// ─── Calculate endpoint ──────────────────────────────────────

// GET /:id/calculate
router.get('/:id/calculate', (req, res) => {
  try {
    const db = getDb();
    const version = getVersion(db, req.params.id);
    if (!version) return res.status(404).json({ error: 'Version not found' });

    const result = recalculate(req.params.id);
    res.json(result);
  } catch (err) {
    handleError(res, err);
  }
});

// ─── Auto-translate all Chinese names for a version ──────────

// POST /:id/translate-all
router.post('/:id/translate-all', async (req, res) => {
  try {
    const db = getDb();
    const version = getVersion(db, req.params.id);
    if (!version) return res.status(404).json({ error: 'Version not found' });
    const vid = req.params.id;

    const appid = process.env.BAIDU_APPID;
    const key = process.env.BAIDU_KEY;
    if (!appid || !key) {
      return res.status(503).json({ error: 'Baidu translation not configured (BAIDU_APPID / BAIDU_KEY missing)' });
    }

    async function myMemoryTranslate(text) {
      const salt = Date.now().toString();
      const sign = crypto.createHash('md5').update(appid + text + salt + key).digest('hex');
      const url = `https://fanyi-api.baidu.com/api/trans/vip/translate?q=${encodeURIComponent(text)}&from=zh&to=en&appid=${appid}&salt=${salt}&sign=${sign}`;
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 8000);
      try {
        const resp = await fetch(url, { signal: ctrl.signal });
        const data = await resp.json();
        if (data.trans_result && data.trans_result[0]) return data.trans_result[0].dst;
        throw new Error(data.error_msg || 'Translation failed');
      } finally {
        clearTimeout(timeout);
      }
    }

    const EMPTY = "(eng_name IS NULL OR eng_name = '')";
    const batches = [
      { table: 'MoldPart',       field: 'description', sql: `SELECT id, description FROM MoldPart       WHERE version_id=? AND ${EMPTY} ORDER BY sort_order` },
      { table: 'HardwareItem',   field: 'name',        sql: `SELECT id, name        FROM HardwareItem   WHERE version_id=? AND ${EMPTY} ORDER BY sort_order` },
      { table: 'PackagingItem',  field: 'name',        sql: `SELECT id, name        FROM PackagingItem  WHERE version_id=? AND ${EMPTY} ORDER BY sort_order` },
      { table: 'ElectronicItem', field: 'part_name',   sql: `SELECT id, part_name   FROM ElectronicItem WHERE version_id=? AND ${EMPTY} ORDER BY sort_order` },
      { table: 'SewingDetail',   field: 'fabric_name', sql: `SELECT id, fabric_name FROM SewingDetail   WHERE version_id=? AND ${EMPTY} ORDER BY sort_order` },
      { table: 'RawMaterial',    field: 'material_name', sql: `SELECT id, material_name FROM RawMaterial WHERE version_id=? AND ${EMPTY} ORDER BY sort_order` },
      { table: 'RawMaterial',    field: 'spec',          engField: 'spec_eng', sql: `SELECT id, spec FROM RawMaterial WHERE version_id=? AND category='fabric' AND spec IS NOT NULL AND spec != '' AND (spec_eng IS NULL OR spec_eng = '') ORDER BY sort_order` },
      { table: 'RotocastItem',   field: 'name',          sql: `SELECT id, name FROM RotocastItem WHERE version_id=? AND ${EMPTY} ORDER BY sort_order` },
      { table: 'BodyAccessory',  field: 'description',   sql: `SELECT id, description FROM BodyAccessory WHERE version_id=? AND ${EMPTY} ORDER BY sort_order` },
    ];

    // Fixed translation overrides (Chinese keyword → fixed English)
    const FIXED_TRANSLATIONS = {
      '杂费': 'Dennison',
      '外箱': 'Master Carton K3A',
      '平卡': 'Inner B33',
    };
    function fixedTranslate(text) {
      for (const [key, val] of Object.entries(FIXED_TRANSLATIONS)) {
        if (text.includes(key)) return val;
      }
      return null;
    }

    let total = 0;
    const cache = {}; // text → translated, avoid duplicate API calls
    for (const b of batches) {
      const rows = db.prepare(b.sql).all(vid);
      if (!rows.length) continue;
      const update = db.prepare(`UPDATE ${b.table} SET ${b.engField || 'eng_name'} = ? WHERE id = ?`);
      for (const row of rows) {
        const text = row[b.field];
        if (!text) continue;
        // Check fixed overrides first
        const fixed = fixedTranslate(text);
        if (fixed) {
          update.run(fixed, row.id);
          total++;
          continue;
        }
        // Skip if already English (no Chinese characters)
        if (!/[\u4e00-\u9fff]/.test(text)) {
          update.run(text, row.id);
          total++;
          continue;
        }
        try {
          if (cache[text] === undefined) {
            cache[text] = await myMemoryTranslate(text);
          }
          update.run(cache[text], row.id);
          total++;
        } catch (_) { /* skip on error */ }
      }
    }

    res.json({ translated: total });
  } catch (err) {
    handleError(res, err);
  }
});

// POST /:id/translate-sewing (kept for backward compat)
// 用相对路径，让浏览器基于原始 URL 解析，兼容 nginx 子路径部署
router.post('/:id/translate-sewing', async (req, res) => {
  res.redirect(307, './translate-all');
});

module.exports = router;
