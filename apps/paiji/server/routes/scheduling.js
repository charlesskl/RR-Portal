const express = require('express');
const router = express.Router();
const db = require('../db/connection');

// 获取所有排机单
router.get('/', (req, res) => {
  const workshop = req.query.workshop || 'B';
  const schedules = db.prepare('SELECT * FROM schedules WHERE workshop = ? ORDER BY id DESC').all(workshop);
  res.json(schedules);
});

// 查询上一班次结转情况（预览用）— 必须在 /:id 之前
router.get('/carry-over', (req, res) => {
  try {
    const { date, shift } = req.query;
    if (!date || !shift) return res.json({ carryOverCount: 0, items: [] });

    let prevDate = date;
    let prevShift;
    if (shift === '夜班') {
      prevShift = '白班';
    } else {
      const d = new Date(date);
      d.setDate(d.getDate() - 1);
      prevDate = d.toISOString().slice(0, 10);
      prevShift = '夜班';
    }

    const workshop = req.query.workshop || 'B';
    const prevSchedule = db.prepare(
      'SELECT * FROM schedules WHERE schedule_date = ? AND shift = ? AND workshop = ? ORDER BY id DESC LIMIT 1'
    ).get(prevDate, prevShift, workshop);

    if (!prevSchedule) {
      return res.json({ carryOverCount: 0, items: [], prevDate, prevShift });
    }

    const items = db.prepare(
      'SELECT * FROM schedule_items WHERE schedule_id = ? ORDER BY sort_order, id'
    ).all(prevSchedule.id);

    res.json({
      carryOverCount: items.length,
      items,
      prevDate,
      prevShift,
      prevScheduleId: prevSchedule.id,
    });
  } catch (err) {
    console.error('查询结转失败:', err);
    res.status(500).json({ message: err.message });
  }
});

// 执行智能排机 — 必须在 /:id 之前
router.post('/generate', (req, res) => {
  try {
    const { date, shift, orderIds, workshop } = req.body;
    if (!date || !shift || !Array.isArray(orderIds)) {
      return res.status(400).json({ message: '请提供date、shift和orderIds' });
    }
    const { generateSchedule } = require('../services/schedulingEngine');
    const result = generateSchedule({ orderIds, date, shift, workshop: workshop || 'B' });
    res.json(result);
  } catch (err) {
    console.error('排机失败:', err);
    res.status(500).json({ message: '排机失败: ' + err.message });
  }
});

// 获取单个排机单（含明细）
router.get('/:id', (req, res) => {
  const schedule = db.prepare('SELECT * FROM schedules WHERE id = ?').get(req.params.id);
  if (!schedule) return res.status(404).json({ message: '排机单不存在' });
  const items = db.prepare('SELECT * FROM schedule_items WHERE schedule_id = ? ORDER BY sort_order, id').all(req.params.id);
  res.json({ schedule, items });
});

// 删除排机单
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM schedules WHERE id = ?').run(req.params.id);
  res.json({ message: '已删除' });
});

// 更新明细行
router.put('/:id/items/:itemId', (req, res) => {
  const { itemId } = req.params;
  const fields = ['notes', 'robot_arm', 'clamp', 'mold_change_time', 'adjuster', 'machine_no'];
  const updates = [];
  const values = [];

  for (const f of fields) {
    if (req.body[f] !== undefined) {
      updates.push(`${f} = ?`);
      values.push(req.body[f]);
    }
  }

  // 累计数更新时自动计算欠数
  if (req.body.accumulated !== undefined) {
    const currentItem = db.prepare('SELECT * FROM schedule_items WHERE id = ?').get(itemId);
    if (!currentItem) return res.status(404).json({ message: '记录不存在' });

    const accumulated = Number(req.body.accumulated) || 0;
    const shortage = Math.max(0, (currentItem.quantity_needed || 0) - accumulated);

    updates.push('accumulated = ?', 'shortage = ?');
    values.push(accumulated, shortage);

    // 同步更新订单表，若欠数为0则标记完成
    if (currentItem.order_id) {
      if (shortage <= 0) {
        db.prepare("UPDATE orders SET accumulated = ?, status = 'completed' WHERE id = ?")
          .run(accumulated, currentItem.order_id);
        // 同步所有排单里相同订单的条目，欠数全部归零
        db.prepare("UPDATE schedule_items SET accumulated = ?, shortage = 0 WHERE order_id = ? AND id != ?")
          .run(accumulated, currentItem.order_id, itemId);
      } else {
        db.prepare('UPDATE orders SET accumulated = ? WHERE id = ?')
          .run(accumulated, currentItem.order_id);
        // 同步其他排单里相同订单的条目的累计数
        db.prepare("UPDATE schedule_items SET accumulated = ?, shortage = ? WHERE order_id = ? AND id != ?")
          .run(accumulated, shortage, currentItem.order_id, itemId);
      }
    }
  }

  // 目标数更新时自动计算天数
  if (req.body.target_24h !== undefined) {
    const currentItem = db.prepare('SELECT * FROM schedule_items WHERE id = ?').get(itemId);
    if (!currentItem) return res.status(404).json({ message: '记录不存在' });
    const t24h = Number(req.body.target_24h) || 0;
    const t11h = Number(req.body.target_11h) || (t24h > 0 ? Math.round(t24h / 24 * 11) : 0);
    const shortage = currentItem.shortage || Math.max(0, (currentItem.quantity_needed || 0) - (currentItem.accumulated || 0));
    const daysNeeded = t24h > 0 ? Math.round((shortage / t24h) * 100) / 100 : 0;
    updates.push('target_24h = ?', 'target_11h = ?', 'days_needed = ?');
    values.push(t24h, t11h, daysNeeded);
  }

  if (updates.length === 0) return res.status(400).json({ message: '没有要更新的字段' });

  values.push(itemId);
  db.prepare(`UPDATE schedule_items SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  const item = db.prepare('SELECT * FROM schedule_items WHERE id = ?').get(itemId);
  res.json(item);
});

// 复制排机项到另一台机
router.post('/:id/items/:itemId/copy', (req, res) => {
  const { id, itemId } = req.params;
  const { machine_no } = req.body;
  if (!machine_no) return res.status(400).json({ message: '请指定目标机台' });

  const source = db.prepare('SELECT * FROM schedule_items WHERE id = ? AND schedule_id = ?').get(itemId, id);
  if (!source) return res.status(404).json({ message: '原记录不存在' });

  // 复制所有字段到新机台，sort_order 放最后
  const maxSort = db.prepare('SELECT MAX(sort_order) as m FROM schedule_items WHERE schedule_id = ?').get(id);
  const newSort = (maxSort?.m || 0) + 1;

  const result = db.prepare(`
    INSERT INTO schedule_items (schedule_id, machine_no, product_code, mold_name, color, color_powder_no,
      material_type, shot_weight, material_kg, sprue_pct, ratio_pct, accumulated, quantity_needed,
      shortage, order_no, target_24h, target_11h, days_needed, packing_qty, notes, robot_arm,
      clamp, mold_change_time, adjuster, sort_order, order_id, is_carry_over)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, machine_no, source.product_code, source.mold_name, source.color, source.color_powder_no,
    source.material_type, source.shot_weight, source.material_kg, source.sprue_pct, source.ratio_pct,
    0, source.quantity_needed, source.quantity_needed, source.order_no,
    source.target_24h, source.target_11h, source.days_needed, source.packing_qty,
    source.notes, source.robot_arm, source.clamp, source.mold_change_time, source.adjuster,
    newSort, source.order_id, 0
  );

  const newItem = db.prepare('SELECT * FROM schedule_items WHERE id = ?').get(result.lastInsertRowid);
  res.json({ message: `已复制到 ${machine_no}`, item: newItem });
});

// 确认排机单 → 写入历史数据库
router.post('/:id/confirm', (req, res) => {
  try {
    const schedule = db.prepare('SELECT * FROM schedules WHERE id = ?').get(req.params.id);
    if (!schedule) return res.status(404).json({ message: '排机单不存在' });

    const items = db.prepare('SELECT * FROM schedule_items WHERE schedule_id = ?').all(req.params.id);
    if (items.length === 0) return res.status(400).json({ message: '排机单无明细' });

    const insertHistory = db.prepare(`
      INSERT INTO history_records (
        machine_no, product_code, mold_name, color, color_powder_no, material_type,
        shot_weight, material_kg, sprue_pct, ratio_pct, accumulated, quantity_needed,
        shortage, order_no, target_24h, target_11h, packing_qty, notes, source_date, import_batch, workshop
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const batch = `confirm_${schedule.schedule_date}_${schedule.shift}_${Date.now()}`;
    const scheduleWorkshop = schedule.workshop || 'B';

    const writeAll = db.transaction(() => {
      for (const item of items) {
        insertHistory.run(
          item.machine_no, item.product_code, item.mold_name, item.color,
          item.color_powder_no, item.material_type, item.shot_weight, item.material_kg,
          item.sprue_pct, item.ratio_pct, item.accumulated, item.quantity_needed,
          item.shortage, item.order_no, item.target_24h, item.target_11h,
          item.packing_qty, item.notes, schedule.schedule_date, batch, scheduleWorkshop
        );
      }
      db.prepare('UPDATE schedules SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run('confirmed', req.params.id);
      for (const item of items) {
        if (item.order_id) {
          db.prepare('UPDATE orders SET status = ? WHERE id = ?').run('scheduled', item.order_id);
        }
      }
    });

    writeAll();

    // 刷新机台统计
    const machines = db.prepare('SELECT DISTINCT machine_no FROM schedule_items WHERE schedule_id = ?').all(req.params.id);
    for (const m of machines) {
      const stats = db.prepare(`
        SELECT MIN(shot_weight) as min_sw, MAX(shot_weight) as max_sw,
               AVG(shot_weight) as avg_sw, COUNT(*) as cnt
        FROM history_records WHERE machine_no = ? AND shot_weight > 0
      `).get(m.machine_no);
      if (stats) {
        db.prepare(`
          UPDATE machines SET min_shot_weight = ?, max_shot_weight = ?, avg_shot_weight = ?, record_count = ?, updated_at = CURRENT_TIMESTAMP
          WHERE machine_no = ?
        `).run(stats.min_sw || 0, stats.max_sw || 0, stats.avg_sw || 0, stats.cnt || 0, m.machine_no);
      }
    }

    res.json({ message: `已确认，${items.length}条记录写入历史数据库`, count: items.length });
  } catch (err) {
    console.error('确认排机单失败:', err);
    res.status(500).json({ message: '确认失败: ' + err.message });
  }
});

module.exports = router;
