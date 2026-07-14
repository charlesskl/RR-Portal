const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('../db/connection');

const uploadDir = process.env.DATA_PATH
  ? path.join(process.env.DATA_PATH, 'uploads')
  : path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({ dest: uploadDir });

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
          is_three_plate, packing_qty, import_batch, source_file, status, order_notes, serial_no, workshop)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `),
      update: db.prepare(`
        UPDATE orders SET product_code=?, mold_no=?, mold_name=?, color=?, color_powder_no=?,
          material_type=?, shot_weight=?, material_kg=?, sprue_pct=?, ratio_pct=?,
          quantity_needed=?, accumulated=?, cavity=?, cycle_time=?, order_no=?,
          is_three_plate=?, packing_qty=?, status=?, order_notes=?, serial_no=?
        WHERE id=?
      `),
      deleteOne: db.prepare('DELETE FROM orders WHERE id = ?'),
    };
  }
  return _stmts;
}

function cleanText(value, maxLength = 500) {
  return String(value == null ? '' : value).trim().slice(0, maxLength);
}

function normalizeUploadFilename(value) {
  const original = cleanText(value, 255);
  if (!original || [...original].some(char => char.charCodeAt(0) > 255)) return original;
  try {
    const decoded = Buffer.from(original, 'latin1').toString('utf8');
    if (!decoded.includes('\uFFFD') && /[^\x00-\x7F]/.test(decoded)) return decoded;
  } catch {
    // Keep the multipart filename when it was not Latin-1 encoded UTF-8.
  }
  return original;
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeImportRow(row = {}, defaults = {}) {
  const cavity = finiteNumber(row.cavity, 1);
  return {
    product_code: cleanText(row.product_code, 120),
    mold_no: cleanText(row.mold_no, 160),
    mold_name: cleanText(row.mold_name, 300),
    color: cleanText(row.color, 120),
    color_powder_no: cleanText(row.color_powder_no, 120),
    material_type: cleanText(row.material_type, 200),
    shot_weight: finiteNumber(row.shot_weight),
    material_kg: finiteNumber(row.material_kg),
    sprue_pct: finiteNumber(row.sprue_pct),
    ratio_pct: finiteNumber(row.ratio_pct),
    quantity_needed: Math.round(finiteNumber(row.quantity_needed)),
    accumulated: Math.round(finiteNumber(row.accumulated)),
    cavity: cavity > 0 ? Math.round(cavity) : 1,
    cycle_time: finiteNumber(row.cycle_time),
    order_no: cleanText(row.order_no, 180),
    is_three_plate: row.is_three_plate ? 1 : 0,
    packing_qty: Math.round(finiteNumber(row.packing_qty)),
    order_notes: cleanText(row.order_notes ?? row.notes, 500),
    serial_no: cleanText(row.serial_no, 120),
    source_file: cleanText(row.source_file || defaults.source_file, 255),
    parser: cleanText(row.parser || defaults.parser, 100),
    workshop: cleanText(row.workshop || defaults.workshop || 'B', 30) || 'B',
  };
}

function validateImportRow(row) {
  const errors = [];
  const warnings = [];
  let expectedMaterialKg = null;

  if (!row.mold_no && !row.mold_name) errors.push('缺少模具编号或模具名称');
  if (!(row.quantity_needed > 0)) errors.push('需啤数必须大于 0');
  if (!row.product_code) warnings.push('产品货号为空');
  if (!row.material_type) warnings.push('料型为空');
  if (!(row.shot_weight > 0)) warnings.push('啤重为空或为 0');
  if (!(row.material_kg > 0)) warnings.push('用料KG为空或为 0');

  if (row.shot_weight > 0 && row.quantity_needed > 0 && row.material_kg > 0) {
    expectedMaterialKg = row.shot_weight * row.quantity_needed / 1000;
    const base = Math.max(expectedMaterialKg, row.material_kg, 1);
    const difference = Math.abs(expectedMaterialKg - row.material_kg) / base;
    if (difference > 0.1) {
      warnings.push(
        '重量校验偏差 ' + Math.round(difference * 100)
        + '%（按啤重和啤数应约 ' + expectedMaterialKg.toFixed(2) + 'KG）'
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    expected_material_kg: expectedMaterialKg == null
      ? null
      : Math.round(expectedMaterialKg * 100) / 100,
  };
}

function buildPreviewRows(rows, defaults = {}) {
  return (rows || []).map((row, index) => {
    const normalized = normalizeImportRow(row, defaults);
    return {
      ...normalized,
      preview_id: Date.now() + '-' + (index + 1),
      validation: validateImportRow(normalized),
    };
  });
}

function insertImportRows(rows, defaults = {}) {
  const batch = defaults.batch || new Date().toISOString();
  const insertedIds = [];
  const insertMany = db.transaction((normalizedRows) => {
    for (const o of normalizedRows) {
      const result = stmts().insert.run(
        o.product_code, o.mold_no, o.mold_name,
        o.color, o.color_powder_no, o.material_type,
        o.shot_weight, o.material_kg, o.sprue_pct, o.ratio_pct,
        o.quantity_needed, o.accumulated, o.cavity, o.cycle_time,
        o.order_no, o.is_three_plate, o.packing_qty,
        batch, o.source_file, 'pending', o.order_notes, o.serial_no, o.workshop
      );
      insertedIds.push(Number(result.lastInsertRowid));
    }
  });
  insertMany(rows);
  return insertedIds;
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
      o.serial_no || '', o.workshop || 'B'
    );
    res.json({ id: result.lastInsertRowid, ...o });
  } catch (err) {
    res.status(500).json({ message: '新增失败：' + err.message });
  }
});

// 解析预览确认后批量入库
router.post('/import-confirm', (req, res) => {
  try {
    const rows = Array.isArray(req.body?.orders) ? req.body.orders : [];
    if (rows.length === 0) return res.status(400).json({ message: '没有可导入的订单' });
    if (rows.length > 1000) return res.status(400).json({ message: '单次最多导入 1000 条订单' });

    const defaults = {
      workshop: req.body.workshop || 'B',
      source_file: req.body.source_file || '',
      parser: req.body.parser || '',
    };
    const normalized = rows.map((row) => normalizeImportRow(row, defaults));
    const validations = normalized.map((row, index) => ({
      row: index + 1,
      ...validateImportRow(row),
    }));
    const invalid = validations.filter((item) => !item.valid);
    if (invalid.length > 0) {
      return res.status(400).json({
        message: '有 ' + invalid.length + ' 条订单未通过校验，请修正后再导入',
        errors: invalid,
      });
    }

    const insertedIds = insertImportRows(normalized);
    res.json({
      message: '成功导入 ' + insertedIds.length + ' 条订单',
      count: insertedIds.length,
      added: insertedIds.length,
      inserted_ids: insertedIds,
    });
  } catch (err) {
    res.status(500).json({ message: '确认导入失败：' + err.message });
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

    const sourceFile = normalizeUploadFilename(req.file.originalname);
    const ext = path.extname(sourceFile).toLowerCase();
    const batch = new Date().toISOString();
    let parsed = [];
    let parser = 'unknown';
    let aiReview = {
      available: Boolean(process.env.BAILIAN_API_KEY),
      status: 'not_needed',
      suspect_rows: 0,
      reviewed_rows: 0,
      corrected_fields: 0,
    };

    console.log('[导入] 文件:', sourceFile, '类型:', ext);
    if (ext === '.pdf') {
      // PDF 处理优先级：
      // -1) 啤货表固定表格解析（表头坐标 + 重量/啤数校验）
      // 0) paiji 自带 pdfTemplateParser（华登CMC外发 + B车间生产单，已端到端测准）
      // 1) 外发 pdf-parser 的 A_xinxin（兴信内部生产单的另一种格式，如 71172 按钮）
      // 2) PDF → PNG → 百炼 VLM 识别（兜底）
      // 3) 本地 XY 坐标解析器（最后兜底）
      let useFallback = false;
      const fs = require('fs');

      // Step -1: 优先走固定啤货表解析，不命中才交给后续解析器。
      try {
        const { parseBeihuoPdfBuffer } = require('../services/beihuoOrderParser');
        const beihuoResult = await parseBeihuoPdfBuffer(fs.readFileSync(req.file.path));
        if (beihuoResult && beihuoResult.orders.length > 0) {
          parsed = beihuoResult.orders;
          parser = beihuoResult.template || 'beihuo-pdf';
          console.log('[啤货表解析命中]', beihuoResult.template, '→', parsed.length, '条');
        }
      } catch (e) {
        console.log('[啤货表解析异常]:', e.message);
      }

      // Step 0: paiji 自带模板规则（华登CMC + B车间内部生产单两种已验准）
      if (parsed.length === 0) try {
        const { parsePdfByTemplate } = require('../services/pdfTemplateParser');
        const tplResult = await parsePdfByTemplate(fs.readFileSync(req.file.path));
        if (tplResult && tplResult.orders.length > 0) {
          parsed = tplResult.orders;
          parser = tplResult.template || 'pdf-template';
          console.log('[模板解析命中]', tplResult.template, '→', parsed.length, '条');
        }
      } catch (e) {
        console.log('[模板解析异常]:', e.message);
      }

      // Step 1: 外发 pdf-parser 兜底（兴信 A_xinxin 等其他模板）
      if (parsed.length === 0) try {
        const { parsePdfBuffer } = require('../services/outsource/pdf-parser');
        const r = await parsePdfBuffer(fs.readFileSync(req.file.path));
        if (r && r.template === 'A_xinxin' && r.rows && r.rows.length > 0) {
          const header = r.header || {};
          parsed = r.rows.map(row => ({
            product_code: '',
            mold_no: row.mold_code || '',
            mold_name: [row.mold_code, row.mold_name].filter(Boolean).join(' ').trim() || row.mold_name || '',
            color: row.color || '',
            color_powder_no: row.color_powder || '',
            material_type: row.material || '',
            quantity_needed: parseInt(row.shots) || 0,   // ⚠️ 严格取啤数
            shot_weight: parseFloat(row.shot_weight_g) || 0,
            material_kg: parseFloat(row.total_weight_kg) || 0,
            order_no: header.bill_no || '',
            notes: [row.row_note, row.delivery_date && ('交期 ' + row.delivery_date)].filter(Boolean).join(' '),
            accumulated: 0, cavity: 1, cycle_time: 0,
            sprue_pct: 0, ratio_pct: 0,
            is_three_plate: 0, packing_qty: 0,
          })).filter(o => o.mold_no || o.mold_name);
          parser = 'outsource-A_xinxin';
          console.log('[外发A_xinxin命中] →', parsed.length, '条');
        } else if (r && r.template !== 'unknown') {
          console.log('[外发识别为', r.template, '但字段映射未做，跳过让 VLM 接]');
        }
      } catch (e) {
        console.log('[模板解析异常]:', e.message);
      }

      if (parsed.length === 0) {
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
            if (parsed.length > 0) parser = 'qwen-pdf-vision';
            console.log('[百炼PDF导入] 共解析', parsed.length, '条');
          } finally {
            cleanupTmp(tmpDir);
          }
        } catch (e) {
          console.log('[百炼PDF失败，回退本地]:', e.message);
          useFallback = true;
        }
      }

      if (useFallback || parsed.length === 0) {
        const { parsePdf } = require('../services/pdfParser');
        parsed = await parsePdf(req.file.path);
        if (parsed.length > 0) parser = 'local-pdf';
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
      const { parseBeihuoExcel } = require('../services/beihuoOrderParser');
      const beihuoParsed = parseBeihuoExcel(req.file.path);
      if (beihuoParsed.length > 0) {
        parsed = beihuoParsed;
        parser = 'beihuo-excel';
        console.log('[啤货表Excel解析] 解析结果:', parsed.length, '条');
      } else if (isXingxin) {
        parsed = parseXingxinOrderExcel(req.file.path);
        parser = 'xingxin-excel';
        console.log('[兴信生产单导入] 解析结果:', parsed.length, '条');
      } else {
        parsed = parseOrderExcel(req.file.path);
        parser = 'generic-excel';
        console.log('[Excel导入] 解析结果:', parsed.length, '条');
      }
      if (parsed.length === 0) {
        for (let i = 0; i < Math.min(rowsCheck.length, 5); i++) {
          console.log('[Excel] Row', i, ':', JSON.stringify(rowsCheck[i]).substring(0, 200));
        }
      }
    } else if (['.png', '.jpg', '.jpeg', '.bmp', '.webp'].includes(ext)) {
      try {
        const { parseImageOrderWithFallback } = require('../services/imageOrderPipeline');
        const imageResult = await parseImageOrderWithFallback(req.file.path, {
          recognitionMode: req.body.recognition_mode,
        });
        parsed = imageResult.orders;
        parser = imageResult.parser;
        aiReview = imageResult.aiReview;
      } catch (error) {
        return res.status(error.statusCode || 400).json({ message: error.message });
      }
    } else {
      return res.status(400).json({ message: '不支持的文件格式，仅支持PDF/Excel/图片' });
    }

    if (parsed.length === 0) {
      return res.status(400).json({ message: '未解析出订单数据，请检查文件格式和内容' });
    }

    const workshop = req.body.workshop || 'B';
    const defaults = {
      workshop,
      source_file: sourceFile,
      parser,
    };
    const previewRows = buildPreviewRows(parsed, defaults);
    const previewMode = String(req.body.preview || '') === '1'
      || String(req.body.preview || '').toLowerCase() === 'true';

    if (previewMode) {
      const errorCount = previewRows.filter((row) => !row.validation.valid).length;
      const warningCount = previewRows.reduce(
        (sum, row) => sum + row.validation.warnings.length,
        0
      );
      return res.json({
        message: '成功解析 ' + previewRows.length + ' 条订单，请核对后确认导入',
        count: previewRows.length,
        parser,
        source_file: sourceFile,
        ai_recheck_supported: ['.png', '.jpg', '.jpeg', '.bmp', '.webp'].includes(ext),
        ai_review: aiReview,
        orders: previewRows,
        summary: {
          errors: errorCount,
          warnings: warningCount,
        },
      });
    }

    const normalized = previewRows.map(({ validation, preview_id, ...row }) => row);
    const insertedIds = insertImportRows(normalized, { batch });
    res.json({
      message: '成功导入 ' + insertedIds.length + ' 条订单',
      count: insertedIds.length,
      added: insertedIds.length,
      inserted_ids: insertedIds,
      parser,
    });
  } catch (err) {
    res.status(500).json({ message: '导入失败：' + err.message });
  } finally {
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
  }
});

module.exports = router;
