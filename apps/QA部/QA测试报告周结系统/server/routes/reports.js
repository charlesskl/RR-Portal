import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ExcelJS from 'exceljs';
import { copySheet, copySheetImages } from '../lib/sheet-copy.js';
import { extractAnnotatedImages } from '../lib/xlsx-images.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_PATH = process.env.DATA_PATH || path.join(__dirname, '..', 'data');
const REPORTS_FILE = path.join(DATA_PATH, 'reports.json');
const UPLOAD_PATH = path.join(__dirname, '..', 'uploads');

function urlToLocal(url) {
  // 兼容子路径前缀: /uploads/images/<id>/<file> 或 /qa-weekly-report/uploads/images/...
  const m = url && url.match(/\/uploads\/images\/([^/]+)\/([^/]+)$/);
  if (!m) return null;
  return path.join(UPLOAD_PATH, 'images', m[1], m[2]);
}

function safeSheetName(name, maxLen = 28) {
  return String(name).replace(/[\\/:*?\[\]]/g, '_').slice(0, maxLen);
}

function getISOWeekKey(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return {
    key: `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`,
    year: d.getUTCFullYear(),
    week
  };
}

// 从今天往前倒推，生成最近 N 个 ISO 周的 key 列表（新 → 旧）
function recentWeekKeys(n) {
  const keys = [];
  const seen = new Set();
  const today = new Date();
  let i = 0;
  while (keys.length < n && i < n * 2 + 7) {
    const d = new Date(today);
    d.setDate(d.getDate() - i * 7);
    const { key } = getISOWeekKey(d);
    if (!seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
    i++;
  }
  return keys;
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
// 周列表按"今天往前倒推 N 周"生成，没数据的周也显示空列
router.get('/matrix', (req, res) => {
  const limit = Math.max(1, Math.min(52, parseInt(req.query.weeks, 10) || 8));
  const list = readAll();

  const allWeeks = recentWeekKeys(limit);
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

// 导出整周为单个 xlsx：第一个 sheet 是"周报汇总"，后面把每份原 QA 报告的所有 sheet 深复制过来
// 保留原 QA 报告布局：公司 header / 产品信息表 / 样板图 / 测试结果表（红字不合格）/ 产品照含黄圈 / Conclusion
router.get('/weekly/:weekKey/export', async (req, res) => {
  try {
    const wantedCustomer = req.query.customerId;
    let list = readAll().filter(r => r.weekKey === req.params.weekKey);
    if (wantedCustomer !== undefined && wantedCustomer !== '') {
      list = list.filter(r => (r.customerId || '') === wantedCustomer);
    }

    const destWb = new ExcelJS.Workbook();
    destWb.created = new Date();
    destWb.creator = 'QA Weekly Report System';

    // ===== 1. 周报汇总 sheet =====
    const sum = destWb.addWorksheet('周报汇总');
    sum.columns = [{ width: 50 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }];
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
      const row = sum.addRow([k, v]);
      row.getCell(1).font = { bold: true };
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
      sum.addRow([]);
    }

    // 报告索引
    sum.addRow(['本周报告（详细内容见后续 sheet）']).getCell(1).font = { bold: true, size: 12 };
    const idxHr = sum.addRow(['原文件名', '客户', '不合格数', '有效行', '上传时间']);
    idxHr.font = { bold: true };
    idxHr.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } }; });
    list.forEach(r => {
      const row = sum.addRow([r.originalName, r.customerName, r.failCount, r.totalRows, new Date(r.uploadedAt).toLocaleString('zh-CN')]);
      row.getCell(3).font = { color: { argb: 'FFDC2626' }, bold: true };
    });

    // ===== 2. 每份原报告：深复制其所有 sheet（含图片+椭圆标注） =====
    let reportIdx = 0;
    for (const r of list) {
      reportIdx++;
      const srcPath = path.join(UPLOAD_PATH, r.storedName || '');
      if (!r.storedName || !fs.existsSync(srcPath)) continue;
      const buf = fs.readFileSync(srcPath);

      // 提取该 xlsx 的图片（含椭圆覆盖）
      let annotated = [];
      try { annotated = await extractAnnotatedImages(buf); } catch (e) {
        console.warn('[export] annotate failed for', r.originalName, e.message);
      }
      const annotatedByAnchor = new Map();
      annotated.forEach(im => {
        // xlsx-images 给的 fromRow 是 1-based + Math.floor(row)+1，对应 Math.floor(tl.row) 是 row-1
        const key = `${(im.sheetName || '').trim()}|${im.fromRow - 1}|${im.fromCol - 1}`;
        annotatedByAnchor.set(key, im);
      });

      const srcWb = new ExcelJS.Workbook();
      try { await srcWb.xlsx.load(buf); } catch (e) {
        console.warn('[export] xlsx.load failed for', r.originalName, e.message);
        continue;
      }

      srcWb.eachSheet((srcSheet) => {
        if (srcSheet.state === 'hidden' || srcSheet.state === 'veryHidden') return;
        const destName = safeSheetName(`${reportIdx}.${(r.customerName || '').slice(0, 6)}-${srcSheet.name}`, 31);
        // 同名再补 reportIdx 后缀避免冲突
        const finalName = destWb.getWorksheet(destName)
          ? safeSheetName(`${destName}_${reportIdx}`, 31)
          : destName;
        const destSheet = destWb.addWorksheet(finalName);

        try {
          copySheet(srcSheet, destSheet);
          // 用 trim 匹配（fast-xml-parser 会去 trailing 空格）
          const annoForThisSheet = new Map();
          annotatedByAnchor.forEach((v, k) => {
            if (k.startsWith(`${srcSheet.name.trim()}|`)) annoForThisSheet.set(k, v);
          });
          copySheetImages(srcWb, srcSheet, destWb, destSheet, annoForThisSheet);
        } catch (e) {
          console.warn(`[export] copy sheet '${srcSheet.name}' failed:`, e.message);
        }
      });
    }

    const fileName = `QA周报-${req.params.weekKey}${wantedCustomer ? '-客户筛选' : ''}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    await destWb.xlsx.write(res);
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
