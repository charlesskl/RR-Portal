import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { customAlphabet } from 'nanoid';
import { parseExcelRedRows, groupImagesByFailRows } from '../lib/excel-parser.js';
import { buildProducts, diffLifecycle, normalizeProductNo, normalizeStage, summarizeProduct } from '../lib/lifecycle.js';
import { getCustomerById } from './customers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_PATH = process.env.DATA_PATH || path.join(__dirname, '..', 'data');
const UPLOAD_PATH = path.join(__dirname, '..', 'uploads');
const REPORTS_FILE = path.join(DATA_PATH, 'reports.json');

fs.mkdirSync(DATA_PATH, { recursive: true });
fs.mkdirSync(UPLOAD_PATH, { recursive: true });
if (!fs.existsSync(REPORTS_FILE)) fs.writeFileSync(REPORTS_FILE, '[]', 'utf8');

const nanoid = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 12);

const storage = multer.diskStorage({
  destination: UPLOAD_PATH,
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '.xlsx';
    cb(null, `${Date.now()}-${nanoid()}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.xlsx', '.xls', '.xlsm'].includes(ext)) cb(null, true);
    else cb(new Error('只支持 .xlsx / .xls / .xlsm 文件'));
  }
});

function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return { year: d.getUTCFullYear(), week, key: `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}` };
}

function decodeFilename(name) {
  try {
    return Buffer.from(name, 'latin1').toString('utf8');
  } catch {
    return name;
  }
}

const router = Router();

router.post('/', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: '没有收到文件' });
    const originalName = decodeFilename(req.file.originalname);
    const buffer = fs.readFileSync(req.file.path);
    const { sheets, rawImages, metadata } = await parseExcelRedRows(buffer, { fileName: originalName });

    const totalFail = sheets.reduce((s, sh) => s + sh.failCount, 0);
    const totalRows = sheets.reduce((s, sh) => s + sh.totalRows, 0);
    const now = new Date();
    const isoWeek = getISOWeek(now);

    const customerId = (req.body && req.body.customerId) ? String(req.body.customerId) : '';
    const customer = customerId ? getCustomerById(customerId) : null;
    if (customerId && !customer) {
      fs.rmSync(req.file.path, { force: true });
      return res.status(400).json({ error: '指定的客户不存在' });
    }

    const productNo = normalizeProductNo(metadata.productNo);
    const manualStage = normalizeStage(req.body && req.body.stage);
    const stage = manualStage || normalizeStage(metadata.stage);
    if (!productNo) {
      fs.rmSync(req.file.path, { force: true });
      return res.status(400).json({ error: '无法从报告中识别货号 / Product No，请检查报告格式' });
    }
    if (!stage) {
      fs.rmSync(req.file.path, { force: true });
      return res.status(400).json({ error: '无法识别测试阶段，请在上传时选择 FS / EP / EP1 / PE2 / FEP / PP / PS' });
    }

    const reportId = nanoid();

    // 保存图片到 uploads/images/<reportId>/
    // 子路径部署时由 BASE_PATH 注入，确保图片 URL 在门户内可访问。
    const BASE_PATH = (process.env.BASE_PATH || '/').replace(/\/$/, '');
    let savedImages = [];
    if (rawImages.length > 0) {
      const imgDir = path.join(UPLOAD_PATH, 'images', reportId);
      fs.mkdirSync(imgDir, { recursive: true });
      savedImages = rawImages.map((img, i) => {
        const fname = `img-${i + 1}.${img.extension}`;
        fs.writeFileSync(path.join(imgDir, fname), img.buffer);
        return {
          sheetName: img.sheetName,
          fromRow: img.fromRow,
          toRow: img.toRow,
          fromCol: img.fromCol,
          toCol: img.toCol,
          url: `${BASE_PATH}/uploads/images/${reportId}/${fname}`,
          filename: fname
        };
      });
    }

    // 按 sheet 分组图片：每张图片归到最近的 fail group；fail rows 之前的归"样板图"
    const slimImage = i => ({ url: i.url, fromRow: i.fromRow, toRow: i.toRow, fromCol: i.fromCol, toCol: i.toCol });
    sheets.forEach(sh => {
      const sheetImgs = savedImages.filter(im => im.sheetName === sh.name);
      const { groups, sampleImages, orphan } = groupImagesByFailRows(sh.failRows, sheetImgs);
      sh.imageGroups = groups.map(g => ({ rows: g.rows, images: g.images.map(slimImage) }));
      sh.sampleImages = sampleImages.map(slimImage);
      sh.orphanImages = orphan.map(slimImage);
      sh.imageCount = sheetImgs.length;
    });

    const report = {
      id: reportId,
      originalName,
      storedName: req.file.filename,
      customerId: customer ? customer.id : '',
      customerName: customer ? customer.name : '未分类',
      productNo,
      productName: metadata.productName,
      stage,
      stageSource: manualStage ? 'manual' : metadata.stageSource,
      reportDate: metadata.reportDate || now.toISOString(),
      uploadedBy: (req.body && req.body.uploader) || '',
      uploadedAt: now.toISOString(),
      weekKey: isoWeek.key,
      year: isoWeek.year,
      week: isoWeek.week,
      totalRows,
      failCount: totalFail,
      passCount: sheets.reduce((sum, sheet) => sum + (sheet.passCount || 0), 0),
      totalImages: savedImages.length,
      sheets
    };

    const list = fs.existsSync(REPORTS_FILE)
      ? JSON.parse(fs.readFileSync(REPORTS_FILE, 'utf8'))
      : [];
    const beforeProduct = buildProducts(list).find(product => product.productNo === productNo);
    list.unshift(report);
    fs.writeFileSync(REPORTS_FILE, JSON.stringify(list, null, 2), 'utf8');

    const afterProduct = buildProducts(list).find(product => product.productNo === productNo);
    const lifecycleChanges = diffLifecycle(beforeProduct, afterProduct);

    res.json({
      ok: true,
      report,
      product: summarizeProduct(afterProduct),
      lifecycleChanges
    });
  } catch (err) {
    console.error('[upload] error:', err);
    res.status(500).json({ error: err.message || '解析失败' });
  }
});

export default router;
