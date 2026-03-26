const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('../db/connection');

const upload = multer({ dest: path.join(__dirname, '..', 'uploads') });

// ========== 延迟编译SQL（表在initDatabase后才存在）==========
let _stmts;
function stmts() {
  if (!_stmts) {
    _stmts = {
      getById: db.prepare('SELECT * FROM orders WHERE id = ?'),
      insert: db.prepare(`
        INSERT INTO orders (product_code, mold_no, mold_name, color, color_powder_no,
          material_type, shot_weight, material_kg, sprue_pct, ratio_pct,
          quantity_needed, accumulated, cavity, cycle_time, order_no,
          is_three_plate, packing_qty, import_batch, source_file, status, order_notes, workshop)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `),
      update: db.prepare(`
        UPDATE orders SET product_code=?, mold_no=?, mold_name=?, color=?, color_powder_no=?,
          material_type=?, shot_weight=?, material_kg=?, sprue_pct=?, ratio_pct=?,
          quantity_needed=?, accumulated=?, cavity=?, cycle_time=?, order_no=?,
          is_three_plate=?, packing_qty=?, status=?
        WHERE id=?
      `),
      deleteOne: db.prepare('DELETE FROM orders WHERE id = ?'),
    };
  }
  return _stmts;
}

// 获取所有订单
router.get('/', (req, res) => {
  try {
    const { status, workshop } = req.query;
    const ws = workshop || 'B';
    let sql = 'SELECT * FROM orders WHERE workshop = ?';
    const params = [ws];
    if (status) { sql += ' AND status = ?'; params.push(status); }
    sql += ' ORDER BY created_at DESC';
    const orders = db.prepare(sql).all(...params);
    res.json(orders);
  } catch (err) {
    res.status(500).json({ message: '查询失败：' + err.message });
  }
});

// 新增订单
router.post('/', (req, res) => {
  try {
    const o = req.body;
    const result = stmts().insert.run(
      o.product_code || '', o.mold_no || '', o.mold_name || '',
      o.color || '', o.color_powder_no || '', o.material_type || '',
      o.shot_weight || 0, o.material_kg || 0, o.sprue_pct || 0, o.ratio_pct || 0,
      o.quantity_needed || 0, o.accumulated || 0, o.cavity || 1, o.cycle_time || 0,
      o.order_no || '', o.is_three_plate || 0, o.packing_qty || 0,
      o.import_batch || '', o.source_file || '', o.status || 'pending', o.order_notes || '',
      o.workshop || 'B'
    );
    res.json({ id: result.lastInsertRowid, ...o });
  } catch (err) {
    res.status(500).json({ message: '新增失败：' + err.message });
  }
});

// 更新订单
router.put('/:id', (req, res) => {
  try {
    const o = req.body;
    const existing = stmts().getById.get(req.params.id);
    if (!existing) return res.status(404).json({ message: '订单不存在' });
    stmts().update.run(
      o.product_code ?? existing.product_code,
      o.mold_no ?? existing.mold_no,
      o.mold_name ?? existing.mold_name,
      o.color ?? existing.color,
      o.color_powder_no ?? existing.color_powder_no,
      o.material_type ?? existing.material_type,
      o.shot_weight ?? existing.shot_weight,
      o.material_kg ?? existing.material_kg,
      o.sprue_pct ?? existing.sprue_pct,
      o.ratio_pct ?? existing.ratio_pct,
      o.quantity_needed ?? existing.quantity_needed,
      o.accumulated ?? existing.accumulated,
      o.cavity ?? existing.cavity,
      o.cycle_time ?? existing.cycle_time,
      o.order_no ?? existing.order_no,
      o.is_three_plate ?? existing.is_three_plate,
      o.packing_qty ?? existing.packing_qty,
      o.status ?? existing.status,
      req.params.id
    );
    res.json({ id: Number(req.params.id), ...o });
  } catch (err) {
    res.status(500).json({ message: '更新失败：' + err.message });
  }
});

// 删除订单
router.delete('/:id', (req, res) => {
  try {
    stmts().deleteOne.run(req.params.id);
    res.json({ message: '已删除' });
  } catch (err) {
    res.status(500).json({ message: '删除失败：' + err.message });
  }
});

// 清空所有订单（仅当前车间）
router.delete('/', (req, res) => {
  try {
    const workshop = req.query.workshop || req.body.workshop || 'B';
    db.prepare('DELETE FROM orders WHERE workshop = ?').run(workshop);
    res.json({ message: '已清空' });
  } catch (err) {
    res.status(500).json({ message: '清空失败：' + err.message });
  }
});

// 调试：返回PDF原始文本（临时接口）
router.post('/debug-pdf', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: '请上传文件' });
    const pdfParse = require('pdf-parse');
    const fs2 = require('fs');
    const buf = fs2.readFileSync(req.file.path);
    const data = await pdfParse(buf);
    res.json({ text: data.text, lines: data.text.split('\n').map((l, i) => `${i}: ${l}`) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  } finally {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
  }
});

// 导入 Excel 或 PDF
router.post('/import', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: '请上传文件' });

    const ext = path.extname(req.file.originalname).toLowerCase();
    const batch = new Date().toISOString();
    let parsed = [];

    console.log('[导入] 文件:', req.file.originalname, '类型:', ext);
    if (ext === '.pdf') {
      const { parsePdf } = require('../services/pdfParser');
      parsed = await parsePdf(req.file.path);
    } else if (['.xlsx', '.xls'].includes(ext)) {
      const { parseOrderExcel, parseXingxinOrderExcel } = require('../services/excelParser');
      // 检测是否为兴信生产单格式（含"啤净重"或"出模数"）
      const XLSX = require('xlsx');
      const wbCheck = XLSX.readFile(req.file.path);
      const wsCheck = wbCheck.Sheets[wbCheck.SheetNames[0]];
      const rowsCheck = XLSX.utils.sheet_to_json(wsCheck, { header: 1, defval: '' });
      const checkText = rowsCheck.slice(0, 8).map(r => r.join(' ')).join(' ');
      const isXingxin = checkText.includes('啤净重') || checkText.includes('出模数') || checkText.includes('兴信啤机');
      if (isXingxin) {
        parsed = parseXingxinOrderExcel(req.file.path);
        console.log('[兴信生产单导入] 解析结果:', parsed.length, '条');
      } else {
        parsed = parseOrderExcel(req.file.path);
        console.log('[Excel导入] 解析结果:', parsed.length, '条');
      }
      if (parsed.length === 0) {
        for (let i = 0; i < Math.min(rowsCheck.length, 5); i++) {
          console.log('[Excel] Row', i, ':', JSON.stringify(rowsCheck[i]).substring(0, 200));
        }
      }
    } else {
      return res.status(400).json({ message: '不支持的文件格式，仅支持PDF/Excel' });
    }

    const workshop = req.body.workshop || 'B';
    const insertMany = db.transaction((rows) => {
      for (const o of rows) {
        stmts().insert.run(
          o.product_code || '', o.mold_no || '', o.mold_name || '',
          o.color || '', o.color_powder_no || '', o.material_type || '',
          o.shot_weight || 0, o.material_kg || 0, o.sprue_pct || 0, o.ratio_pct || 0,
          o.quantity_needed || 0, o.accumulated || 0, o.cavity || 1, o.cycle_time || 0,
          o.order_no || '', o.is_three_plate || 0, o.packing_qty || 0,
          batch, req.file.originalname, 'pending', o.notes || '', workshop
        );
      }
    });

    insertMany(parsed);
    res.json({ message: `成功导入 ${parsed.length} 条订单`, added: parsed.length });
  } catch (err) {
    res.status(500).json({ message: '导入失败：' + err.message });
  } finally {
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
  }
});

module.exports = router;
