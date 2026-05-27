require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { nanoid } = require('nanoid');
const multer = require('multer');
const XLSX = require('xlsx');
const { parsePdfBuffer } = require('./pdf-parser');
const { aiParsePdfBuffer } = require('./ai-parser');
const { buildOrdersWorkbook } = require('./excel-exporter');
const { workshopFromPmc, workshopRank, WORKSHOP_ORDER } = require('./pmc-workshop-map');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const PORT = process.env.PORT || 3010;
const DATA_DIR = process.env.DATA_PATH || path.join(__dirname, 'data');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
const SUPPLIERS_FILE = path.join(DATA_DIR, 'suppliers.json');
const PC_FILE = path.join(DATA_DIR, 'pc_orders.json');
const MOLD_MAP_FILE = path.join(DATA_DIR, 'mold_mappings.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
for (const f of [ORDERS_FILE, SUPPLIERS_FILE, PC_FILE]) {
  if (!fs.existsSync(f)) fs.writeFileSync(f, '[]', 'utf8');
}
if (!fs.existsSync(MOLD_MAP_FILE)) fs.writeFileSync(MOLD_MAP_FILE, '{}', 'utf8');

const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8') || '[]');
const writeJson = (f, data) => fs.writeFileSync(f, JSON.stringify(data, null, 2), 'utf8');
const readObj = (f) => JSON.parse(fs.readFileSync(f, 'utf8') || '{}');

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
  const shots = Number(order.order_qty_shots) || 0;
  const cap = Number(order.actual_capacity) || 0;
  const quoteUsd = Number(order.quote_price_usd) || 0;
  const supRmb = Number(order.supplier_price_rmb) || 0;
  const supUsd = Number(order.supplier_price_usd) || 0;
  const estimated_days = cap > 0 ? round2(shots / cap) : null;
  const in_house_output = round2(shots * quoteUsd);
  const outsource_output = round2(shots * supUsd);
  const supplier_tax_output = round2(shots * supUsd * 0.13);
  // 扣税后外发产值: PDF-imported orders leave it blank for manual entry;
  // Excel-seed / manually-created orders auto-compute as before.
  const isPdfImport = !!order.source_bill_no;
  const net_outsource_output = isPdfImport
    ? (order.net_outsource_output ?? null)
    : round2((shots * supUsd) - (shots * supUsd * 0.13));
  return { ...order, estimated_days, in_house_output, outsource_output, supplier_tax_output, net_outsource_output };
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.get('/api/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

// ---- Orders ----
app.get('/api/orders', (req, res) => {
  const list = readJson(ORDERS_FILE).map(enrich);
  res.json(list);
});

app.post('/api/orders', (req, res) => {
  const list = readJson(ORDERS_FILE);
  const now = new Date().toISOString();
  const item = deriveSupplierUsd({ id: nanoid(10), created_at: now, updated_at: now, ...req.body });
  list.push(item);
  writeJson(ORDERS_FILE, list);
  res.json(enrich(item));
});

app.put('/api/orders/:id', (req, res) => {
  const list = readJson(ORDERS_FILE);
  const idx = list.findIndex((x) => x.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'not_found' });
  list[idx] = deriveSupplierUsd({ ...list[idx], ...req.body, id: list[idx].id, updated_at: new Date().toISOString() });
  writeJson(ORDERS_FILE, list);
  res.json(enrich(list[idx]));
});

app.delete('/api/orders/:id', (req, res) => {
  const list = readJson(ORDERS_FILE);
  const next = list.filter((x) => x.id !== req.params.id);
  if (next.length === list.length) return res.status(404).json({ error: 'not_found' });
  writeJson(ORDERS_FILE, next);
  res.json({ ok: true });
});

// ---- Bulk-rename a supplier across orders, mappings, and the suppliers list ----
// Body: { from: "鸿徽", to: "鸿薇" }
// from = "" or "(空)" means: assign currently-empty supplier rows to the new name.
app.post('/api/suppliers/rename', (req, res) => {
  const { from = '', to = '' } = req.body || {};
  const fromName = from === '(空)' ? '' : from;
  const toName = (to || '').trim();
  if (toName === '') return res.status(400).json({ error: 'empty_to' });
  if (fromName === toName) return res.json({ orders_updated: 0, mappings_updated: 0, suppliers_updated: 0 });

  // Orders
  const orders = readJson(ORDERS_FILE);
  let ordersUpdated = 0;
  const now = new Date().toISOString();
  for (const o of orders) {
    if ((o.supplier || '') === fromName) {
      o.supplier = toName;
      o.updated_at = now;
      ordersUpdated += 1;
    }
  }
  writeJson(ORDERS_FILE, orders);

  // Mold mappings
  const mappings = readObj(MOLD_MAP_FILE);
  let mappingsUpdated = 0;
  for (const m of Object.values(mappings)) {
    if ((m.supplier || '') === fromName) {
      m.supplier = toName;
      m.updated_at = now;
      mappingsUpdated += 1;
    }
  }
  writeJson(MOLD_MAP_FILE, mappings);

  // Suppliers list
  const suppliers = readJson(SUPPLIERS_FILE);
  let suppliersUpdated = 0;
  if (fromName) {
    for (const s of suppliers) {
      if (s.name === fromName) {
        s.name = toName;
        suppliersUpdated += 1;
      }
    }
    writeJson(SUPPLIERS_FILE, suppliers);
  }

  res.json({ orders_updated: ordersUpdated, mappings_updated: mappingsUpdated, suppliers_updated: suppliersUpdated });
});

// ---- Suppliers (加工厂) ----
app.get('/api/suppliers', (req, res) => res.json(readJson(SUPPLIERS_FILE)));
app.post('/api/suppliers', (req, res) => {
  const list = readJson(SUPPLIERS_FILE);
  const item = { id: nanoid(10), ...req.body };
  list.push(item);
  writeJson(SUPPLIERS_FILE, list);
  res.json(item);
});
app.put('/api/suppliers/:id', (req, res) => {
  const list = readJson(SUPPLIERS_FILE);
  const idx = list.findIndex((x) => x.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'not_found' });
  list[idx] = { ...list[idx], ...req.body, id: list[idx].id };
  writeJson(SUPPLIERS_FILE, list);
  res.json(list[idx]);
});
app.delete('/api/suppliers/:id', (req, res) => {
  const list = readJson(SUPPLIERS_FILE);
  const next = list.filter((x) => x.id !== req.params.id);
  if (next.length === list.length) return res.status(404).json({ error: 'not_found' });
  writeJson(SUPPLIERS_FILE, next);
  res.json({ ok: true });
});

// ---- PC Orders ----
app.get('/api/pc-orders', (req, res) => res.json(readJson(PC_FILE)));
app.post('/api/pc-orders', (req, res) => {
  const list = readJson(PC_FILE);
  const item = { id: nanoid(10), ...req.body };
  list.push(item);
  writeJson(PC_FILE, list);
  res.json(item);
});
app.put('/api/pc-orders/:id', (req, res) => {
  const list = readJson(PC_FILE);
  const idx = list.findIndex((x) => x.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'not_found' });
  list[idx] = { ...list[idx], ...req.body, id: list[idx].id };
  writeJson(PC_FILE, list);
  res.json(list[idx]);
});
app.delete('/api/pc-orders/:id', (req, res) => {
  const list = readJson(PC_FILE);
  const next = list.filter((x) => x.id !== req.params.id);
  if (next.length === list.length) return res.status(404).json({ error: 'not_found' });
  writeJson(PC_FILE, next);
  res.json({ ok: true });
});

// ---- Stats summary ----
app.get('/api/stats/summary', (req, res) => {
  const orders = readJson(ORDERS_FILE).map(enrich);
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
app.post('/api/parse-pdf', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no_file' });
  try {
    const parsed = await parsePdfBuffer(req.file.buffer);
    res.json({
      filename: req.file.originalname,
      template: parsed.template,
      header: parsed.header,
      rows: parsed.rows,
    });
  } catch (e) {
    console.error('parse-pdf error:', e);
    res.status(500).json({ error: 'parse_failed', message: e.message });
  }
});

// AI 智能解析 — 调用阿里百炼（Qwen），用于规则解析失败/未知模板
app.post('/api/parse-pdf-ai', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no_file' });
  try {
    const parsed = await aiParsePdfBuffer(req.file.buffer);
    res.json({
      filename: req.file.originalname,
      template: parsed.template,
      header: parsed.header,
      rows: parsed.rows,
      model_used: parsed.model_used,
      usage: parsed.usage,
    });
  } catch (e) {
    console.error('parse-pdf-ai error:', e);
    res.status(500).json({ error: 'ai_parse_failed', message: e.message });
  }
});

// ---- Workshop options (autocomplete source) ----
app.get('/api/workshops', (req, res) => {
  const orders = readJson(ORDERS_FILE);
  const mappings = readObj(MOLD_MAP_FILE);
  const set = new Set(Object.keys(WORKSHOP_ORDER));
  for (const o of orders) if (o.workshop) set.add(o.workshop);
  for (const m of Object.values(mappings)) if (m.workshop) set.add(m.workshop);
  res.json([...set].sort((a, b) => workshopRank(a) - workshopRank(b)));
});

// Workshop display order (used by frontend sort)
app.get('/api/workshop-order', (req, res) => res.json(WORKSHOP_ORDER));

// All known PMC names — used by PDF import to populate the PMC column
const { PMC_TO_WORKSHOP } = require('./pmc-workshop-map');
app.get('/api/pmcs', (req, res) => {
  const orders = readJson(ORDERS_FILE);
  const set = new Set(Object.keys(PMC_TO_WORKSHOP));
  for (const o of orders) if (o.pmc_follow) set.add(o.pmc_follow);
  // Return as [{ name, workshop }] so frontend can group/style
  const list = [...set].map((name) => ({ name, workshop: PMC_TO_WORKSHOP[name] || '' }));
  list.sort((a, b) => (workshopRank(a.workshop) - workshopRank(b.workshop)) || a.name.localeCompare(b.name, 'zh'));
  res.json(list);
});

// ---- Mold mappings (mold_code → { supplier, target_qty, workshop }) ----
// Used by PDF import: filling a mold's supplier/target once makes the system
// remember it for next time.
app.get('/api/mold-mappings', (req, res) => res.json(readObj(MOLD_MAP_FILE)));

app.post('/api/mold-mappings', (req, res) => {
  const { mappings = {} } = req.body || {};
  if (typeof mappings !== 'object') return res.status(400).json({ error: 'bad_body' });
  const current = readObj(MOLD_MAP_FILE);
  let updated = 0;
  for (const [k, v] of Object.entries(mappings)) {
    if (!k || !v) continue;
    const prev = current[k] || {};
    const next = { ...prev };
    if (v.supplier !== undefined && v.supplier !== '') next.supplier = v.supplier;
    if (v.target_qty !== undefined && v.target_qty !== null && v.target_qty !== '') {
      next.target_qty = Number(v.target_qty);
    }
    if (v.mold_name !== undefined && v.mold_name !== '') next.mold_name = v.mold_name;
    if (v.workshop !== undefined) next.workshop = v.workshop;
    next.updated_at = new Date().toISOString();
    if (JSON.stringify(next) !== JSON.stringify(prev)) {
      current[k] = next;
      updated += 1;
    }
  }
  writeJson(MOLD_MAP_FILE, current);
  res.json({ updated, total: Object.keys(current).length });
});

// Update / reassign a single mold's mapping (used by the mold-factory page)
// Body: { supplier?, target_qty?, mold_name? }
app.put('/api/mold-mappings/:mold_code', (req, res) => {
  const key = req.params.mold_code;
  if (!key) return res.status(400).json({ error: 'bad_key' });
  const current = readObj(MOLD_MAP_FILE);
  const prev = current[key] || {};
  const next = { ...prev };
  const { supplier, target_qty, mold_name, workshop } = req.body || {};
  if (supplier !== undefined) next.supplier = supplier;
  if (target_qty !== undefined) {
    next.target_qty = (target_qty === null || target_qty === '') ? null : Number(target_qty);
  }
  if (mold_name !== undefined) next.mold_name = mold_name;
  if (workshop !== undefined) next.workshop = workshop;
  next.updated_at = new Date().toISOString();
  current[key] = next;
  writeJson(MOLD_MAP_FILE, current);
  res.json(next);
});

app.delete('/api/mold-mappings/:mold_code', (req, res) => {
  const key = req.params.mold_code;
  const current = readObj(MOLD_MAP_FILE);
  if (!(key in current)) return res.status(404).json({ error: 'not_found' });
  delete current[key];
  writeJson(MOLD_MAP_FILE, current);
  res.json({ ok: true });
});

// Aggregated view: which molds at which factory, with order stats
app.get('/api/mold-factory-map', (req, res) => {
  const mappings = readObj(MOLD_MAP_FILE);
  const orders = readJson(ORDERS_FILE);

  // Build order index by source_mold_code (preferred) or by extracting mold_code from "mold" field
  const orderStats = {};   // mold_code → { count, latest_date, total_shots, latest_supplier }
  const namesFromOrders = {}; // mold_code → first non-empty 工模名称 we can derive
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
      // mold is "<code> <name>" — strip the code prefix
      const after = o.mold.replace(code, '').trim();
      if (after) namesFromOrders[code] = after;
    }
  }

  // Merge mappings + orderStats into a unified list
  const allCodes = new Set([...Object.keys(mappings), ...Object.keys(orderStats)]);
  const grouped = {};
  for (const code of allCodes) {
    const m = mappings[code] || {};
    const s = orderStats[code] || { count: 0, latest_date: '', total_shots: 0, latest_supplier: '' };
    // If no mapping supplier, fall back to latest order supplier
    const supplier = m.supplier || s.latest_supplier || '(未分配)';
    const mold_name = m.mold_name || namesFromOrders[code] || '';
    const row = {
      mold_code: code,
      mold_name,
      supplier,
      target_qty: m.target_qty ?? null,
      mapped: !!m.supplier,
      order_count: s.count,
      total_shots: s.total_shots,
      latest_date: s.latest_date,
      updated_at: m.updated_at || '',
    };
    (grouped[supplier] = grouped[supplier] || []).push(row);
  }
  // Sort molds within each supplier by mold_code
  for (const arr of Object.values(grouped)) {
    arr.sort((a, b) => a.mold_code.localeCompare(b.mold_code));
  }
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
  // mold field is usually "<mold_code> <name>"; pick the first whitespace-separated token
  const t = String(moldStr).trim().split(/\s+/)[0];
  return t || '';
}

// ---- Import parsed PDF rows into orders ----
// Body: { header, rows: [{...row, supplier, target_qty}], workshop?: string, default_supplier?: string }
app.post('/api/import-pdf-rows', (req, res) => {
  const {
    header = {},
    rows = [],
    workshop: defaultWorkshop = '',
    default_supplier = '',
  } = req.body || {};
  if (!Array.isArray(rows) || rows.length === 0) return res.status(400).json({ error: 'no_rows' });

  const list = readJson(ORDERS_FILE);
  const moldMap = readObj(MOLD_MAP_FILE);
  const now = new Date().toISOString();

  const created = rows.map((r) => {
    const supplier = r.supplier || default_supplier || '';
    const target_qty = r.target_qty ?? null;
    const rowPmc = r.pmc_follow || header.placer || '';
    // Derive workshop from per-row PMC first, fall back to header PMC
    const rowWorkshop = r.workshop || defaultWorkshop || workshopFromPmc(rowPmc) || '';
    // Persist mapping when any of supplier/target/name/workshop is meaningful
    if (r.mold_code && (supplier || target_qty !== null || r.mold_name || rowWorkshop)) {
      const prev = moldMap[r.mold_code] || {};
      const next = { ...prev };
      if (supplier) next.supplier = supplier;
      if (target_qty !== null) next.target_qty = Number(target_qty);
      if (r.mold_name && !prev.mold_name) next.mold_name = r.mold_name;
      if (rowWorkshop) next.workshop = rowWorkshop;
      next.updated_at = now;
      moldMap[r.mold_code] = next;
    }
    const remarkParts = [
      r.color && `颜色:${r.color}`,
      r.color_powder && `色粉:${r.color_powder}`,
      r.material && `料:${r.material}`,
      r.row_note,
      header.note,
    ].filter(Boolean);
    // 目标数 = 报价产能 = 实际产能 (same number, three fields)
    const capacity = target_qty;
    const item = deriveSupplierUsd({
      id: nanoid(10),
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
      supplier_price_usd: null,   // auto-derived in deriveSupplierUsd
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
      net_outsource_output: null,   // PDF imports leave 扣税后产值 blank for manual entry
    });
    list.push(item);
    return item;
  });
  writeJson(ORDERS_FILE, list);
  writeJson(MOLD_MAP_FILE, moldMap);
  res.json({
    inserted: created.length,
    inserted_ids: created.map((x) => x.id),
    mappings_total: Object.keys(moldMap).length,
  });
});

// ---- Excel export of arbitrary rows ----
// Body: { rows: [...], filename?: string, sheet_name?: string }
app.post('/api/export-excel', (req, res) => {
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

// ---- Excel export (formatted to match 「外发模具计划」 layout) ----
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

app.get('/api/orders/export.xlsx', async (req, res) => {
  try {
    const orders = sortByWorkshopThenAge(readJson(ORDERS_FILE).map(enrich));
    await exportOrdersXlsx(orders, res, '外发明细');
  } catch (e) {
    console.error('export-all error:', e);
    res.status(500).json({ error: 'export_failed', message: e.message });
  }
});

// POST { rows: [...orders] } — export a specific subset (used by 'export filtered')
app.post('/api/orders/export.xlsx', async (req, res) => {
  try {
    const { rows = [] } = req.body || {};
    if (!Array.isArray(rows) || rows.length === 0) return res.status(400).json({ error: 'no_rows' });
    await exportOrdersXlsx(rows, res, '外发明细_筛选');
  } catch (e) {
    console.error('export-filtered error:', e);
    res.status(500).json({ error: 'export_failed', message: e.message });
  }
});

// ---- Serve client static (production) ----
const clientDist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

const os = require('os');
function getLanIps() {
  const ips = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family === 'IPv4' && !ni.internal) ips.push(ni.address);
    }
  }
  return ips;
}
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[啤机外发] server listening on:`);
  console.log(`  - http://localhost:${PORT}`);
  for (const ip of getLanIps()) console.log(`  - http://${ip}:${PORT}  (LAN)`);
  console.log(`[啤机外发] data dir: ${DATA_DIR}`);
});
