const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { getDb } = require('../services/db');
const { parseWorkbook } = require('../services/excel-parser');

const upload = multer({ storage: multer.memoryStorage() });

// POST /api/import — upload and parse 本厂报价明细 Excel
router.post('/', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded. Use field name "file".' });
  }

  // Write to temp file so ExcelJS can read it
  const tmpPath = path.join(os.tmpdir(), `quotation_${Date.now()}.xlsx`);
  fs.writeFileSync(tmpPath, req.file.buffer);

  try {
    const data = await parseWorkbook(tmpPath);

    const db = getDb();
    const now = new Date().toISOString();

    // ── Create or update Product ───────────────────────────────────────────
    const productNo = data.product.product_no || req.body.item_no || 'UNKNOWN';
    const itemDesc = req.body.item_desc || null;
    const vendor = req.body.vendor || null;

    let product = db.prepare('SELECT * FROM Product WHERE item_no = ?').get(productNo);
    if (!product) {
      const r = db.prepare(
        'INSERT INTO Product (item_no, item_desc, vendor, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
      ).run(productNo, itemDesc, vendor, now, now);
      product = { id: r.lastInsertRowid, item_no: productNo };
    }

    // ── Create QuoteVersion ────────────────────────────────────────────────
    const versionName = data.product.date_code || data.sheetName;
    const vr = db.prepare(
      `INSERT INTO QuoteVersion (product_id, version_name, source_sheet, date_code, quote_date, status, format_type, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?)`
    ).run(product.id, versionName, data.sheetName, data.product.date_code, data.product.date_code, data.format_type || 'injection', now, now);
    const versionId = vr.lastInsertRowid;

    // ── Insert all data in a transaction ──────────────────────────────────
    const insertAll = db.transaction(() => {

      // QuoteParams
      const p = data.params || {};
      db.prepare(
        `INSERT INTO QuoteParams (version_id, hkd_rmb_quote, hkd_rmb_check, rmb_hkd, hkd_usd, labor_hkd, box_price_hkd, markup_body, markup_packaging)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(versionId, p.hkd_rmb_quote, p.hkd_rmb_check, p.rmb_hkd, p.hkd_usd, p.labor_hkd, p.box_price_hkd,
        p.markup_body ?? 0.18, p.markup_packaging ?? 0.12);

      // MaterialPrice
      const insertMat = db.prepare(
        'INSERT INTO MaterialPrice (version_id, material_type, price_hkd_per_lb, price_hkd_per_g, price_rmb_per_g) VALUES (?, ?, ?, ?, ?)'
      );
      for (const m of (data.materialPrices || [])) {
        insertMat.run(versionId, m.material_type, m.price_hkd_per_lb, m.price_hkd_per_g, m.price_rmb_per_g);
      }

      // MachinePrice
      const insertMach = db.prepare(
        'INSERT INTO MachinePrice (version_id, machine_type, price_hkd, price_rmb) VALUES (?, ?, ?, ?)'
      );
      for (const m of (data.machinePrices || [])) {
        insertMach.run(versionId, m.machine_type, m.price_hkd, m.price_rmb);
      }

      // MoldPart
      const insertMold = db.prepare(
        `INSERT INTO MoldPart (version_id, part_no, description, material, weight_g, unit_price_hkd_g,
         machine_type, cavity_count, sets_per_toy, target_qty, molding_labor, material_cost_hkd,
         mold_cost_rmb, remark, is_old_mold, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const m of (data.moldParts || [])) {
        insertMold.run(
          versionId, m.part_no, m.description, m.material, m.weight_g, m.unit_price_hkd_g,
          m.machine_type, m.cavity_count, m.sets_per_toy, m.target_qty, m.molding_labor,
          m.material_cost_hkd, m.mold_cost_rmb, m.remark, m.is_old_mold, m.sort_order
        );
      }

      // HardwareItem
      const insertHw = db.prepare(
        `INSERT INTO HardwareItem (version_id, name, quantity, old_price, new_price, difference, tax_type, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (let i = 0; i < (data.hardwareItems || []).length; i++) {
        const h = data.hardwareItems[i];
        insertHw.run(versionId, h.name, h.quantity, h.old_price, h.new_price, h.difference, h.tax_type, i);
      }

      // PackagingItem
      const insertPkg = db.prepare(
        `INSERT INTO PackagingItem (version_id, name, quantity, old_price, new_price, difference, tax_type, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (let i = 0; i < (data.packagingItems || []).length; i++) {
        const pk = data.packagingItems[i];
        insertPkg.run(versionId, pk.name, pk.quantity, pk.old_price, pk.new_price, pk.difference, pk.tax_type, i);
      }

      // ElectronicItem
      if (data.electronicItems && data.electronicItems.length > 0) {
        const insertEl = db.prepare(
          `INSERT INTO ElectronicItem (version_id, part_name, spec, quantity, unit_price_usd, total_usd, remark, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        );
        for (const e of data.electronicItems) {
          insertEl.run(versionId, e.part_name, e.spec, e.quantity, e.unit_price_usd, e.total_usd, e.remark, e.sort_order);
        }
      }

      // ElectronicSummary
      if (data.electronicSummary) {
        const es = data.electronicSummary;
        db.prepare(
          `INSERT INTO ElectronicSummary (version_id, parts_cost, bonding_cost, smt_cost, labor_cost, test_cost,
           packaging_transport, total_cost, profit_margin, final_price_usd, pcb_mold_cost_usd)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          versionId, es.parts_cost, es.bonding_cost, es.smt_cost, es.labor_cost, es.test_cost,
          es.packaging_transport, es.total_cost, es.profit_margin, es.final_price_usd, es.pcb_mold_cost_usd
        );
      }

      // PaintingDetail
      if (data.paintingDetail) {
        const pd = data.paintingDetail;
        db.prepare(
          `INSERT INTO PaintingDetail (version_id, labor_cost_hkd, paint_cost_hkd, clamp_count, print_count,
           wipe_count, edge_count, spray_count, total_operations, quoted_price_hkd)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          versionId, pd.labor_cost_hkd, pd.paint_cost_hkd, pd.clamp_count, pd.print_count,
          pd.wipe_count, pd.edge_count, pd.spray_count, pd.total_operations, pd.quoted_price_hkd
        );
      }

      // TransportConfig
      if (data.transportConfig) {
        const tc = data.transportConfig;
        db.prepare(
          `INSERT INTO TransportConfig (version_id, cuft_per_box, pcs_per_box, truck_10t_cuft, truck_5t_cuft,
           container_40_cuft, container_20_cuft, hk_40_cost, hk_20_cost, yt_40_cost, yt_20_cost,
           hk_10t_cost, yt_10t_cost, hk_5t_cost, yt_5t_cost, transport_pct, handling_pct)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          versionId, tc.cuft_per_box, tc.pcs_per_box, tc.truck_10t_cuft, tc.truck_5t_cuft,
          tc.container_40_cuft, tc.container_20_cuft, tc.hk_40_cost, tc.hk_20_cost,
          tc.yt_40_cost, tc.yt_20_cost, tc.hk_10t_cost, tc.yt_10t_cost,
          tc.hk_5t_cost, tc.yt_5t_cost, tc.transport_pct, tc.handling_pct
        );
      }

      // MoldCost
      if (data.moldCost) {
        const mc = data.moldCost;
        db.prepare(
          `INSERT INTO MoldCost (version_id, mold_cost_rmb, hardware_mold_cost_rmb, paint_mold_cost_rmb,
           total_mold_rmb, total_mold_usd, customer_subsidy_usd, amortization_qty,
           amortization_rmb, amortization_usd, customer_quote_usd)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          versionId, mc.mold_cost_rmb, mc.hardware_mold_cost_rmb, mc.paint_mold_cost_rmb,
          mc.total_mold_rmb, mc.total_mold_usd, mc.customer_subsidy_usd, mc.amortization_qty,
          mc.amortization_rmb, mc.amortization_usd, mc.customer_quote_usd
        );
      }

      // RawMaterial — derive from moldParts (material + unit_price_hkd_g)
      {
        // Group by material: sum weight, take price from moldPart's unit_price_hkd_g
        const matMap = new Map(); // material -> { weight, pricePerG }
        for (const mp of (data.moldParts || [])) {
          if (!mp.material) continue;
          const key = mp.material.trim();
          if (!key) continue;
          const weight = parseFloat(mp.weight_g) || 0;
          const existing = matMap.get(key);
          if (existing) {
            existing.weight += weight;
          } else {
            matMap.set(key, { weight, pricePerG: mp.unit_price_hkd_g });
          }
        }
        const insertRaw = db.prepare(
          `INSERT INTO RawMaterial (version_id, category, material_name, spec, weight_g, unit_price_per_kg, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        );
        let sortIdx = 0;
        for (const [matName, { weight, pricePerG }] of matMap) {
          const pricePerKg = pricePerG ? pricePerG * 1000 : null;
          insertRaw.run(versionId, 'plastic', matName, null, weight, pricePerKg, sortIdx++);
        }

        // Fabric from sewingDetails: rows with both fabric_name and position are fabric cuts
        const fabricMap = new Map();
        for (const s of (data.sewingDetails || [])) {
          if (!s.fabric_name || !s.position) continue;
          const key = s.fabric_name.trim();
          const existing = fabricMap.get(key);
          if (existing) {
            existing.usage += (s.usage_amount || 0);
          } else {
            fabricMap.set(key, { usage: s.usage_amount || 0, price: s.material_price_rmb });
          }
        }
        for (const [fabricName, { usage, price }] of fabricMap) {
          insertRaw.run(versionId, 'fabric', fabricName, null, usage, price, sortIdx++);
        }
      }

      // RotocastItem (plush format)
      if (data.rotocastItems && data.rotocastItems.length > 0) {
        const insertRoto = db.prepare(
          `INSERT INTO RotocastItem (version_id, mold_no, name, output_qty, usage_pcs, unit_price_hkd, total_hkd, remark, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        for (const r of data.rotocastItems) {
          insertRoto.run(versionId, r.mold_no, r.name, r.output_qty, r.usage_pcs, r.unit_price_hkd, r.total_hkd, r.remark, r.sort_order);
        }
      }

      // SewingDetail (plush format)
      if (data.sewingDetails && data.sewingDetails.length > 0) {
        const insertSew = db.prepare(
          `INSERT INTO SewingDetail (version_id, product_name, fabric_name, position, cut_pieces, usage_amount, material_price_rmb, price_rmb, markup_point, total_price_rmb, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        for (const s of data.sewingDetails) {
          insertSew.run(versionId, s.product_name, s.fabric_name, s.position, s.cut_pieces, s.usage_amount, s.material_price_rmb, s.price_rmb, s.markup_point, s.total_price_rmb, s.sort_order);
        }
      }

      // ProductDimension
      if (data.productDimension) {
        const pd = data.productDimension;
        db.prepare(
          `INSERT INTO ProductDimension (version_id, product_l_inch, product_w_inch, product_h_inch,
           carton_l_inch, carton_paper, carton_w_inch, carton_h_inch, carton_cuft, carton_price, pcs_per_carton)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          versionId, pd.product_l_inch, pd.product_w_inch, pd.product_h_inch,
          pd.carton_l_inch, pd.carton_paper, pd.carton_w_inch, pd.carton_h_inch,
          pd.carton_cuft, pd.carton_price, pd.pcs_per_carton
        );
      }
    });

    insertAll();

    res.json({
      success: true,
      productId: product.id,
      versionId,
      sheetName: data.sheetName,
      summary: {
        moldParts: data.moldParts.length,
        hardwareItems: data.hardwareItems.length,
        packagingItems: data.packagingItems.length,
        electronicItems: data.electronicItems.length,
        materialPrices: data.materialPrices.length,
        machinePrices: data.machinePrices.length,
      },
    });
  } catch (err) {
    console.error('Import error:', err);
    res.status(500).json({ error: err.message, stack: err.stack });
  } finally {
    fs.unlink(tmpPath, () => {});
  }
});

module.exports = router;
