const express = require('express');
const router = express.Router();
const db = require('../db/connection');
const multer = require('multer');
const XLSX = require('xlsx');
const path = require('path');
const upload = multer({ dest: path.join(__dirname, '..', 'uploads') });

// 获取所有模具目标
router.get('/', (req, res) => {
  const workshop = req.query.workshop || 'B';
  const targets = db.prepare('SELECT * FROM mold_targets WHERE workshop = ? ORDER BY mold_no').all(workshop);
  res.json(targets);
});

// 新增模具目标
router.post('/', (req, res) => {
  const { mold_no, mold_name, target_24h, target_11h, notes, workshop } = req.body;
  if (!mold_no) return res.status(400).json({ message: '模具编号不能为空' });
  const ws = workshop || 'B';
  try {
    const result = db.prepare(
      `INSERT INTO mold_targets (mold_no, mold_name, target_24h, target_11h, notes, workshop)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(mold_no, mold_name || '', target_24h || 0, target_11h || 0, notes || '', ws);
    res.json({ id: result.lastInsertRowid, message: '添加成功' });
  } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(400).json({ message: '该模具编号已存在' });
    }
    res.status(500).json({ message: e.message });
  }
});

// 更新模具目标
router.put('/:id', (req, res) => {
  const { mold_no, mold_name, target_24h, target_11h, notes } = req.body;
  db.prepare(
    `UPDATE mold_targets SET mold_no=?, mold_name=?, target_24h=?, target_11h=?, notes=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`
  ).run(mold_no, mold_name || '', target_24h || 0, target_11h || 0, notes || '', req.params.id);
  res.json({ message: '更新成功' });
});

// 删除模具目标
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM mold_targets WHERE id=?').run(req.params.id);
  res.json({ message: '已删除' });
});

// 批量删除
router.post('/batch-delete', (req, res) => {
  const { ids } = req.body;
  if (!ids || !ids.length) return res.status(400).json({ message: '未选择任何记录' });
  const placeholders = ids.map(() => '?').join(',');
  const result = db.prepare(`DELETE FROM mold_targets WHERE id IN (${placeholders})`).run(...ids);
  res.json({ message: `已删除 ${result.changes} 条`, count: result.changes });
});

// 全部删除（仅当前车间）
router.delete('/', (req, res) => {
  const workshop = req.query.workshop || 'B';
  const result = db.prepare('DELETE FROM mold_targets WHERE workshop = ?').run(workshop);
  res.json({ message: `已清空 ${result.changes} 条`, count: result.changes });
});

// 批量导入（从历史记录自动生成）
router.post('/import-from-history', (req, res) => {
  const workshop = req.body.workshop || 'B';
  const records = db.prepare(`
    SELECT mold_name, MAX(target_24h) as target_24h, MAX(target_11h) as target_11h
    FROM history_records
    WHERE target_24h > 0 AND workshop = ?
    GROUP BY mold_name
  `).all(workshop);

  let count = 0;
  const stmt = db.prepare(`
    INSERT INTO mold_targets (mold_no, mold_name, target_24h, target_11h, notes, workshop)
    VALUES (?, ?, ?, ?, '', ?)
    ON CONFLICT(mold_no) DO UPDATE SET
      target_24h = excluded.target_24h,
      target_11h = excluded.target_11h,
      workshop = excluded.workshop,
      updated_at = CURRENT_TIMESTAMP
  `);
  for (const r of records) {
    if (!r.mold_name) continue;
    const moldNo = r.mold_name.split(' ')[0] || r.mold_name;
    const result = stmt.run(moldNo, r.mold_name, r.target_24h, r.target_11h, workshop);
    if (result.changes > 0) count++;
  }
  res.json({ message: `从历史记录导入了 ${count} 条模具目标`, count });
});

// 从Excel导入模具目标
// 支持格式：B车间啤机部目标数存档统计表
//   col0=货号（组头行有值，延续行为空）, col1=货名/模具名称, col2=24H目标, col4=11H目标
router.post('/import-excel', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ message: '请上传文件' });
  try {
    const wb = XLSX.readFile(req.file.path);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });

    // 自动检测表头行：需要至少3个关键字同时出现（避免描述文字误匹配）
    let headerIdx = -1;
    let colProduct = 0, colName = 1, col24h = 2, col11h = 4;
    const headerKeywords = [/^货号$/, /货名|模具名称/, /24H/i, /11H/i, /12H/i, /工价/];
    for (let i = 0; i < Math.min(rows.length, 15); i++) {
      const row = rows[i];
      if (!row) continue;
      const cells = row.map(c => String(c || '').trim());
      const hits = headerKeywords.filter(k => cells.some(c => k.test(c))).length;
      if (hits >= 3) {
        headerIdx = i;
        // 确定各列位置
        for (let j = 0; j < cells.length; j++) {
          if (/^货号$/.test(cells[j])) colProduct = j;
          if (/货名|模具名称/.test(cells[j])) colName = j;
          if (/24H/i.test(cells[j])) col24h = j;
          if (/11H/i.test(cells[j])) col11h = j;
        }
        break;
      }
    }
    if (headerIdx < 0) headerIdx = 5;

    const workshop = req.body.workshop || 'B';
    const stmt = db.prepare(`
      INSERT INTO mold_targets (mold_no, mold_name, target_24h, target_11h, notes, workshop)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(mold_no) DO UPDATE SET
        target_24h = excluded.target_24h,
        target_11h = excluded.target_11h,
        notes = excluded.notes,
        workshop = excluded.workshop,
        updated_at = CURRENT_TIMESTAMP
    `);

    let count = 0;
    let currentProduct = ''; // 延续货号
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;

      // 货号：有值则更新当前组，空则沿用上一组
      if (row[colProduct] != null && String(row[colProduct]).trim()) {
        currentProduct = String(row[colProduct]).trim().replace(/\n/g, ' ');
      }

      const moldName = String(row[colName] || '').trim();
      if (!moldName) continue;

      const t24h = parseInt(row[col24h]) || 0;
      const t11h = parseInt(row[col11h]) || Math.round(t24h / 24 * 11);
      if (t24h <= 0) continue;

      // 用模具名称作为唯一键（因为此Excel没有标准模具编号）
      const moldNo = moldName;
      stmt.run(moldNo, currentProduct, t24h, t11h, '', workshop);
      count++;
    }

    res.json({ message: `成功导入 ${count} 条模具目标`, count });
  } catch (e) {
    console.error('[MoldTargets] Excel导入错误:', e);
    res.status(500).json({ message: '解析Excel失败: ' + e.message });
  }
});

module.exports = router;
