const express = require('express');
const router = express.Router();
const db = require('../db/connection');

// 获取所有机台（含啤重统计）
router.get('/', (req, res) => {
  const workshop = req.query.workshop || 'B';
  // 按机台号排序：其他机台 排最后，其他按数字升序
  const machines = db.prepare(`
    SELECT * FROM machines WHERE workshop = ?
    ORDER BY
      CASE WHEN machine_no = '其他机台' THEN 1 ELSE 0 END,
      CAST(REPLACE(REPLACE(REPLACE(machine_no, '#', ''), 'C-', ''), 'A-', '') AS INTEGER)
  `).all(workshop);
  res.json(machines);
});

// 新增机台
router.post('/', (req, res) => {
  const { machine_no, brand, tonnage, arm_type, model_desc, workshop } = req.body;
  if (!machine_no) return res.status(400).json({ message: '机台编号不能为空' });
  const ws = workshop || 'B';
  const desc = model_desc || `${brand || ''}${tonnage || ''}T${arm_type || ''}`;
  try {
    const result = db.prepare(
      `INSERT INTO machines (machine_no, brand, tonnage, arm_type, model_desc, workshop) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(machine_no, brand || '', tonnage || 0, arm_type || '', desc, ws);
    res.json({ id: result.lastInsertRowid, message: '添加成功' });
  } catch (e) {
    res.status(400).json({ message: '添加失败：' + e.message });
  }
});

// 更新机台信息
router.put('/:id', (req, res) => {
  const { id } = req.params;
  const { status, notes } = req.body;
  const updates = [];
  const values = [];
  if (status !== undefined) { updates.push('status = ?'); values.push(status); }
  if (notes !== undefined) { updates.push('notes = ?'); values.push(notes); }
  if (updates.length === 0) return res.status(400).json({ message: '没有要更新的字段' });

  updates.push('updated_at = CURRENT_TIMESTAMP');
  values.push(id);
  db.prepare(`UPDATE machines SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  const machine = db.prepare('SELECT * FROM machines WHERE id = ?').get(id);
  res.json(machine);
});

// 根据历史数据刷新每台机的啤重G区间
router.post('/refresh-stats', (req, res) => {
  const stats = db.prepare(`
    SELECT machine_no,
           MIN(shot_weight) as min_w,
           MAX(shot_weight) as max_w,
           AVG(shot_weight) as avg_w,
           COUNT(*) as cnt
    FROM history_records
    WHERE shot_weight > 0
    GROUP BY machine_no
  `).all();

  const update = db.prepare(`
    UPDATE machines SET min_shot_weight = ?, max_shot_weight = ?, avg_shot_weight = ?, record_count = ?, updated_at = CURRENT_TIMESTAMP
    WHERE machine_no = ?
  `);

  const updateAll = db.transaction((rows) => {
    for (const row of rows) {
      update.run(row.min_w, row.max_w, Math.round(row.avg_w * 100) / 100, row.cnt, row.machine_no);
    }
  });

  updateAll(stats);
  const machines = db.prepare('SELECT * FROM machines ORDER BY id').all();
  res.json({ message: `已更新${stats.length}台机的啤重统计`, machines });
});

module.exports = router;
