import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';

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

// 导出整周为 ZIP：含一份汇总 xlsx + 每份原始 QA 报告 xlsx（按客户分目录）
// 原始报告保留 100% 原格式（公司 header / 样板图 / 产品参数 / 测试表 / 产品照含圈 / Conclusion）
router.get('/weekly/:weekKey/export', async (req, res) => {
  try {
    const wantedCustomer = req.query.customerId;
    let list = readAll().filter(r => r.weekKey === req.params.weekKey);
    if (wantedCustomer !== undefined && wantedCustomer !== '') {
      list = list.filter(r => (r.customerId || '') === wantedCustomer);
    }

    const zip = new JSZip();

    // ===== 1. 周报汇总 xlsx（精简）：标题 + 统计 + 客户聚合 + 文件索引 =====
    const wb = new ExcelJS.Workbook();
    wb.created = new Date();
    wb.creator = 'QA Weekly Report System';
    const sum = wb.addWorksheet('周报汇总');
    sum.columns = [{ width: 50 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 12 }];

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
      sum.addRow([]);
    }

    // 报告列表 + zip 内文件路径索引
    sum.addRow(['本周报告（原始文件已附在压缩包内）']).getCell(1).font = { bold: true, size: 12 };
    const idxHr = sum.addRow(['ZIP 内路径', '客户', '不合格数', '有效行', '上传时间']);
    idxHr.font = { bold: true };
    idxHr.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } }; });

    // ===== 2. 把原始 xlsx 文件附到 zip（按客户分目录，处理同名冲突） =====
    const nameCounter = new Map();
    for (const r of list) {
      const srcPath = path.join(UPLOAD_PATH, r.storedName || '');
      if (!r.storedName || !fs.existsSync(srcPath)) {
        sum.addRow(['(原始文件不存在)', r.customerName, r.failCount, r.totalRows, new Date(r.uploadedAt).toLocaleString('zh-CN')]);
        continue;
      }
      const buf = fs.readFileSync(srcPath);
      const folderName = (r.customerName || '未分类').replace(/[\\/:*?"<>|]/g, '_');
      let fname = (r.originalName || 'report.xlsx').replace(/[\\/:*?"<>|]/g, '_');
      const dupKey = `${folderName}/${fname}`;
      const dupCount = nameCounter.get(dupKey) || 0;
      if (dupCount > 0) {
        const ext = path.extname(fname);
        const base = fname.slice(0, fname.length - ext.length);
        fname = `${base} (${dupCount + 1})${ext}`;
      }
      nameCounter.set(dupKey, dupCount + 1);
      const zipPath = `${folderName}/${fname}`;
      zip.file(zipPath, buf);
      sum.addRow([zipPath, r.customerName, r.failCount, r.totalRows, new Date(r.uploadedAt).toLocaleString('zh-CN')])
        .getCell(3).font = { color: { argb: 'FFDC2626' }, bold: true };
    }

    const sumBuf = await wb.xlsx.writeBuffer();
    zip.file(`周报汇总-${req.params.weekKey}.xlsx`, sumBuf);

    // ===== 3. 输出 zip =====
    const zipBuf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    const fileName = `QA周报-${req.params.weekKey}${wantedCustomer ? '-客户筛选' : ''}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    res.send(zipBuf);
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
