// 外发模块（原 pi-outsource 系统迁移而来）— 挂载到 /api/outsource
const express = require('express');
const { nanoid } = require('nanoid');
const multer = require('multer');
const XLSX = require('xlsx');
const { parsePdfBuffer } = require('../services/outsource/pdf-parser');
const { aiParsePdfBuffer } = require('../services/outsource/ai-parser');
const { buildOrdersWorkbook } = require('../services/outsource/excel-exporter');
const { workshopFromPmc, workshopRank, WORKSHOP_ORDER, PMC_TO_WORKSHOP } = require('../services/outsource/pmc-workshop-map');
const db = require('../db/connection');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const round2 = (n) => (typeof n === 'number' && isFinite(n)) ? Math.round(n * 100) / 100 : null;

// 供应商外发价 $ (港币) = 供应商外发价 ¥ / HKD_RATE
const HKD_RATE = 0.88;
function deriveSupplierUsd(o) {
  if (!o) return o;
  const rmb = Number(o.supplier_price_rmb);
  if (isFinite(rmb) && rmb > 0) {
    o.supplier_price_usd = rmb / HKD_RATE;
  }
  return o;
}

function enrich(order) {
  if (!order) return order;
  const shots = Number(order.order_qty_shots) || 0;
  const cap = Number(order.actual_capacity) || 0;
  const quoteUsd = Number(order.quote_price_usd) || 0;
  const supUsd = Number(order.supplier_price_usd) || 0;
  const estimated_days = cap > 0 ? round2(shots / cap) : null;
  const in_house_output = round2(shots * quoteUsd);
  const outsource_output = round2(shots * supUsd);
  const supplier_tax_output = round2(shots * supUsd * 0.13);
  const isPdfImport = !!order.source_bill_no;
  const net_outsource_output = isPdfImport
    ? (order.net_outsource_output ?? null)
    : round2((shots * supUsd) - (shots * supUsd * 0.13));
  return { ...order, estimated_days, in_house_output, outsource_output, supplier_tax_output, net_outsource_output };
}

// ============== SQL prepared statements (compiled once) ==============
const ORDER_COLS = [
  'id', 'seq', 'workshop', 'item_code', 'mold',
  'order_qty_pcs', 'order_qty_shots', 'target_qty', 'quoted_capacity', 'actual_capacity',
  'quote_price_usd', 'supplier_price_rmb', 'supplier_price_usd',
  'supplier', 'pmc_follow',
  'order_date', 'production_start', 'estimated_delivery',
  'remark', 'status', 'net_outsource_output',
  'source_bill_no', 'source_customer', 'source_production_no', 'source_mold_code',
  'created_at', 'updated_at',
];
function normalizeOrder(o) {
  const out = {};
  for (const c of ORDER_COLS) out[c] = (o[c] === undefined) ? null : o[c];
  return out;
}
const ORDER_INSERT_SQL = `INSERT INTO outsource_orders (${ORDER_COLS.join(',')}) VALUES (${ORDER_COLS.map((c) => '@' + c).join(',')})`;
const ORDER_UPDATE_SQL = `UPDATE outsource_orders SET ${ORDER_COLS.filter((c) => c !== 'id').map((c) => `${c}=@${c}`).join(',')} WHERE id=@id`;

const ordersAll = db.prepare('SELECT * FROM outsource_orders');
const orderById = db.prepare('SELECT * FROM outsource_orders WHERE id = ?');
const orderInsert = db.prepare(ORDER_INSERT_SQL);
const orderUpdate = db.prepare(ORDER_UPDATE_SQL);
const orderDelete = db.prepare('DELETE FROM outsource_orders WHERE id = ?');

const suppliersAll = db.prepare('SELECT * FROM outsource_suppliers');
const supplierInsert = db.prepare(`INSERT INTO outsource_suppliers (id, seq, name, total_machines, machines_for_xx, xx_ratio, actual_running, running_rate, contact, address, mold_count, remark) VALUES (@id, @seq, @name, @total_machines, @machines_for_xx, @xx_ratio, @actual_running, @running_rate, @contact, @address, @mold_count, @remark)`);
const supplierUpdate = db.prepare(`UPDATE outsource_suppliers SET seq=@seq, name=@name, total_machines=@total_machines, machines_for_xx=@machines_for_xx, xx_ratio=@xx_ratio, actual_running=@actual_running, running_rate=@running_rate, contact=@contact, address=@address, mold_count=@mold_count, remark=@remark WHERE id=@id`);
const supplierDelete = db.prepare('DELETE FROM outsource_suppliers WHERE id = ?');
const supplierExists = db.prepare('SELECT 1 FROM outsource_suppliers WHERE id = ?');

const mappingsAll = db.prepare('SELECT * FROM outsource_mold_mappings');
const mappingByCode = db.prepare('SELECT * FROM outsource_mold_mappings WHERE mold_code = ?');
const mappingUpsert = db.prepare(`INSERT INTO outsource_mold_mappings (mold_code, supplier, target_qty, workshop, mold_name, updated_at)
  VALUES (@mold_code, @supplier, @target_qty, @workshop, @mold_name, @updated_at)
  ON CONFLICT(mold_code) DO UPDATE SET
    supplier   = COALESCE(excluded.supplier,   outsource_mold_mappings.supplier),
    target_qty = COALESCE(excluded.target_qty, outsource_mold_mappings.target_qty),
    workshop   = COALESCE(excluded.workshop,   outsource_mold_mappings.workshop),
    mold_name  = COALESCE(excluded.mold_name,  outsource_mold_mappings.mold_name),
    updated_at = excluded.updated_at`);
const mappingDelete = db.prepare('DELETE FROM outsource_mold_mappings WHERE mold_code = ?');

const pcAll = db.prepare('SELECT * FROM outsource_pc_orders');
const pcInsert = db.prepare('INSERT INTO outsource_pc_orders (id, seq, factory, item_code, mold, mold_sets, remark) VALUES (@id, @seq, @factory, @item_code, @mold, @mold_sets, @remark)');
const pcUpdate = db.prepare('UPDATE outsource_pc_orders SET seq=@seq, factory=@factory, item_code=@item_code, mold=@mold, mold_sets=@mold_sets, remark=@remark WHERE id=@id');
const pcDelete = db.prepare('DELETE FROM outsource_pc_orders WHERE id = ?');
const pcExists = db.prepare('SELECT 1 FROM outsource_pc_orders WHERE id = ?');

const renameOrdersStmt   = db.prepare(`UPDATE outsource_orders        SET supplier=?, updated_at=? WHERE COALESCE(supplier, '') = ?`);
const renameMappingsStmt = db.prepare(`UPDATE outsource_mold_mappings SET supplier=?, updated_at=? WHERE COALESCE(supplier, '') = ?`);
const renameSuppliersStmt= db.prepare(`UPDATE outsource_suppliers     SET name=?                  WHERE name = ?`);

// Helper: list all mappings as a { mold_code: { ...fields } } object
function getAllMappings() {
  const rows = mappingsAll.all();
  const out = {};
  for (const r of rows) {
    out[r.mold_code] = {
      supplier: r.supplier || '',
      target_qty: r.target_qty,
      workshop: r.workshop || '',
      mold_name: r.mold_name || '',
      updated_at: r.updated_at || '',
    };
  }
  return out;
}

// ============== Routes ==============
router.get('/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

// ---- Orders ----
router.get('/orders', (req, res) => {
  res.json(ordersAll.all().map(enrich));
});

router.post('/orders', (req, res) => {
  const now = new Date().toISOString();
  const item = deriveSupplierUsd({ id: nanoid(10), created_at: now, updated_at: now, ...req.body });
  orderInsert.run(normalizeOrder(item));
  res.json(enrich(orderById.get(item.id)));
});

router.put('/orders/:id', (req, res) => {
  const prev = orderById.get(req.params.id);
  if (!prev) return res.status(404).json({ error: 'not_found' });
  const merged = deriveSupplierUsd({ ...prev, ...req.body, id: prev.id, updated_at: new Date().toISOString() });
  orderUpdate.run(normalizeOrder(merged));
  res.json(enrich(orderById.get(prev.id)));
});

router.delete('/orders/:id', (req, res) => {
  const info = orderDelete.run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true });
});

// ---- Bulk-rename a supplier across orders, mappings, and the suppliers list ----
router.post('/suppliers/rename', (req, res) => {
  const { from = '', to = '' } = req.body || {};
  const fromName = from === '(空)' ? '' : from;
  const toName = (to || '').trim();
  if (toName === '') return res.status(400).json({ error: 'empty_to' });
  if (fromName === toName) return res.json({ orders_updated: 0, mappings_updated: 0, suppliers_updated: 0 });

  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    const r1 = renameOrdersStmt.run(toName, now, fromName);
    const r2 = renameMappingsStmt.run(toName, now, fromName);
    const r3 = fromName ? renameSuppliersStmt.run(toName, fromName) : { changes: 0 };
    return { o: r1.changes, m: r2.changes, s: r3.changes };
  });
  const r = tx();
  res.json({ orders_updated: r.o, mappings_updated: r.m, suppliers_updated: r.s });
});

// ---- Suppliers ----
router.get('/suppliers', (req, res) => res.json(suppliersAll.all()));
router.post('/suppliers', (req, res) => {
  const item = {
    id: nanoid(10), seq: null, name: '',
    total_machines: null, machines_for_xx: null, xx_ratio: null,
    actual_running: null, running_rate: null, contact: '', address: '',
    mold_count: null, remark: '',
    ...req.body,
  };
  supplierInsert.run(item);
  res.json(item);
});
router.put('/suppliers/:id', (req, res) => {
  if (!supplierExists.get(req.params.id)) return res.status(404).json({ error: 'not_found' });
  const cur = db.prepare('SELECT * FROM outsource_suppliers WHERE id=?').get(req.params.id);
  const merged = { ...cur, ...req.body, id: cur.id };
  supplierUpdate.run(merged);
  res.json(merged);
});
router.delete('/suppliers/:id', (req, res) => {
  const info = supplierDelete.run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true });
});

// ---- PC Orders ----
router.get('/pc-orders', (req, res) => res.json(pcAll.all()));
router.post('/pc-orders', (req, res) => {
  const item = { id: nanoid(10), seq: null, factory: '', item_code: '', mold: '', mold_sets: '', remark: '', ...req.body };
  pcInsert.run(item);
  res.json(item);
});
router.put('/pc-orders/:id', (req, res) => {
  if (!pcExists.get(req.params.id)) return res.status(404).json({ error: 'not_found' });
  const cur = db.prepare('SELECT * FROM outsource_pc_orders WHERE id=?').get(req.params.id);
  const merged = { ...cur, ...req.body, id: cur.id };
  pcUpdate.run(merged);
  res.json(merged);
});
router.delete('/pc-orders/:id', (req, res) => {
  const info = pcDelete.run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true });
});

// ---- Stats summary ----
router.get('/stats/summary', (req, res) => {
  const orders = ordersAll.all().map(enrich);
  const total = orders.length;
  const sum = (k) => orders.reduce((a, x) => a + (Number(x[k]) || 0), 0);
  res.json({
    total,
    total_in_house_output: round2(sum('in_house_output')),
    total_outsource_output: round2(sum('outsource_output')),
    total_net_outsource_output: round2(sum('net_outsource_output')),
    by_supplier: orders.reduce((m, o) => {
      const k = o.supplier || '(空)';
      m[k] = (m[k] || 0) + 1;
      return m;
    }, {}),
  });
});

// ---- PDF parse ----
router.post('/parse-pdf', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no_file' });
  try {
    const parsed = await parsePdfBuffer(req.file.buffer);
    res.json({ filename: req.file.originalname, template: parsed.template, header: parsed.header, rows: parsed.rows });
  } catch (e) {
    console.error('parse-pdf error:', e);
    res.status(500).json({ error: 'parse_failed', message: e.message });
  }
});

router.post('/parse-pdf-ai', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no_file' });
  try {
    const parsed = await aiParsePdfBuffer(req.file.buffer);
    res.json({ filename: req.file.originalname, template: parsed.template, header: parsed.header, rows: parsed.rows, model_used: parsed.model_used, usage: parsed.usage });
  } catch (e) {
    console.error('parse-pdf-ai error:', e);
    res.status(500).json({ error: 'ai_parse_failed', message: e.message });
  }
});

// ---- Workshop options ----
router.get('/workshops', (req, res) => {
  const set = new Set(Object.keys(WORKSHOP_ORDER));
  for (const r of db.prepare(`SELECT DISTINCT workshop FROM outsource_orders WHERE workshop IS NOT NULL AND workshop != ''`).all()) set.add(r.workshop);
  for (const r of db.prepare(`SELECT DISTINCT workshop FROM outsource_mold_mappings WHERE workshop IS NOT NULL AND workshop != ''`).all()) set.add(r.workshop);
  res.json([...set].sort((a, b) => workshopRank(a) - workshopRank(b)));
});

router.get('/workshop-order', (req, res) => res.json(WORKSHOP_ORDER));

router.get('/pmcs', (req, res) => {
  const set = new Set(Object.keys(PMC_TO_WORKSHOP));
  for (const r of db.prepare(`SELECT DISTINCT pmc_follow FROM outsource_orders WHERE pmc_follow IS NOT NULL AND pmc_follow != ''`).all()) set.add(r.pmc_follow);
  const list = [...set].map((name) => ({ name, workshop: PMC_TO_WORKSHOP[name] || '' }));
  list.sort((a, b) => (workshopRank(a.workshop) - workshopRank(b.workshop)) || a.name.localeCompare(b.name, 'zh'));
  res.json(list);
});

// ---- Mold mappings ----
router.get('/mold-mappings', (req, res) => res.json(getAllMappings()));

router.post('/mold-mappings', (req, res) => {
  const { mappings = {} } = req.body || {};
  if (typeof mappings !== 'object') return res.status(400).json({ error: 'bad_body' });
  const now = new Date().toISOString();
  let updated = 0;
  const tx = db.transaction((items) => {
    for (const [k, v] of Object.entries(items)) {
      if (!k || !v) continue;
      mappingUpsert.run({
        mold_code: k,
        supplier: (v.supplier !== undefined && v.supplier !== '') ? v.supplier : null,
        target_qty: (v.target_qty !== undefined && v.target_qty !== null && v.target_qty !== '') ? Number(v.target_qty) : null,
        workshop: v.workshop !== undefined ? v.workshop : null,
        mold_name: (v.mold_name !== undefined && v.mold_name !== '') ? v.mold_name : null,
        updated_at: now,
      });
      updated++;
    }
  });
  tx(mappings);
  const total = db.prepare('SELECT COUNT(*) c FROM outsource_mold_mappings').get().c;
  res.json({ updated, total });
});

router.put('/mold-mappings/:mold_code', (req, res) => {
  const key = req.params.mold_code;
  if (!key) return res.status(400).json({ error: 'bad_key' });
  const { supplier, target_qty, mold_name, workshop } = req.body || {};
  mappingUpsert.run({
    mold_code: key,
    supplier: supplier !== undefined ? supplier : null,
    target_qty: (target_qty === null || target_qty === '' || target_qty === undefined) ? null : Number(target_qty),
    workshop: workshop !== undefined ? workshop : null,
    mold_name: mold_name !== undefined ? mold_name : null,
    updated_at: new Date().toISOString(),
  });
  res.json(mappingByCode.get(key) || {});
});

router.delete('/mold-mappings/:mold_code', (req, res) => {
  const info = mappingDelete.run(req.params.mold_code);
  if (info.changes === 0) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true });
});

// Aggregated view: which molds at which factory, with order stats
router.get('/mold-factory-map', (req, res) => {
  const mappings = getAllMappings();
  const orders = ordersAll.all();

  const orderStats = {};
  const namesFromOrders = {};
  for (const o of orders) {
    const code = o.source_mold_code || extractMoldCode(o.mold || '');
    if (!code) continue;
    const s = orderStats[code] || { count: 0, latest_date: '', total_shots: 0, latest_supplier: '' };
    s.count += 1;
    s.total_shots += Number(o.order_qty_shots) || 0;
    const dt = o.order_date || o.estimated_delivery || '';
    if (dt && dt > s.latest_date) {
      s.latest_date = dt;
      if (o.supplier) s.latest_supplier = o.supplier;
    }
    orderStats[code] = s;
    if (!namesFromOrders[code] && o.mold) {
      const after = o.mold.replace(code, '').trim();
      if (after) namesFromOrders[code] = after;
    }
  }

  const allCodes = new Set([...Object.keys(mappings), ...Object.keys(orderStats)]);
  const grouped = {};
  for (const code of allCodes) {
    const m = mappings[code] || {};
    const s = orderStats[code] || { count: 0, latest_date: '', total_shots: 0, latest_supplier: '' };
    const supplier = m.supplier || s.latest_supplier || '(未分配)';
    const mold_name = m.mold_name || namesFromOrders[code] || '';
    const row = {
      mold_code: code, mold_name, supplier,
      target_qty: m.target_qty ?? null,
      mapped: !!m.supplier,
      order_count: s.count, total_shots: s.total_shots,
      latest_date: s.latest_date,
      updated_at: m.updated_at || '',
    };
    (grouped[supplier] = grouped[supplier] || []).push(row);
  }
  for (const arr of Object.values(grouped)) arr.sort((a, b) => a.mold_code.localeCompare(b.mold_code));
  res.json({
    suppliers: Object.entries(grouped)
      .map(([name, molds]) => ({ name, molds, mold_count: molds.length }))
      .sort((a, b) => {
        if (a.name === '(未分配)') return 1;
        if (b.name === '(未分配)') return -1;
        return b.mold_count - a.mold_count;
      }),
    total_molds: allCodes.size,
    total_suppliers: Object.keys(grouped).length,
  });
});

function extractMoldCode(moldStr) {
  const t = String(moldStr).trim().split(/\s+/)[0];
  return t || '';
}

// ---- Import parsed PDF rows into orders ----
router.post('/import-pdf-rows', (req, res) => {
  const { header = {}, rows = [], workshop: defaultWorkshop = '', default_supplier = '' } = req.body || {};
  if (!Array.isArray(rows) || rows.length === 0) return res.status(400).json({ error: 'no_rows' });

  const now = new Date().toISOString();
  const insertedIds = [];

  const tx = db.transaction(() => {
    for (const r of rows) {
      const supplier = r.supplier || default_supplier || '';
      const target_qty = r.target_qty ?? null;
      const rowPmc = r.pmc_follow || header.placer || '';
      const rowWorkshop = r.workshop || defaultWorkshop || workshopFromPmc(rowPmc) || '';

      if (r.mold_code && (supplier || target_qty !== null || r.mold_name || rowWorkshop)) {
        mappingUpsert.run({
          mold_code: r.mold_code,
          supplier: supplier || null,
          target_qty: target_qty !== null ? Number(target_qty) : null,
          workshop: rowWorkshop || null,
          mold_name: r.mold_name || null,
          updated_at: now,
        });
      }

      const remarkParts = [
        r.color && `颜色:${r.color}`,
        r.color_powder && `色粉:${r.color_powder}`,
        r.material && `料:${r.material}`,
        r.row_note,
        header.note,
      ].filter(Boolean);

      const capacity = target_qty;
      const item = deriveSupplierUsd({
        id: nanoid(10),
        seq: null,
        created_at: now,
        updated_at: now,
        workshop: rowWorkshop || header.supplier || '',
        item_code: r.order_no || header.bill_no || '',
        mold: `${r.mold_code || ''} ${r.mold_name || ''}`.trim(),
        order_qty_pcs: r.total_sets ?? null,
        order_qty_shots: r.shots ?? null,
        target_qty,
        quoted_capacity: capacity,
        actual_capacity: capacity,
        quote_price_usd: null,
        supplier_price_rmb: r.unit_price ?? null,
        supplier_price_usd: null,
        supplier,
        pmc_follow: rowPmc,
        order_date: header.place_date || '',
        production_start: '',
        estimated_delivery: r.delivery_date || header.delivery_date || '',
        remark: remarkParts.join(' / '),
        status: 'open',
        source_bill_no: header.bill_no || '',
        source_customer: header.customer || '',
        source_production_no: r.production_no || '',
        source_mold_code: r.mold_code || '',
        net_outsource_output: null,
      });
      orderInsert.run(normalizeOrder(item));
      insertedIds.push(item.id);
    }
  });
  tx();

  const mappingsTotal = db.prepare('SELECT COUNT(*) c FROM outsource_mold_mappings').get().c;
  res.json({ inserted: insertedIds.length, inserted_ids: insertedIds, mappings_total: mappingsTotal });
});

// ---- Excel export of arbitrary rows (legacy plain endpoint) ----
router.post('/export-excel', (req, res) => {
  const { rows = [], filename = 'orders.xlsx', sheet_name = '订单' } = req.body || {};
  if (!Array.isArray(rows) || rows.length === 0) return res.status(400).json({ error: 'no_rows' });
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheet_name);
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
  res.send(buf);
});

// ---- Excel export (formatted) ----
async function exportOrdersXlsx(orders, res, filenamePrefix = '外发明细') {
  const wb = await buildOrdersWorkbook(orders);
  const buf = await wb.xlsx.writeBuffer();
  const filename = `${filenamePrefix}_${new Date().toISOString().slice(0, 10)}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
  res.send(Buffer.from(buf));
}

function sortByWorkshopThenAge(orders) {
  return [...orders].sort((a, b) => {
    const ra = workshopRank(a.workshop);
    const rb = workshopRank(b.workshop);
    if (ra !== rb) return ra - rb;
    return (a.created_at || '').localeCompare(b.created_at || '');
  });
}

router.get('/orders/export.xlsx', async (req, res) => {
  try {
    const orders = sortByWorkshopThenAge(ordersAll.all().map(enrich));
    await exportOrdersXlsx(orders, res, '外发明细');
  } catch (e) {
    console.error('export-all error:', e);
    res.status(500).json({ error: 'export_failed', message: e.message });
  }
});

router.post('/orders/export.xlsx', async (req, res) => {
  try {
    const { rows = [] } = req.body || {};
    if (!Array.isArray(rows) || rows.length === 0) return res.status(400).json({ error: 'no_rows' });
    await exportOrdersXlsx(rows, res, '外发明细_筛选');
  } catch (e) {
    console.error('export-filtered error:', e);
    res.status(500).json({ error: 'export_failed', message: e.message });
  }
});

module.exports = router;
