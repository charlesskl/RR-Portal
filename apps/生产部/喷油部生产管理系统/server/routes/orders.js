const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const db = require('../db');
const { parsePDFOrder } = require('../services/pdf-order-parser');
const { parseImageOrder } = require('../services/image-order-parser');
const { calcPrices } = require('../lib/pricing');
const router = express.Router();
const UPLOAD_DIR = path.join(process.env.DATA_PATH || path.join(__dirname, '..'), 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const upload = multer({ dest: UPLOAD_DIR });

function ceilDiv(a, b) { return b > 0 ? Math.ceil(a / b) : 0; }
function addDays(yyyymmdd, days) {
  const d = new Date(yyyymmdd + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function nextSortOrder(dbi, workshop_id) {
  // 新行排到最末:取该车间下当前最大 sort_order + 1
  const row = dbi.prepare(`
    SELECT COALESCE(MAX(osl.sort_order), 0) AS m
    FROM order_schedule_lines osl
    JOIN production_orders po ON po.id = osl.order_id
    WHERE po.workshop_id = ?
  `).get(workshop_id);
  return (row.m || 0) + 1;
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
      (order_id, product_process_id, line_id, qty, daily_capacity, actual_capacity, est_days, start_date, end_date, sort_order)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `);
    let sortOrder = nextSortOrder(dbi, workshop_id);
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
      insertLine.run(oid, pp.id, line_id, total_qty, capacity, capacity, est_days, start_date, end_date, sortOrder++);
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

function listActiveScheduleLines(dbi, workshop_id) {
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
      AND osl.started_at IS NOT NULL
      AND osl.completed_at IS NULL
    ORDER BY osl.sort_order, osl.id
  `).all(workshop_id);
}

router.get('/', (req, res) =>
  res.json(listOrders(db, { workshop_id: req.workshopId, month: req.query.month, q: req.query.q })));

router.get('/active', (req, res) => {
  // 改:不再按日期过滤,只要「已排单 + 未完成」就返回,跨日存在
  res.json(listActiveScheduleLines(db, req.workshopId));
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

// 拿 parsed = {header, code, items:[{part_name,qty}]} 做款号/工序匹配 + alias 查找
// 返回 preview 响应体(写不写 res 由调用者决定)
function buildOrderPreview(parsed, workshopId) {
  if (!parsed.code) return { status: 400, body: { error: '无法提取款号' } };

  const codeVariants = [parsed.code, parsed.code.replace(/[-\s].*$/, '')];
  let product = null;
  for (const v of codeVariants) {
    product = db.prepare('SELECT * FROM products WHERE code=? AND deleted=0 AND workshop_id=?')
      .get(v, workshopId);
    if (product) break;
  }
  if (!product) {
    return {
      status: 200,
      body: {
        header: parsed.header,
        code: parsed.code,
        items: parsed.items,
        matched: false,
        error: `核价表里没有款号 ${parsed.code}(去尾后试 ${codeVariants[1]} 也没有),请先去核价表新建产品`,
      },
    };
  }

  const processes = db.prepare(
    'SELECT * FROM product_processes WHERE product_id=? AND deleted=0 ORDER BY id'
  ).all(product.id);
  const procById = new Map(processes.map(pp => [pp.id, pp]));

  const aliasRows = db.prepare(
    'SELECT pdf_part_name, product_process_id FROM pdf_part_alias WHERE product_id=? AND workshop_id=?'
  ).all(product.id, workshopId);
  const aliasMap = new Map();
  for (const a of aliasRows) {
    if (!aliasMap.has(a.pdf_part_name)) aliasMap.set(a.pdf_part_name, []);
    aliasMap.get(a.pdf_part_name).push(a.product_process_id);
  }

  const normalize = s => String(s || '').replace(/\s|\(印喷件\)|（印喷件）/g, '').toLowerCase();
  const matchedItems = parsed.items.map(it => {
    let matched = [];
    let from_alias = false;
    const aliasIds = aliasMap.get(it.part_name);
    if (aliasIds && aliasIds.length) {
      matched = aliasIds.map(id => procById.get(id)).filter(Boolean);
      from_alias = true;
    } else {
      const k = normalize(it.part_name);
      matched = processes.filter(pp => {
        const pk = normalize(pp.part_name);
        return pk === k || pk.includes(k) || k.includes(pk);
      });
    }
    return {
      pdf_part_name: it.part_name,
      pdf_qty: it.qty,
      from_alias,
      matched_processes: matched.map(pp => ({
        id: pp.id, part_name: pp.part_name, technique: pp.technique,
        target_qty: pp.target_qty, unit_wage: pp.unit_wage,
      })),
    };
  });

  return {
    status: 200,
    body: {
      header: parsed.header,
      code: parsed.code,
      product: { id: product.id, code: product.code, name: product.name },
      items: matchedItems,
      matched: true,
      unmatched_count: matchedItems.filter(x => x.matched_processes.length === 0).length,
      all_processes: processes.map(pp => ({
        id: pp.id, part_name: pp.part_name, technique: pp.technique,
        target_qty: pp.target_qty, unit_wage: pp.unit_wage,
      })),
    },
  };
}

// PDF 导入 - 预览(不写库,返回匹配结果让用户确认)
router.post('/import-pdf', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'file required' });
  try {
    const fs = require('fs');
    const buf = fs.readFileSync(req.file.path);
    const parsed = await parsePDFOrder(buf);
    fs.unlinkSync(req.file.path);
    const { status, body } = buildOrderPreview(parsed, req.workshopId);
    res.status(status).json(body);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 图片导入 - 用百炼视觉模型抽订单结构,然后走和 PDF 一样的匹配流程
router.post('/import-image', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'file required' });
  const fs = require('fs');
  try {
    const buf = fs.readFileSync(req.file.path);
    const mime = req.file.mimetype || 'image/jpeg';
    const parsed = await parseImageOrder(buf, mime);
    fs.unlinkSync(req.file.path);
    const { status, body } = buildOrderPreview(parsed, req.workshopId);
    res.status(status).json(body);
  } catch (e) {
    try { fs.unlinkSync(req.file.path); } catch (_) {}
    res.status(500).json({ error: e.message });
  }
});

// PDF 导入 - 确认写入(收前端 review 后的 items)
router.post('/import-pdf/confirm', (req, res) => {
  const { product_id, order_name, start_date, items } = req.body;
  if (!product_id || !order_name || !start_date || !Array.isArray(items)) {
    return res.status(400).json({ error: 'product_id, order_name, start_date, items required' });
  }
  // items 形态:
  //   { product_process_id, qty, pdf_part_name?, learn_alias? }  — 用已有工序;learn_alias=true 时把 pdf_part_name → product_process_id 存映射
  //   { new_process: {part_name,technique,unit_wage,target_qty}, qty, pdf_part_name?, learn_alias? } — 新建工序,也可顺手记 alias
  const totalQty = Math.max(...items.map(i => Number(i.qty) || 0), 0);
  const product = db.prepare('SELECT id FROM products WHERE id=? AND deleted=0 AND workshop_id=?')
    .get(product_id, req.workshopId);
  if (!product) return res.status(404).json({ error: 'product not found' });

  try {
    const result = db.transaction(() => {
      const { lastInsertRowid: oid } = db.prepare(
        'INSERT INTO production_orders(order_name, product_id, total_qty, start_date, remarks, workshop_id) VALUES (?,?,?,?,?,?)'
      ).run(order_name, product_id, totalQty, start_date, 'PDF 导入', req.workshopId);

      const defaultsStmt = db.prepare(
        'SELECT line_id FROM technique_line_defaults WHERE workshop_id=? AND technique=?'
      );
      const ppStmt = db.prepare('SELECT * FROM product_processes WHERE id=?');
      const insertProc = db.prepare(`
        INSERT INTO product_processes
        (product_id,part_name,technique,target_qty,worker_count,unit_wage,calc_price,paint_price,total_price,remarks)
        VALUES (?,?,?,?,?,?,?,?,?,?)
      `);
      const insertLine = db.prepare(`
        INSERT INTO order_schedule_lines
        (order_id, product_process_id, line_id, qty, daily_capacity, actual_capacity, est_days, start_date, end_date, sort_order)
        VALUES (?,?,?,?,?,?,?,?,?,?)
      `);
      let sortOrder = nextSortOrder(db, req.workshopId);
      const insertAlias = db.prepare(`
        INSERT OR IGNORE INTO pdf_part_alias
        (product_id, pdf_part_name, product_process_id, workshop_id)
        VALUES (?,?,?,?)
      `);

      let createdProcCount = 0;
      let learnedAliasCount = 0;
      for (const it of items) {
        let pp = null;
        if (it.new_process && it.new_process.part_name && it.new_process.technique) {
          const np = it.new_process;
          const unit_wage = Number(np.unit_wage) || 0;
          const target_qty = Number(np.target_qty) || 0;
          const { calc_price, paint_price, total_price } = calcPrices({ unit_wage });
          const { lastInsertRowid: ppId } = insertProc.run(
            product_id,
            String(np.part_name).trim(),
            String(np.technique).trim(),
            target_qty,
            1,
            unit_wage,
            calc_price,
            paint_price,
            total_price,
            ''
          );
          pp = ppStmt.get(ppId);
          createdProcCount++;
        } else if (it.product_process_id) {
          pp = ppStmt.get(it.product_process_id);
        }
        if (!pp) continue;
        // 记 alias:前端传了 learn_alias 才记(避免把自动模糊匹配的也写进去)
        if (it.learn_alias && it.pdf_part_name) {
          const info = insertAlias.run(product_id, String(it.pdf_part_name).trim(), pp.id, req.workshopId);
          if (info.changes) learnedAliasCount++;
        }
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
        insertLine.run(oid, pp.id, line_id, qty, capacity, capacity, est_days, start_date, end_date, sortOrder++);
      }
      return { oid, createdProcCount, learnedAliasCount };
    })();
    res.json({
      ok: true,
      order_id: result.oid,
      created_processes: result.createdProcCount,
      learned_aliases: result.learnedAliasCount,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 平铺所有件:按 sort_order 排,可选月份/关键字过滤,这是新版主页要用的接口
router.get('/schedule-lines/flat', (req, res) => {
  const { month, q } = req.query;
  const params = [req.workshopId];
  let where = 'po.deleted=0 AND po.workshop_id=?';
  if (month) { where += " AND strftime('%Y-%m', po.start_date) = ?"; params.push(month); }
  if (q) {
    where += ' AND (po.order_name LIKE ? OR p.code LIKE ? OR p.name LIKE ? OR pp.part_name LIKE ?)';
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  const rows = db.prepare(`
    SELECT osl.id, osl.order_id, po.order_name, po.start_date AS order_start_date,
           p.id AS product_id, p.code AS product_code, p.name AS product_name, p.quote_price,
           osl.product_process_id, pp.part_name, pp.technique, pp.unit_wage,
           osl.line_id, l.name AS line_name,
           osl.qty, osl.daily_capacity,
           COALESCE(osl.actual_capacity, osl.daily_capacity) AS actual_capacity,
           osl.est_days, osl.start_date, osl.end_date,
           osl.started_at, osl.completed_at, osl.sort_order,
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
    WHERE ${where}
    ORDER BY osl.sort_order, osl.id
  `).all(...params);
  res.json(rows);
});

// 拖拽重排:前端传 {ids:[id1,id2,...]} 按数组顺序重写 sort_order
router.put('/schedule-lines/reorder', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Boolean) : [];
  if (!ids.length) return res.status(400).json({ error: 'ids required' });
  const upd = db.prepare(`
    UPDATE order_schedule_lines SET sort_order=?
    WHERE id=? AND order_id IN (SELECT id FROM production_orders WHERE workshop_id=?)
  `);
  db.transaction(() => {
    ids.forEach((id, i) => upd.run(i + 1, id, req.workshopId));
  })();
  res.json({ ok: true });
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
