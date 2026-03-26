const express = require('express');
const router = express.Router();
const db = require('../db/connection');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const upload = multer({ dest: path.join(__dirname, '..', 'uploads') });

// 获取历史记录（分页+筛选）
router.get('/', (req, res) => {
  const { machine_no, material, page = 1, pageSize = 50, workshop } = req.query;
  const ws = workshop || 'B';
  let where = 'WHERE workshop = ?';
  const params = [ws];

  if (machine_no) { where += ' AND machine_no = ?'; params.push(machine_no); }
  if (material) { where += ' AND material_type LIKE ?'; params.push(`%${material}%`); }

  const total = db.prepare(`SELECT COUNT(*) as cnt FROM history_records ${where}`).get(...params).cnt;
  const offset = (parseInt(page) - 1) * parseInt(pageSize);
  params.push(parseInt(pageSize), offset);
  const rows = db.prepare(`SELECT * FROM history_records ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...params);

  res.json({ total, page: parseInt(page), pageSize: parseInt(pageSize), data: rows });
});

// 每台机啤重G统计
router.get('/stats', (req, res) => {
  const workshop = req.query.workshop || 'B';
  const stats = db.prepare(`
    SELECT machine_no,
           MIN(shot_weight) as min_shot_weight,
           MAX(shot_weight) as max_shot_weight,
           ROUND(AVG(shot_weight), 2) as avg_shot_weight,
           COUNT(*) as record_count,
           COUNT(DISTINCT mold_name) as mold_count,
           COUNT(DISTINCT material_type) as material_count
    FROM history_records
    WHERE shot_weight > 0 AND workshop = ?
    GROUP BY machine_no
    ORDER BY machine_no
  `).all(workshop);
  res.json(stats);
});

// 根据啤重推荐机台
router.get('/recommend', (req, res) => {
  const { shot_weight, workshop } = req.query;
  if (!shot_weight) return res.status(400).json({ message: '请提供shot_weight参数' });

  const w = parseFloat(shot_weight);
  const ws = workshop || 'B';
  const machines = db.prepare(`
    SELECT m.*,
           h.min_w, h.max_w, h.avg_w, h.cnt,
           CASE
             WHEN ? BETWEEN h.min_w AND h.max_w THEN 1
             ELSE 0
           END as in_range,
           ABS(? - h.avg_w) as distance
    FROM machines m
    LEFT JOIN (
      SELECT machine_no,
             MIN(shot_weight) as min_w,
             MAX(shot_weight) as max_w,
             AVG(shot_weight) as avg_w,
             COUNT(*) as cnt
      FROM history_records WHERE shot_weight > 0 AND workshop = ?
      GROUP BY machine_no
    ) h ON m.machine_no = h.machine_no
    WHERE m.status = 'active' AND m.workshop = ? AND h.cnt > 0
    ORDER BY in_range DESC, distance ASC
  `).all(w, w, ws, ws);

  res.json(machines);
});

// 查某台机的历史记录
router.get('/machine/:no', (req, res) => {
  const rows = db.prepare('SELECT * FROM history_records WHERE machine_no = ? ORDER BY id DESC').all(req.params.no);
  res.json(rows);
});

// 导入历史数据（Excel）
router.post('/import', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: '请上传文件' });

  try {
    const { parseHistoryExcel } = require('../services/excelParser');
    const records = await parseHistoryExcel(req.file.path);

    const batch = Date.now().toString();
    const workshop = req.body.workshop || 'B';
    const insert = db.prepare(`
      INSERT INTO history_records (machine_no, product_code, mold_name, color, color_powder_no,
        material_type, shot_weight, material_kg, sprue_pct, ratio_pct, accumulated,
        quantity_needed, shortage, order_no, target_24h, target_11h, packing_qty, notes, import_batch, workshop)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertAll = db.transaction((rows) => {
      let count = 0;
      for (const r of rows) {
        insert.run(
          r.machine_no, r.product_code, r.mold_name, r.color, r.color_powder_no,
          r.material_type, r.shot_weight, r.material_kg, r.sprue_pct, r.ratio_pct,
          r.accumulated, r.quantity_needed, r.shortage, r.order_no,
          r.target_24h, r.target_11h, r.packing_qty, r.notes, batch, workshop
        );
        count++;
      }
      return count;
    });

    const count = insertAll(records);

    // 自动刷新机台啤重统计（按车间过滤）
    const stats = db.prepare(`
      SELECT machine_no, MIN(shot_weight) as min_w, MAX(shot_weight) as max_w,
             AVG(shot_weight) as avg_w, COUNT(*) as cnt
      FROM history_records WHERE shot_weight > 0 AND workshop = ? GROUP BY machine_no
    `).all(workshop);

    // B车间机台编号直接匹配，A/C车间机台编号加前缀（如 1# -> A-1#）
    const prefix = workshop === 'B' ? '' : workshop + '-';
    const updateMachine = db.prepare(`
      UPDATE machines SET min_shot_weight=?, max_shot_weight=?, avg_shot_weight=ROUND(?,2), record_count=?, updated_at=CURRENT_TIMESTAMP
      WHERE machine_no=? AND workshop=?
    `);
    db.transaction(() => {
      for (const s of stats) updateMachine.run(s.min_w, s.max_w, s.avg_w, s.cnt, prefix + s.machine_no, workshop);
    })();

    res.json({ message: `成功导入${count}条历史记录`, count, batch });
  } catch (err) {
    console.error('导入历史数据失败:', err);
    res.status(500).json({ message: '导入失败: ' + err.message });
  } finally {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
  }
});

module.exports = router;
