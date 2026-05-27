import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { customAlphabet } from 'nanoid';
import { parseExcelRedRows, groupImagesByFailRows } from '../lib/excel-parser.js';
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
    const buffer = fs.readFileSync(req.file.path);
    const { sheets, rawImages } = await parseExcelRedRows(buffer);

    const totalFail = sheets.reduce((s, sh) => s + sh.failCount, 0);
    const totalRows = sheets.reduce((s, sh) => s + sh.totalRows, 0);
    const now = new Date();
    const isoWeek = getISOWeek(now);

    const customerId = (req.body && req.body.customerId) ? String(req.body.customerId) : '';
    const customer = customerId ? getCustomerById(customerId) : null;
    if (customerId && !customer) {
      return res.status(400).json({ error: '指定的客户不存在' });
    }

    const reportId = nanoid();

    // 保存图片到 uploads/images/<reportId>/
    // BASE_PATH 默认 '/'，子路径部署（如 /qa-weekly-report/）时由环境变量注入，确保返回给前端的 URL 包含子路径前缀
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
      originalName: decodeFilename(req.file.originalname),
      storedName: req.file.filename,
      customerId: customer ? customer.id : '',
      customerName: customer ? customer.name : '未分类',
      uploadedBy: (req.body && req.body.uploader) || '',
      uploadedAt: now.toISOString(),
      weekKey: isoWeek.key,
      year: isoWeek.year,
      week: isoWeek.week,
      totalRows,
      failCount: totalFail,
      totalImages: savedImages.length,
      sheets
    };

    const list = fs.existsSync(REPORTS_FILE)
      ? JSON.parse(fs.readFileSync(REPORTS_FILE, 'utf8'))
      : [];
    list.unshift(report);
    fs.writeFileSync(REPORTS_FILE, JSON.stringify(list, null, 2), 'utf8');

    res.json({ ok: true, report });
  } catch (err) {
    console.error('[upload] error:', err);
    res.status(500).json({ error: err.message || '解析失败' });
  }
});

export default router;
