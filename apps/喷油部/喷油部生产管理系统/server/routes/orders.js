const express = require('express');
const path = require('path');
const multer = require('multer');
const db = require('../db');
const { parsePDFOrder } = require('../services/pdf-order-parser');
const router = express.Router();
const upload = multer({ dest: path.join(__dirname, '..', 'uploads') });

function ceilDiv(a, b) { return b > 0 ? Math.ceil(a / b) : 0; }
function addDays(yyyymmdd, days) {
  const d = new Date(yyyymmdd + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function createOrder(dbi, { order_name, product_id, total_qty, start_date, remarks, workshop_id }) {
  const defaultsStmt = dbi.prepare(
    'SELECT line_id FROM technique_line_defaults WHERE workshop_id=? AND technique=?'
  );
  return dbi.transaction(() => {
    const { lastInsertRowid: oid } = dbi.prepare(
      'INSERT INTO production_orders(order_name, product_id, total_qty, start_date, remarks, workshop_id) VALUES (?,?,?,?,?,?)'
    ).run(order_name, product_id, total_qty, start_date, remarks || '', workshop_id);
    const procs = dbi.prepare(
      'SELECT * FROM product_processes WHERE product_id=? AND deleted=0 ORDER BY id'
    ).all(product_id);
    const insertLine = dbi.prepare(`
      INSERT INTO order_schedule_lines
      (order_id, product_process_id, line_id, qty, daily_capacity, actual_capacity, est_days, start_date, end_date)
      VALUES (?,?,?,?,?,?,?,?,?)
    `);
    for (const pp of procs) {
      // 优先用产品工序级记忆(上次为该具体工序选的拉),没有再用车间级默认映射
      let line_id = pp.default_line_id || null;
      if (!line_id) {
        const def = defaultsStmt.get(workshop_id, pp.technique);
        line_id = def ? def.line_id : null;
      }
      const capacity = pp.target_qty || 1;
      const est_days = ceilDiv(total_qty, capacity);
      const end_date = addDays(start_date, Math.max(est_days - 1, 0));
      insertLine.run(oid, pp.id, line_id, total_qty, capacity, capacity, est_days, start_date, end_date);
    }
    return oid;
  })();
}

function getOrder(dbi, id, workshop_id) {
  const o = dbi.prepare(`
    SELECT po.*, p.code AS product_code, p.name AS product_name
    FROM production_orders po JOIN products p ON p.id=po.product_id
    WHERE po.id=? AND po.deleted=0 AND po.workshop_id=?
  `).get(id, workshop_id);
  if (!o) return null;
  const schedule_lines = dbi.prepare(`
    SELECT osl.*, pp.part_name, pp.technique, pp.target_qty, pp.unit_wage, l.name AS line_name,
      (SELECT COALESCE(SUM(dr.produced_qty), 0)
        FROM daily_records dr
        WHERE dr.product_process_id = osl.product_process_id
          AND dr.record_date >= osl.start_date
          AND (osl.line_id IS NULL OR dr.line_id = osl.line_id)
      ) AS produced_total
    FROM order_schedule_lines osl
    JOIN product_processes pp ON pp.id = osl.product_process_id
    LEFT JOIN lines l ON l.id = osl.line_id
    WHERE osl.order_id = ?
    ORDER BY osl.id
  `).all(id);
  return { ...o, schedule_lines };
}

function listOrders(dbi, { month, q, workshop_id }) {
  const params = [workshop_id];
  let where = 'po.deleted=0 AND po.workshop_id=?';
  if (month) { where += " AND strftime('%Y-%m', po.start_date) = ?"; params.push(month); }
  if (q) { where += ' AND (po.order_name LIKE ? OR p.code LIKE ? OR p.name LIKE ?)';
    params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  return dbi.prepare(`
    SELECT po.*, p.code AS product_code, p.name AS product_name, p.quote_price,
      (SELECT COUNT(*) FROM order_schedule_lines WHERE order_id=po.id) AS line_count,
      (SELECT COUNT(*) FROM order_schedule_lines WHERE order_id=po.id AND completed_at IS NOT NULL) AS completed_count,
      (SELECT MAX(completed_at) FROM order_schedule_lines WHERE order_id=po.id) AS last_completed_at
    FROM production_orders po JOIN products p ON p.id=po.product_id
    WHERE ${where}
    ORDER BY po.start_date DESC, po.id DESC
  `).all(...params);
}

function updateScheduleLine(dbi, slId, patch) {
  const cur = dbi.prepare('SELECT * FROM order_schedule_lines WHERE id=?').get(slId);
  if (!cur) return;
  const qty = patch.qty ?? cur.qty;
  const daily_capacity = patch.daily_capacity ?? cur.daily_capacity;
  const actual_capacity = patch.actual_capacity ?? cur.actual_capacity ?? daily_capacity;
  const start_date = patch.start_date ?? cur.start_date;
  // 预计天数按实际产能算(没填实际就用日产能兜底)
  const capForEst = actual_capacity > 0 ? actual_capacity : daily_capacity;
  const est_days = ceilDiv(qty, capForEst);
  const end_date = addDays(start_date, Math.max(est_days - 1, 0));
  const line_id = patch.line_id !== undefined ? patch.line_id : cur.line_id;
  dbi.prepare(`
    UPDATE order_schedule_lines
    SET line_id=?, qty=?, daily_capacity=?, actual_capacity=?, est_days=?, start_date=?, end_date=?
    WHERE id=?
  `).run(line_id, qty, daily_capacity, actual_capacity, est_days, start_date, end_date, slId);
  // 记忆该工序的拉选择,下次同产品下单时直接用
  if (patch.line_id !== undefined && line_id) {
    dbi.prepare('UPDATE product_processes SET default_line_id=? WHERE id=?')
      .run(line_id, cur.product_process_id);
  }
}

function listActiveScheduleLines(dbi, date, workshop_id) {
  return dbi.prepare(`
    SELECT
      osl.id AS schedule_line_id,
      osl.order_id, po.order_name,
      osl.line_id, l.name AS line_name,
      po.product_id, p.code AS product_code, p.name AS product_name, p.quote_price,
      osl.product_process_id, pp.part_name, pp.technique, pp.unit_wage,
      osl.qty AS planned_qty,
      osl.daily_capacity,
      COALESCE(osl.actual_capacity, osl.daily_capacity) AS actual_capacity,
      osl.est_days,
      osl.start_date, osl.end_date,
      osl.started_at, osl.completed_at,
      (SELECT COALESCE(SUM(dr.produced_qty), 0)
        FROM daily_records dr
        WHERE dr.product_process_id = osl.product_process_id
          AND dr.record_date >= osl.start_date
          AND (osl.line_id IS NULL OR dr.line_id = osl.line_id)
      ) AS produced_total
    FROM order_schedule_lines osl
    JOIN production_orders po ON po.id = osl.order_id
    LEFT JOIN lines l ON l.id = osl.line_id
    JOIN products p ON p.id = po.product_id
    JOIN product_processes pp ON pp.id = osl.product_process_id
    WHERE po.deleted = 0
      AND po.workshop_id = ?
      AND osl.start_date <= ? AND osl.end_date >= ?
      AND osl.completed_at IS NULL
    ORDER BY po.id, pp.technique, osl.id
  `).all(workshop_id, date, date);
}

router.get('/', (req, res) =>
  res.json(listOrders(db, { workshop_id: req.workshopId, month: req.query.month, q: req.query.q })));

router.get('/active', (req, res) => {
  const date = req.query.date;
  if (!date) return res.status(400).json({ error: 'date required' });
  res.json(listActiveScheduleLines(db, date, req.workshopId));
});

router.get('/:id', (req, res) => {
  const o = getOrder(db, req.params.id, req.workshopId);
  if (!o) return res.status(404).json({ error: 'not found' });
  res.json(o);
});

router.post('/', (req, res) => {
  const { order_name, product_id, total_qty, start_date, remarks } = req.body;
  if (!order_name || !product_id || !total_qty || !start_date)
    return res.status(400).json({ error: 'order_name, product_id, total_qty, start_date required' });
  const id = createOrder(db, {
    order_name, product_id, total_qty: Number(total_qty), start_date, remarks,
    workshop_id: req.workshopId
  });
  res.json({ id });
});

// PDF 导入 - 预览(不写库,返回匹配结果让用户确认)
router.post('/import-pdf', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'file required' });
  try {
    const fs = require('fs');
    const buf = fs.readFileSync(req.file.path);
    const parsed = await parsePDFOrder(buf);
    fs.unlinkSync(req.file.path);

    if (!parsed.code) return res.status(400).json({ error: '无法从 PDF 提取款号' });

    // 款号匹配:先按完整 code,然后剥后缀(去掉 -总MA 等)再匹配
    const codeVariants = [parsed.code, parsed.code.replace(/[-\s].*$/, '')];
    let product = null;
    for (const v of codeVariants) {
      product = db.prepare('SELECT * FROM products WHERE code=? AND deleted=0 AND workshop_id=?')
        .get(v, req.workshopId);
      if (product) break;
    }

    if (!product) {
      return res.json({
        header: parsed.header,
        code: parsed.code,
        items: parsed.items,
        matched: false,
        error: `核价表里没有款号 ${parsed.code}(去尾后试 ${codeVariants[1]} 也没有),请先去核价表新建产品`,
      });
    }

    // 拿产品的所有工序
    const processes = db.prepare(
      'SELECT * FROM product_processes WHERE product_id=? AND deleted=0 ORDER BY id'
    ).all(product.id);

    // 模糊匹配:PDF 部位 ↔ 核价表 part_name
    const normalize = s => String(s || '').replace(/\s|\(印喷件\)|（印喷件）/g, '').toLowerCase();
    const matchedItems = parsed.items.map(it => {
      const pdfKey = normalize(it.part_name);
      const matched = processes.filter(pp => {
        const pk = normalize(pp.part_name);
        return pk === pdfKey || pk.includes(pdfKey) || pdfKey.includes(pk);
      });
      return {
        pdf_part_name: it.part_name,
        pdf_qty: it.qty,
        matched_processes: matched.map(pp => ({
          id: pp.id, part_name: pp.part_name, technique: pp.technique,
          target_qty: pp.target_qty, unit_wage: pp.unit_wage,
        })),
      };
    });

    res.json({
      header: parsed.header,
      code: parsed.code,
      product: { id: product.id, code: product.code, name: product.name },
      items: matchedItems,
      matched: true,
      unmatched_count: matchedItems.filter(x => x.matched_processes.length === 0).length,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PDF 导入 - 确认写入(收前端 review 后的 items)
router.post('/import-pdf/confirm', (req, res) => {
  const { product_id, order_name, start_date, items } = req.body;
  if (!product_id || !order_name || !start_date || !Array.isArray(items)) {
    return res.status(400).json({ error: 'product_id, order_name, start_date, items required' });
  }
  // items: [{ product_process_id, qty }, ...] (可来自多 PDF 部位 × 多工序的展开)
  // 注:total_qty 不再是单一值;我们按 items 里最大 qty 当 total_qty(只是展示用)
  const totalQty = Math.max(...items.map(i => Number(i.qty) || 0), 0);
  const product = db.prepare('SELECT id FROM products WHERE id=? AND deleted=0 AND workshop_id=?')
    .get(product_id, req.workshopId);
  if (!product) return res.status(404).json({ error: 'product not found' });

  try {
    const oid = db.transaction(() => {
      const { lastInsertRowid: oid } = db.prepare(
        'INSERT INTO production_orders(order_name, product_id, total_qty, start_date, remarks, workshop_id) VALUES (?,?,?,?,?,?)'
      ).run(order_name, product_id, totalQty, start_date, 'PDF 导入', req.workshopId);

      const defaultsStmt = db.prepare(
        'SELECT line_id FROM technique_line_defaults WHERE workshop_id=? AND technique=?'
      );
      const ppStmt = db.prepare('SELECT * FROM product_processes WHERE id=?');
      const insertLine = db.prepare(`
        INSERT INTO order_schedule_lines
        (order_id, product_process_id, line_id, qty, daily_capacity, actual_capacity, est_days, start_date, end_date)
        VALUES (?,?,?,?,?,?,?,?,?)
      `);

      for (const it of items) {
        const pp = ppStmt.get(it.product_process_id);
        if (!pp) continue;
        // 优先工序级记忆,再车间级默认
        let line_id = pp.default_line_id || null;
        if (!line_id) {
          const def = defaultsStmt.get(req.workshopId, pp.technique);
          line_id = def ? def.line_id : null;
        }
        const qty = Number(it.qty) || 0;
        const capacity = pp.target_qty || 1;
        const est_days = ceilDiv(qty, capacity);
        const end_date = addDays(start_date, Math.max(est_days - 1, 0));
        insertLine.run(oid, pp.id, line_id, qty, capacity, capacity, est_days, start_date, end_date);
      }
      return oid;
    })();
    res.json({ ok: true, order_id: oid });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/:id/schedule-lines/:slId', (req, res) => {
  updateScheduleLine(db, Number(req.params.slId), req.body || {});
  res.json({ ok: true });
});
router.post('/:id/schedule-lines/:slId/start', (req, res) => {
  db.prepare("UPDATE order_schedule_lines SET started_at=CURRENT_TIMESTAMP WHERE id=? AND started_at IS NULL").run(req.params.slId);
  res.json({ ok: true });
});
router.post('/:id/schedule-lines/:slId/complete', (req, res) => {
  db.prepare("UPDATE order_schedule_lines SET completed_at=CURRENT_TIMESTAMP WHERE id=? AND started_at IS NOT NULL AND completed_at IS NULL").run(req.params.slId);
  res.json({ ok: true });
});
router.post('/:id/schedule-lines/:slId/reset', (req, res) => {
  db.prepare("UPDATE order_schedule_lines SET started_at=NULL, completed_at=NULL WHERE id=?").run(req.params.slId);
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  db.prepare('UPDATE production_orders SET deleted=1 WHERE id=? AND workshop_id=?')
    .run(req.params.id, req.workshopId);
  res.json({ ok: true });
});

module.exports = router;
Object.assign(module.exports, { createOrder, getOrder, listOrders, updateScheduleLine, listActiveScheduleLines });
