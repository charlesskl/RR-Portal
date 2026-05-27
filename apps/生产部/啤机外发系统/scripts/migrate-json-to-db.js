// One-time migration: read JSON data files and insert into SQLite.
// Safe to re-run — uses INSERT OR REPLACE so it always converges to current JSON state.
const fs = require('fs');
const path = require('path');
const db = require('../server/db/connection');
const { init } = require('../server/db/init');

const DATA_DIR = path.join(__dirname, '..', 'server', 'data');

function readJson(name) {
  const p = path.join(DATA_DIR, name);
  if (!fs.existsSync(p)) return null;
  const txt = fs.readFileSync(p, 'utf8');
  return JSON.parse(txt || (name.includes('mold_mapping') ? '{}' : '[]'));
}

init();

// ============== orders ==============
const orders = readJson('orders.json') || [];
const insertOrder = db.prepare(`
  INSERT OR REPLACE INTO orders (
    id, seq, workshop, item_code, mold,
    order_qty_pcs, order_qty_shots, target_qty, quoted_capacity, actual_capacity,
    quote_price_usd, supplier_price_rmb, supplier_price_usd,
    supplier, pmc_follow,
    order_date, production_start, estimated_delivery,
    remark, status, net_outsource_output,
    source_bill_no, source_customer, source_production_no, source_mold_code,
    created_at, updated_at
  ) VALUES (
    @id, @seq, @workshop, @item_code, @mold,
    @order_qty_pcs, @order_qty_shots, @target_qty, @quoted_capacity, @actual_capacity,
    @quote_price_usd, @supplier_price_rmb, @supplier_price_usd,
    @supplier, @pmc_follow,
    @order_date, @production_start, @estimated_delivery,
    @remark, @status, @net_outsource_output,
    @source_bill_no, @source_customer, @source_production_no, @source_mold_code,
    @created_at, @updated_at
  )
`);
const insertOrders = db.transaction((items) => { for (const o of items) insertOrder.run(normalizeOrder(o)); });

function normalizeOrder(o) {
  return {
    id: o.id,
    seq: o.seq ?? null,
    workshop: o.workshop ?? '',
    item_code: o.item_code ?? '',
    mold: o.mold ?? '',
    order_qty_pcs: o.order_qty_pcs ?? null,
    order_qty_shots: o.order_qty_shots ?? null,
    target_qty: o.target_qty ?? null,
    quoted_capacity: o.quoted_capacity ?? null,
    actual_capacity: o.actual_capacity ?? null,
    quote_price_usd: o.quote_price_usd ?? null,
    supplier_price_rmb: o.supplier_price_rmb ?? null,
    supplier_price_usd: o.supplier_price_usd ?? null,
    supplier: o.supplier ?? '',
    pmc_follow: o.pmc_follow ?? '',
    order_date: o.order_date ?? '',
    production_start: o.production_start ?? '',
    estimated_delivery: o.estimated_delivery ?? '',
    remark: o.remark ?? '',
    status: o.status ?? 'open',
    net_outsource_output: o.net_outsource_output ?? null,
    source_bill_no: o.source_bill_no ?? '',
    source_customer: o.source_customer ?? '',
    source_production_no: o.source_production_no ?? '',
    source_mold_code: o.source_mold_code ?? '',
    created_at: o.created_at || new Date().toISOString(),
    updated_at: o.updated_at || new Date().toISOString(),
  };
}
insertOrders(orders);
console.log(`✓ orders   → ${orders.length} 条`);

// ============== suppliers ==============
const suppliers = readJson('suppliers.json') || [];
const insertSupplier = db.prepare(`
  INSERT OR REPLACE INTO suppliers (id, seq, name, total_machines, machines_for_xx, xx_ratio, actual_running, running_rate, contact, address, mold_count, remark)
  VALUES (@id, @seq, @name, @total_machines, @machines_for_xx, @xx_ratio, @actual_running, @running_rate, @contact, @address, @mold_count, @remark)
`);
db.transaction((items) => {
  for (const s of items) insertSupplier.run({
    id: s.id, seq: s.seq ?? null, name: s.name ?? '',
    total_machines: s.total_machines ?? null,
    machines_for_xx: s.machines_for_xx ?? null,
    xx_ratio: s.xx_ratio ?? null,
    actual_running: s.actual_running ?? null,
    running_rate: s.running_rate ?? null,
    contact: s.contact ?? '',
    address: s.address ?? '',
    mold_count: s.mold_count ?? null,
    remark: s.remark ?? '',
  });
})(suppliers);
console.log(`✓ suppliers → ${suppliers.length} 条`);

// ============== mold_mappings ==============
const mm = readJson('mold_mappings.json') || {};
const insertMapping = db.prepare(`
  INSERT OR REPLACE INTO mold_mappings (mold_code, supplier, target_qty, workshop, mold_name, updated_at)
  VALUES (@mold_code, @supplier, @target_qty, @workshop, @mold_name, @updated_at)
`);
let mmCount = 0;
db.transaction(() => {
  for (const [code, v] of Object.entries(mm)) {
    insertMapping.run({
      mold_code: code,
      supplier: v.supplier ?? '',
      target_qty: v.target_qty ?? null,
      workshop: v.workshop ?? '',
      mold_name: v.mold_name ?? '',
      updated_at: v.updated_at || new Date().toISOString(),
    });
    mmCount++;
  }
})();
console.log(`✓ mold_mappings → ${mmCount} 条`);

// ============== pc_orders ==============
const pc = readJson('pc_orders.json') || [];
const insertPc = db.prepare(`
  INSERT OR REPLACE INTO pc_orders (id, seq, factory, item_code, mold, mold_sets, remark)
  VALUES (@id, @seq, @factory, @item_code, @mold, @mold_sets, @remark)
`);
db.transaction((items) => {
  for (const p of items) insertPc.run({
    id: p.id, seq: p.seq ?? null,
    factory: p.factory ?? '', item_code: p.item_code ?? '',
    mold: p.mold ?? '', mold_sets: p.mold_sets ?? '', remark: p.remark ?? '',
  });
})(pc);
console.log(`✓ pc_orders → ${pc.length} 条`);

// Summary
const counts = {
  orders: db.prepare('SELECT COUNT(*) c FROM orders').get().c,
  suppliers: db.prepare('SELECT COUNT(*) c FROM suppliers').get().c,
  mold_mappings: db.prepare('SELECT COUNT(*) c FROM mold_mappings').get().c,
  pc_orders: db.prepare('SELECT COUNT(*) c FROM pc_orders').get().c,
};
console.log('\n=== DB row counts after migration ===');
for (const [k, v] of Object.entries(counts)) console.log(' ', k, ':', v);
const sz = fs.statSync(path.join(DATA_DIR, 'pi-outsource.db')).size;
console.log('\nDB file size:', (sz / 1024).toFixed(1), 'KB');
