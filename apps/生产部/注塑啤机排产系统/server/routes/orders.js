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
          is_three_plate, packing_qty, import_batch, source_file, status, order_notes, workshop,
          destination, supplier, pmc_follow, quote_price_usd, supplier_price_rmb, supplier_price_usd,
          capacity_per_day, order_date, production_start, estimated_delivery, actual_delivery,
          outsource_status, source_system, source_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `),
      update: db.prepare(`
        UPDATE orders SET product_code=?, mold_no=?, mold_name=?, color=?, color_powder_no=?,
          material_type=?, shot_weight=?, material_kg=?, sprue_pct=?, ratio_pct=?,
          quantity_needed=?, accumulated=?, cavity=?, cycle_time=?, order_no=?,
          is_three_plate=?, packing_qty=?, status=?, order_notes=?, serial_no=?,
          destination=?, supplier=?, pmc_follow=?, quote_price_usd=?, supplier_price_rmb=?, supplier_price_usd=?,
          capacity_per_day=?, order_date=?, production_start=?, estimated_delivery=?, actual_delivery=?,
          outsource_status=?
        WHERE id=?
      `),
      deleteOne: db.prepare('DELETE FROM orders WHERE id = ?'),
    };
  }
  return _stmts;
}

// 获取订单列表
// 兼容旧用法：默认按 workshop（A/B/C）过滤、只返回内部排产订单
// 新用法：
//   ?destination=outsource → 外发订单（忽略 workshop）
//   ?destination=all       → 不区分内部/外发，按 workshop 过滤（NULL workshop 也包含）
//   ?destination=internal  → 显式只要内部
//   ?supplier=兴信A        → 外发场景下按加工厂过滤
router.get('/', (req, res) => {
  try {
    const { status, workshop, destination, supplier } = req.query;
    const conditions = [];
    const params = [];

    if (destination === 'outsource') {
      conditions.push("destination = 'outsource'");
      if (supplier) { conditions.push('supplier = ?'); params.push(supplier); }
    } else if (destination === 'all') {
      const ws = workshop || 'B';
      conditions.push('(workshop = ? OR workshop IS NULL)');
      params.push(ws);
    } else {
      // 默认 / destination=internal：维持旧行为
      const ws = workshop || 'B';
      conditions.push('workshop = ?');
      params.push(ws);
      conditions.push("(destination = 'internal' OR destination IS NULL)");
    }

    if (status) { conditions.push('status = ?'); params.push(status); }

    const sql = 'SELECT * FROM orders WHERE ' + conditions.join(' AND ') + ' ORDER BY created_at DESC';
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
    const dest = o.destination || 'internal';
    // 外发订单 workshop 默认 NULL（不进 A/B/C 视图）；内部订单 workshop 默认 B
    const ws = dest === 'outsource' ? (o.workshop || null) : (o.workshop || 'B');
    const result = stmts().insert.run(
      o.product_code || '', o.mold_no || '', o.mold_name || '',
      o.color || '', o.color_powder_no || '', o.material_type || '',
      o.shot_weight || 0, o.material_kg || 0, o.sprue_pct || 0, o.ratio_pct || 0,
      o.quantity_needed || 0, o.accumulated || 0, o.cavity || 1, o.cycle_time || 0,
      o.order_no || '', o.is_three_plate || 0, o.packing_qty || 0,
      o.import_batch || '', o.source_file || '', o.status || 'pending', o.order_notes || '',
      ws,
      dest, o.supplier || null, o.pmc_follow || null,
      o.quote_price_usd ?? null, o.supplier_price_rmb ?? null, o.supplier_price_usd ?? null,
      o.capacity_per_day ?? null,
      o.order_date || null, o.production_start || null, o.estimated_delivery || null, o.actual_delivery || null,
      o.outsource_status || null, o.source_system || 'paiji', o.source_id || null
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
      o.order_notes ?? existing.order_notes,
      o.serial_no ?? existing.serial_no,
      o.destination ?? existing.destination,
      o.supplier ?? existing.supplier,
      o.pmc_follow ?? existing.pmc_follow,
      o.quote_price_usd ?? existing.quote_price_usd,
      o.supplier_price_rmb ?? existing.supplier_price_rmb,
      o.supplier_price_usd ?? existing.supplier_price_usd,
      o.capacity_per_day ?? existing.capacity_per_day,
      o.order_date ?? existing.order_date,
      o.production_start ?? existing.production_start,
      o.estimated_delivery ?? existing.estimated_delivery,
      o.actual_delivery ?? existing.actual_delivery,
      o.outsource_status ?? existing.outsource_status,
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

// ========== 外发订单：AI PDF 解析（预览，不入库）==========
router.post('/parse-pdf-ai', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: '请上传 PDF 文件' });
    const { aiParsePdfBuffer, aiRowsToOrders } = require('../services/aiPdfParser');
    const buf = fs.readFileSync(req.file.path);
    const parsed = await aiParsePdfBuffer(buf);
    const mappedOrders = aiRowsToOrders(parsed.rows, parsed.header);
    res.json({
      filename: req.file.originalname,
      header: parsed.header,
      rows: parsed.rows,
      orders_preview: mappedOrders,
      model_used: parsed.model_used,
      usage: parsed.usage,
    });
  } catch (err) {
    console.error('[parse-pdf-ai]', err);
    res.status(500).json({ message: 'AI 解析失败：' + err.message });
  } finally {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
  }
});

// ========== 外发订单：批量入库（接受 parse-pdf-ai 的 orders_preview，或前端编辑后的 rows）==========
router.post('/import-outsource', (req, res) => {
  try {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : null;
    if (!rows || rows.length === 0) return res.status(400).json({ message: 'rows 必填且不能为空' });

    const batch = new Date().toISOString();
    let inserted = 0;
    const insertMany = db.transaction(() => {
      for (const o of rows) {
        stmts().insert.run(
          o.product_code || '', o.mold_no || '', o.mold_name || '',
          o.color || '', o.color_powder_no || '', o.material_type || '',
          o.shot_weight || 0, o.material_kg || 0, o.sprue_pct || 0, o.ratio_pct || 0,
          o.quantity_needed || 0, o.accumulated || 0, o.cavity || 1, o.cycle_time || 0,
          o.order_no || '', o.is_three_plate || 0, o.packing_qty || 0,
          batch, o.source_file || 'ai-pdf', o.status || 'pending', o.order_notes || '',
          null, // workshop = NULL 外发不占 A/B/C 视图
          'outsource',
          o.supplier || null, o.pmc_follow || null,
          o.quote_price_usd ?? null, o.supplier_price_rmb ?? null, o.supplier_price_usd ?? null,
          o.capacity_per_day ?? null,
          o.order_date || null, o.production_start || null, o.estimated_delivery || null, o.actual_delivery || null,
          o.outsource_status || 'open',
          o.source_system || 'ai-pdf',
          o.source_id || null
        );
        inserted++;
      }
    });
    insertMany();
    res.json({ message: `已导入 ${inserted} 条外发订单`, count: inserted });
  } catch (err) {
    console.error('[import-outsource]', err);
    res.status(500).json({ message: '导入失败：' + err.message });
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

// 下载订单导入模板
router.get('/template', async (req, res) => {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('订单模板');

  const colWidths = [14, 18, 20, 10, 12, 16, 10, 10, 10, 14, 10];
  colWidths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  ws.mergeCells('A1:K1');
  const tc = ws.getCell('A1');
  tc.value = '啤机部订单导入模板';
  tc.font = { size: 18, bold: true, name: '宋体' };
  tc.alignment = { horizontal: 'center', vertical: 'middle' };
  tc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };
  ws.getRow(1).height = 36;

  ws.mergeCells('A2:K2');
  ws.getCell('A2').value = '填写说明：按下面表头填写订单数据，每行一条。带*的为必填项。灰色示例行请删除后填写。';
  ws.getCell('A2').font = { size: 10, color: { argb: 'FFFF0000' }, name: '宋体' };
  ws.getRow(2).height = 22;

  const headers = ['*产品货号', '*模具编号', '模具名称', '*颜色', '色粉编号', '*料型', '*啤重G', '用料KG', '*需啤数', '下单单号', '备注'];
  const hr = ws.getRow(3);
  const thin = { style: 'thin' };
  headers.forEach((h, i) => {
    const c = hr.getCell(i + 1);
    c.value = h;
    c.font = { size: 11, bold: true, name: '宋体', color: { argb: 'FFFFFFFF' } };
    c.alignment = { horizontal: 'center', vertical: 'middle' };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1677FF' } };
    c.border = { top: thin, left: thin, bottom: thin, right: thin };
  });
  hr.height = 28;

  const samples = [
    ['92105', 'RBCA-08M-01', '奶嘴模具', '金色', '87793', 'LDPE 260GG', 17.6, 73.18, 4138, 'ZWY260002/B', ''],
    ['47391', 'RC01854', '吃尺转动轴', '黑色', '88066', 'ABS AG15AIH', 15.3, 43.05, 2800, 'LWW20260317006/B', ''],
  ];
  samples.forEach((s, i) => {
    const row = ws.getRow(4 + i);
    s.forEach((v, j) => {
      const c = row.getCell(j + 1);
      c.value = v;
      c.font = { size: 10, name: '宋体', color: { argb: 'FF999999' } };
      c.alignment = { horizontal: 'center', vertical: 'middle' };
    });
  });

  for (let i = 6; i <= 50; i++) {
    for (let j = 1; j <= 11; j++) {
      ws.getRow(i).getCell(j).border = { top: { style: 'thin', color: { argb: 'FFDDDDDD' } }, left: { style: 'thin', color: { argb: 'FFDDDDDD' } }, bottom: { style: 'thin', color: { argb: 'FFDDDDDD' } }, right: { style: 'thin', color: { argb: 'FFDDDDDD' } } };
    }
  }

  ws.views = [{ state: 'frozen', ySplit: 3, activeCell: 'A4' }];
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent('订单导入模板.xlsx')}`);
  await wb.xlsx.write(res);
  res.end();
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
      // PDF 处理优先级：
      // 1) 用 pdftoppm 把 PDF 转 PNG，每页发给百炼识别（需服务器装 poppler-utils）
      // 2) 失败时回退本地 XY 坐标解析器
      let useFallback = false;
      try {
        const { pdfToImages, cleanupTmp } = require('../services/pdfToImages');
        const { parseImageWithQwen } = require('../services/qwenOcr');
        const { tmpDir, files } = pdfToImages(req.file.path);
        console.log('[PDF转PNG] 共', files.length, '页');
        try {
          for (let i = 0; i < files.length; i++) {
            console.log('[PDF→百炼] 处理第', i + 1, '/', files.length, '页');
            const pageOrders = await parseImageWithQwen(files[i]);
            parsed = parsed.concat(pageOrders);
          }
          console.log('[百炼PDF导入] 共解析', parsed.length, '条');
        } finally {
          cleanupTmp(tmpDir);
        }
      } catch (e) {
        console.log('[百炼PDF失败，回退本地]:', e.message);
        useFallback = true;
      }

      if (useFallback || parsed.length === 0) {
        const { parsePdf } = require('../services/pdfParser');
        parsed = await parsePdf(req.file.path);
        console.log('[本地PDF解析] 结果:', parsed.length, '条');
      }
    } else if (['.xlsx', '.xls'].includes(ext)) {
      const { parseOrderExcel, parseXingxinOrderExcel } = require('../services/excelParser');
      // 检测是否为兴信生产单格式（含"啤净重"或"出模数"）
      const XLSX = require('xlsx');
      const wbCheck = XLSX.readFile(req.file.path);
      const wsCheck = wbCheck.Sheets[wbCheck.SheetNames[0]];
      const rowsCheck = XLSX.utils.sheet_to_json(wsCheck, { header: 1, defval: '' });
      const checkText = rowsCheck.slice(0, 12).map(r => r.join(' ')).join(' ');
      const isXingxin = checkText.includes('啤净重') || checkText.includes('净重G') || checkText.includes('出模数') || checkText.includes('兴信啤机') || checkText.includes('啤货表') || checkText.includes('啤 机');
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
    } else if (['.png', '.jpg', '.jpeg', '.bmp', '.webp'].includes(ext)) {
      // 图片走阿里百炼 qwen-vl-max
      const { parseImageWithQwen } = require('../services/qwenOcr');
      parsed = await parseImageWithQwen(req.file.path);
      console.log('[百炼图片OCR] 解析结果:', parsed.length, '条');
    } else {
      return res.status(400).json({ message: '不支持的文件格式，仅支持PDF/Excel/图片' });
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
          batch, req.file.originalname, 'pending', o.notes || '', workshop,
          // 导入流程默认是内部排产订单，外发字段全部 NULL
          'internal', null, null, null, null, null, null, null, null, null, null, null, 'paiji', null
        );
      }
    });

    insertMany(parsed);
    res.json({ message: `成功导入 ${parsed.length} 条订单`, count: parsed.length, added: parsed.length });
  } catch (err) {
    res.status(500).json({ message: '导入失败：' + err.message });
  } finally {
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
  }
});

module.exports = router;
