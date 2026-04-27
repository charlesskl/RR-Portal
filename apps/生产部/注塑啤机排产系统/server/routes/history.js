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
  // 获取所有机台
  const machines = db.prepare(`
    SELECT machine_no FROM machines
    WHERE workshop = ? AND status = 'active' AND machine_no != '其他机台'
    ORDER BY CAST(REPLACE(REPLACE(REPLACE(machine_no, '#', ''), 'C-', ''), 'A-', '') AS INTEGER)
  `).all(workshop);

  // 获取历史统计（同时支持带前缀和不带前缀的机台号）
  const histStats = db.prepare(`
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
  `).all(workshop);

  // 建索引：按原始机台号建map（不要覆盖）
  const histMap = {};
  for (const h of histStats) {
    histMap[h.machine_no] = h;
  }

  // 合并：对每台机，同时找带前缀和不带前缀的历史记录并合并
  const stats = machines.map(m => {
    const stripped = m.machine_no.replace(/^[A-Z]-/, '');
    const candidates = [histMap[m.machine_no], histMap[stripped]].filter(x => x);
    // 去重（如果stripped和原始一样会只有一个）
    const unique = [...new Set(candidates)];

    if (unique.length === 0) {
      return { machine_no: m.machine_no, min_shot_weight: 0, max_shot_weight: 0, avg_shot_weight: 0, record_count: 0, mold_count: 0, material_count: 0 };
    }
    if (unique.length === 1) {
      return { ...unique[0], machine_no: m.machine_no };
    }
    // 合并多条
    const totalCnt = unique.reduce((sum, h) => sum + h.record_count, 0);
    return {
      machine_no: m.machine_no,
      min_shot_weight: Math.min(...unique.map(h => h.min_shot_weight)),
      max_shot_weight: Math.max(...unique.map(h => h.max_shot_weight)),
      avg_shot_weight: Math.round(unique.reduce((sum, h) => sum + h.avg_shot_weight * h.record_count, 0) / totalCnt * 100) / 100,
      record_count: totalCnt,
      mold_count: Math.max(...unique.map(h => h.mold_count)),
      material_count: Math.max(...unique.map(h => h.material_count)),
    };
  });
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
