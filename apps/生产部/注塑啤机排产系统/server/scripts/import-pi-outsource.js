#!/usr/bin/env node
/**
 * 一次性导入脚本：把原 pi-outsource 系统的 JSON 数据迁到 paiji DB
 *
 * 用法：
 *   node scripts/import-pi-outsource.js              # 默认源目录
 *   node scripts/import-pi-outsource.js /custom/path # 自定义源目录
 *
 * 幂等：以 source_id (=pi-outsource 原 id) 去重，重复运行不会插重。
 * 失败：单条出错继续，最后汇总。
 */
const fs = require('fs');
const path = require('path');
const db = require('../db/connection');
const { initDatabase } = require('../db/init');

const SOURCE_DIR = process.argv[2] || path.resolve(__dirname, '..', '..', '..', '啤机外发系统', 'server', 'data');

function readJSON(file) {
  const full = path.join(SOURCE_DIR, file);
  if (!fs.existsSync(full)) {
    console.warn(`[warn] ${file} 不存在: ${full}`);
    return null;
  }
  return JSON.parse(fs.readFileSync(full, 'utf8'));
}

function importSuppliers() {
  const data = readJSON('suppliers.json');
  if (!Array.isArray(data)) return { skipped: true };

  const insert = db.prepare(`
    INSERT INTO suppliers (name, total_machines, running_rate, machines_for, data_json)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET
      total_machines = excluded.total_machines,
      running_rate   = excluded.running_rate,
      machines_for   = excluded.machines_for,
      data_json      = excluded.data_json,
      updated_at     = CURRENT_TIMESTAMP
  `);

  let imported = 0, errors = 0;
  const tx = db.transaction(() => {
    for (const s of data) {
      try {
        insert.run(
          s.name,
          s.total_machines || 0,
          s.running_rate || 0,
          s.machines_for_xx ? String(s.machines_for_xx) : null,
          JSON.stringify(s)
        );
        imported++;
      } catch (e) {
        console.error(`[suppliers] 导入 "${s.name}" 失败:`, e.message);
        errors++;
      }
    }
  });
  tx();
  return { total: data.length, imported, errors };
}

function importMoldMappings() {
  const data = readJSON('mold_mappings.json');
  if (!data || typeof data !== 'object') return { skipped: true };

  const upsert = db.prepare(`
    INSERT INTO supplier_mold_mappings (mold_code, mold_name, supplier, target_qty, workshop, updated_at)
    VALUES (?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
    ON CONFLICT(mold_code) DO UPDATE SET
      mold_name  = COALESCE(excluded.mold_name,  supplier_mold_mappings.mold_name),
      supplier   = COALESCE(excluded.supplier,   supplier_mold_mappings.supplier),
      target_qty = COALESCE(excluded.target_qty, supplier_mold_mappings.target_qty),
      workshop   = COALESCE(excluded.workshop,   supplier_mold_mappings.workshop),
      updated_at = CURRENT_TIMESTAMP
  `);

  let imported = 0, errors = 0;
  const entries = Object.entries(data);
  const tx = db.transaction(() => {
    for (const [moldCode, info] of entries) {
      try {
        upsert.run(
          moldCode,
          info.mold_name || null,
          info.supplier || null,
          info.target_qty || null,
          info.workshop || null,
          info.updated_at || null
        );
        imported++;
      } catch (e) {
        console.error(`[mold_mappings] 导入 "${moldCode}" 失败:`, e.message);
        errors++;
      }
    }
  });
  tx();
  return { total: entries.length, imported, errors };
}

function importOrders() {
  const data = readJSON('orders.json');
  if (!Array.isArray(data)) return { skipped: true };

  // 检查 source_id 是否已存在（幂等）
  const existsStmt = db.prepare('SELECT id FROM orders WHERE source_system = ? AND source_id = ?');

  const insertStmt = db.prepare(`
    INSERT INTO orders (
      product_code, mold_no, mold_name, color, color_powder_no, material_type,
      shot_weight, material_kg, sprue_pct, ratio_pct,
      quantity_needed, accumulated, cavity, cycle_time, order_no,
      is_three_plate, packing_qty, import_batch, source_file, status, order_notes, workshop,
      destination, supplier, pmc_follow, quote_price_usd, supplier_price_rmb, supplier_price_usd,
      capacity_per_day, order_date, production_start, estimated_delivery, actual_delivery,
      outsource_status, source_system, source_id
    ) VALUES (
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?
    )
  `);

  // mold 字段在 pi-outsource 是混合字符串，如 "MNHM-01M 家私+MINI电器A模具"
  // 拆分：第一个空格前 = mold_no，剩余 = mold_name
  function splitMold(mold) {
    if (!mold) return { mold_no: '', mold_name: '' };
    const idx = mold.indexOf(' ');
    if (idx < 0) return { mold_no: mold, mold_name: '' };
    return { mold_no: mold.slice(0, idx).trim(), mold_name: mold.slice(idx + 1).trim() };
  }

  let imported = 0, skipped = 0, errors = 0;
  const tx = db.transaction(() => {
    for (const o of data) {
      try {
        const existing = existsStmt.get('pi-outsource', o.id);
        if (existing) { skipped++; continue; }

        const { mold_no, mold_name } = splitMold(o.mold);

        insertStmt.run(
          o.item_code || '', mold_no, mold_name,
          '', '', '',              // color / color_powder_no / material_type 外发数据没这些
          0, 0, 0, 0,              // shot_weight / material_kg / sprue_pct / ratio_pct
          o.order_qty_pcs || 0,    // quantity_needed
          0, 1, 0,                 // accumulated / cavity / cycle_time
          o.seq || '',             // order_no（用 seq 占位）
          0, 0,                    // is_three_plate / packing_qty
          'pi-outsource-import',   // import_batch
          'pi-outsource',          // source_file
          o.status || 'pending',   // status（保留原 status）
          o.remark || '',          // order_notes
          null,                    // workshop（外发不占 A/B/C 视图）
          'outsource',             // destination
          o.supplier || null,
          o.pmc_follow || null,
          o.quote_price_usd ?? null,
          o.supplier_price_rmb ?? null,
          o.supplier_price_usd ?? null,
          o.actual_capacity || o.quoted_capacity || null,
          o.order_date || null,
          o.production_start || null,
          o.estimated_delivery || null,
          null,                    // actual_delivery（pi-outsource 没存这字段）
          o.status || null,        // outsource_status = 原 status
          'pi-outsource',          // source_system
          o.id                     // source_id
        );
        imported++;
      } catch (e) {
        console.error(`[orders] 导入 "${o.id}" (${o.item_code}) 失败:`, e.message);
        errors++;
      }
    }
  });
  tx();
  return { total: data.length, imported, skipped, errors };
}

function main() {
  console.log('=== pi-outsource → paiji 数据迁移 ===');
  console.log('源目录:', SOURCE_DIR);
  console.log('');

  console.log('[1/3] 确保 schema 是最新的…');
  initDatabase();
  console.log('');

  console.log('[2/3] 导入 suppliers + mold_mappings…');
  const sup = importSuppliers();
  const mm  = importMoldMappings();
  console.log('  suppliers:', JSON.stringify(sup));
  console.log('  mold_mappings:', JSON.stringify(mm));
  console.log('');

  console.log('[3/3] 导入 orders（外发）…');
  const ord = importOrders();
  console.log('  orders:', JSON.stringify(ord));
  console.log('');

  console.log('=== 完成 ===');
  console.log('提示：再次运行此脚本不会重复插入（按 source_system + source_id 去重）');
}

if (require.main === module) main();

module.exports = { importSuppliers, importMoldMappings, importOrders };
