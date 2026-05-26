import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ExcelJS from 'exceljs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_PATH = process.env.DATA_PATH || path.join(__dirname, '..', 'data');
const REPORTS_FILE = path.join(DATA_PATH, 'reports.json');
const UPLOAD_PATH = path.join(__dirname, '..', 'uploads');

function urlToLocal(url) {
  // 匹配可能带子路径前缀的 URL: /uploads/images/<id>/<file> 或 /qa-weekly-report/uploads/images/...
  const m = url && url.match(/\/uploads\/images\/([^/]+)\/([^/]+)$/);
  if (!m) return null;
  return path.join(UPLOAD_PATH, 'images', m[1], m[2]);
}

function safeSheetName(name, maxLen = 28) {
  return String(name).replace(/[\\/:*?\[\]]/g, '_').slice(0, maxLen);
}

const router = Router();

function readAll() {
  if (!fs.existsSync(REPORTS_FILE)) return [];
  return JSON.parse(fs.readFileSync(REPORTS_FILE, 'utf8'));
}
function writeAll(list) {
  fs.writeFileSync(REPORTS_FILE, JSON.stringify(list, null, 2), 'utf8');
}

function normalizeCustomer(r) {
  return {
    customerId: r.customerId || '',
    customerName: r.customerName || '未分类'
  };
}

router.get('/', (req, res) => {
  const wanted = req.query.customerId;
  let list = readAll();
  if (wanted !== undefined && wanted !== '') {
    list = list.filter(r => (r.customerId || '') === wanted);
  }
  const out = list.map(r => ({
    id: r.id,
    originalName: r.originalName,
    ...normalizeCustomer(r),
    uploadedAt: r.uploadedAt,
    weekKey: r.weekKey,
    year: r.year,
    week: r.week,
    totalRows: r.totalRows,
    failCount: r.failCount
  }));
  res.json({ ok: true, list: out });
});

router.get('/weeks/all', (_req, res) => {
  const list = readAll();
  const map = new Map();
  list.forEach(r => {
    if (!map.has(r.weekKey)) {
      map.set(r.weekKey, { weekKey: r.weekKey, year: r.year, week: r.week, reports: 0, totalRows: 0, totalFail: 0 });
    }
    const w = map.get(r.weekKey);
    w.reports++;
    w.totalRows += r.totalRows;
    w.totalFail += r.failCount;
  });
  const weeks = Array.from(map.values()).sort((a, b) => b.weekKey.localeCompare(a.weekKey));
  res.json({ ok: true, weeks });
});

// 客户 × 周 交叉表（默认最近 8 周；可 ?weeks=12）
router.get('/matrix', (req, res) => {
  const limit = Math.max(1, Math.min(52, parseInt(req.query.weeks, 10) || 8));
  const list = readAll();

  const weekSet = new Set();
  list.forEach(r => weekSet.add(r.weekKey));
  const allWeeks = Array.from(weekSet).sort((a, b) => b.localeCompare(a)).slice(0, limit);
  const weekIdx = new Set(allWeeks);

  const customerMap = new Map();
  list.forEach(r => {
    if (!weekIdx.has(r.weekKey)) return;
    const { customerId, customerName } = normalizeCustomer(r);
    const key = customerId || `__name__${customerName}`;
    if (!customerMap.has(key)) {
      customerMap.set(key, { customerId, customerName, cells: {} });
    }
    const row = customerMap.get(key);
    if (!row.cells[r.weekKey]) {
      row.cells[r.weekKey] = { reports: 0, totalFail: 0, totalRows: 0 };
    }
    row.cells[r.weekKey].reports += 1;
    row.cells[r.weekKey].totalFail += r.failCount;
    row.cells[r.weekKey].totalRows += r.totalRows;
  });

  const rows = Array.from(customerMap.values())
    .sort((a, b) => a.customerName.localeCompare(b.customerName, 'zh-CN'));

  res.json({ ok: true, weeks: allWeeks, rows });
});

router.get('/weekly/:weekKey', (req, res) => {
  const wantedCustomer = req.query.customerId;
  let list = readAll().filter(r => r.weekKey === req.params.weekKey);
  if (wantedCustomer !== undefined && wantedCustomer !== '') {
    list = list.filter(r => (r.customerId || '') === wantedCustomer);
  }
  const totalReports = list.length;
  const totalFail = list.reduce((s, r) => s + r.failCount, 0);
  const totalRows = list.reduce((s, r) => s + r.totalRows, 0);

  const byCustomer = new Map();
  list.forEach(r => {
    const c = normalizeCustomer(r);
    const cKey = c.customerId || `__name__${c.customerName}`;
    if (!byCustomer.has(cKey)) {
      byCustomer.set(cKey, { ...c, reports: 0, totalRows: 0, totalFail: 0 });
    }
    const bucket = byCustomer.get(cKey);
    bucket.reports += 1;
    bucket.totalRows += r.totalRows;
    bucket.totalFail += r.failCount;
  });

  // 返回每份报告的完整数据（含 sheets / failRows / imageGroups），让前端用统一的明细视图渲染
  const reports = list
    .slice()
    .sort((a, b) => (a.customerName || '').localeCompare(b.customerName || '', 'zh-CN')
      || new Date(b.uploadedAt) - new Date(a.uploadedAt))
    .map(r => ({ ...r, ...normalizeCustomer(r) }));

  res.json({
    ok: true,
    weekKey: req.params.weekKey,
    totalReports,
    totalRows,
    totalFail,
    customers: Array.from(byCustomer.values()).sort((a, b) => a.customerName.localeCompare(b.customerName, 'zh-CN')),
    reports
  });
});

// 导出整周为 Excel（含嵌入图片）
router.get('/weekly/:weekKey/export', async (req, res) => {
  try {
    const wantedCustomer = req.query.customerId;
    let list = readAll().filter(r => r.weekKey === req.params.weekKey);
    if (wantedCustomer !== undefined && wantedCustomer !== '') {
      list = list.filter(r => (r.customerId || '') === wantedCustomer);
    }

    const wb = new ExcelJS.Workbook();
    wb.created = new Date();
    wb.creator = 'QA Weekly Report System';

    // ===== 周报汇总 sheet =====
    const sum = wb.addWorksheet('周报汇总');
    sum.columns = [{ width: 18 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 12 }];

    const titleRow = sum.addRow([`QA 测试周报 — ${req.params.weekKey}`]);
    titleRow.font = { bold: true, size: 14 };
    sum.mergeCells(titleRow.number, 1, titleRow.number, 5);
    sum.addRow([`导出时间：${new Date().toLocaleString('zh-CN')}`]).font = { color: { argb: 'FF6B7280' } };
    sum.addRow([]);

    const totalFail = list.reduce((s, r) => s + r.failCount, 0);
    const totalRows = list.reduce((s, r) => s + r.totalRows, 0);
    const passRate = totalRows > 0 ? (((totalRows - totalFail) / totalRows) * 100).toFixed(2) + '%' : '—';

    [['报告数', list.length],
     ['有效行数总计', totalRows],
     ['不合格行数总计', totalFail],
     ['合格率', passRate]
    ].forEach(([k, v]) => {
      const r = sum.addRow([k, v]);
      r.getCell(1).font = { bold: true };
    });
    sum.addRow([]);

    // 按客户聚合
    const byCust = new Map();
    list.forEach(r => {
      const key = r.customerName || '未分类';
      if (!byCust.has(key)) byCust.set(key, { name: key, reports: 0, totalFail: 0, totalRows: 0 });
      const b = byCust.get(key);
      b.reports++; b.totalFail += r.failCount; b.totalRows += r.totalRows;
    });
    if (byCust.size > 0) {
      sum.addRow(['按客户聚合']).getCell(1).font = { bold: true, size: 12 };
      const hr = sum.addRow(['客户', '报告数', '不合格数', '有效行', '合格率']);
      hr.font = { bold: true };
      hr.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } }; });
      for (const c of byCust.values()) {
        const rate = c.totalRows > 0 ? (((c.totalRows - c.totalFail) / c.totalRows) * 100).toFixed(2) + '%' : '—';
        sum.addRow([c.name, c.reports, c.totalFail, c.totalRows, rate]);
      }
    }

    // ===== 每份报告一个 sheet =====
    let reportIdx = 0;
    for (const r of list) {
      reportIdx++;
      const name = safeSheetName(`${reportIdx}-${r.customerName || '未分类'}`, 28);
      const ws = wb.addWorksheet(name);
      ws.columns = [{ width: 8 }, { width: 18 }, { width: 14 }, { width: 8 }, { width: 8 }, { width: 8 }, { width: 50 }];

      const t = ws.addRow([r.originalName]);
      t.font = { bold: true, size: 13 };
      ws.mergeCells(t.number, 1, t.number, 7);
      [['客户', r.customerName],
       ['归属周', r.weekKey],
       ['不合格数', r.failCount],
       ['有效行数', r.totalRows],
       ['上传时间', new Date(r.uploadedAt).toLocaleString('zh-CN')]
      ].forEach(([k, v]) => {
        const row = ws.addRow([k, v]);
        row.getCell(1).font = { bold: true, color: { argb: 'FF6B7280' } };
      });
      ws.addRow([]);

      for (const sh of r.sheets) {
        if (!sh.failRows || sh.failRows.length === 0) continue;
        const shTitle = ws.addRow([`Sheet: ${sh.name}（${sh.totalRows} 行 / 不合格 ${sh.failRows.length} 行）`]);
        shTitle.font = { bold: true, size: 12, color: { argb: 'FF1F2937' } };
        ws.mergeCells(shTitle.number, 1, shTitle.number, 7);

        const hr = ws.addRow(['行号', ...sh.headers]);
        hr.font = { bold: true };
        hr.eachCell(c => {
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
          c.border = { bottom: { style: 'thin', color: { argb: 'FF9CA3AF' } } };
        });

        for (const fr of sh.failRows) {
          const row = ws.addRow([fr.rowNumber, ...fr.cells.map(c => c.value)]);
          fr.cells.forEach((c, i) => {
            if (c.isRed) {
              const cell = row.getCell(i + 2);
              cell.font = { color: { argb: 'FFDC2626' }, bold: true };
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF2F2' } };
            }
            row.getCell(i + 2).alignment = { wrapText: true, vertical: 'top' };
          });
        }
        ws.addRow([]);

        // 嵌入图片
        const allImgs = [
          ...(sh.imageGroups || []).flatMap(g => g.images.map(img => ({ ...img, label: `不合格行 ${g.rows.join('、')}` }))),
          ...(sh.orphanImages || []).map(img => ({ ...img, label: '其他附图' }))
        ];
        if (allImgs.length > 0) {
          // 按 label 分组
          const labelMap = new Map();
          for (const img of allImgs) {
            if (!labelMap.has(img.label)) labelMap.set(img.label, []);
            labelMap.get(img.label).push(img);
          }
          for (const [label, imgs] of labelMap) {
            const labelRow = ws.addRow([label + `（${imgs.length} 张）`]);
            labelRow.font = { bold: true, color: { argb: 'FF2563EB' } };
            ws.mergeCells(labelRow.number, 1, labelRow.number, 7);

            // 每行放 3 张图，每张占 2.5 列 × 12 行（约 200×160 px）
            const imgsPerRow = 3;
            const cellsWide = 2.5;
            const cellsTall = 12;
            const startRow = ws.rowCount; // 当前行下方开始（0-based row = rowCount）
            for (let i = 0; i < imgs.length; i++) {
              const localPath = urlToLocal(imgs[i].url);
              if (!localPath || !fs.existsSync(localPath)) continue;
              const ext = path.extname(localPath).slice(1).toLowerCase();
              const imageId = wb.addImage({
                filename: localPath,
                extension: ext === 'jpg' ? 'jpeg' : (ext || 'png')
              });
              const gridRow = Math.floor(i / imgsPerRow);
              const gridCol = i % imgsPerRow;
              const tlRow = startRow + gridRow * cellsTall;
              const tlCol = gridCol * cellsWide;
              ws.addImage(imageId, {
                tl: { col: tlCol, row: tlRow },
                ext: { width: 220, height: 180 }
              });
            }
            // 留出图片需要的空间
            const totalImgRows = Math.ceil(imgs.length / imgsPerRow) * cellsTall;
            for (let i = 0; i < totalImgRows; i++) ws.addRow([]);
            ws.addRow([]);
          }
        }
        ws.addRow([]);
      }
    }

    const fileName = `QA周报-${req.params.weekKey}${wantedCustomer ? '-客户筛选' : ''}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('[export weekly] error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message || '导出失败' });
    } else {
      res.end();
    }
  }
});

router.get('/:id', (req, res) => {
  const list = readAll();
  const r = list.find(x => x.id === req.params.id);
  if (!r) return res.status(404).json({ error: '未找到' });
  res.json({ ok: true, report: { ...r, ...normalizeCustomer(r) } });
});

router.delete('/:id', (req, res) => {
  const list = readAll();
  const idx = list.findIndex(x => x.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: '未找到' });
  list.splice(idx, 1);
  writeAll(list);
  res.json({ ok: true });
});

export default router;
