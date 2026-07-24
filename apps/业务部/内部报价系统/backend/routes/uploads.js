const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const UPLOAD_ROOT = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(path.join(UPLOAD_ROOT, 'mold'), { recursive: true });

const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const dir = path.join(UPLOAD_ROOT, 'mold');
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().replace(/[^.\w]/g, '');
    const safeExt = ['.png', '.jpg', '.jpeg', '.webp'].includes(ext) ? ext : '.png';
    const ts = Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    cb(null, ts + safeExt);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /^image\/(png|jpe?g|webp)$/.test(file.mimetype);
    cb(ok ? null : new Error('仅支持 png/jpg/webp'), ok);
  },
});

// 按文件头(magic bytes)校验真实类型：防止伪造 Content-Type 上传非图片
function isRealImage(buf) {
  if (!buf || buf.length < 12) return false;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return true;            // PNG
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return true;                                // JPEG
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return true;   // WEBP
  return false;
}

// POST /api/uploads/mold-image  multipart field "file" — 工程上传模具图（同时被喷油/装配复用）
router.post('/mold-image', requireAuth, upload.single('file'), (req, res) => {
  if (!['engineering', 'painting', 'assembly', 'molding', 'slush', 'sales'].includes(req.user.dept) && req.user.role !== 'admin') {
    if (req.file) { try { fs.unlinkSync(req.file.path); } catch {} }
    return res.status(403).json({ error: '无权上传' });
  }
  if (!req.file) return res.status(400).json({ error: '缺少文件' });
  // 文件头校验：不是真图片就删掉并拒绝（伪造 mimetype 防线）
  try {
    const head = fs.readFileSync(req.file.path).subarray(0, 12);
    if (!isRealImage(head)) {
      try { fs.unlinkSync(req.file.path); } catch {}
      return res.status(400).json({ error: '文件不是有效图片(png/jpg/webp)' });
    }
  } catch {
    return res.status(400).json({ error: '文件读取失败' });
  }
  res.json({ url: 'uploads/mold/' + req.file.filename });
});

// POST /api/uploads/mold-sheet  解析"模具报价单&合同"型 xlsx → 返回 molds[]
// 不持久化 — 前端预览后由用户决定是否合并入 payload.molds
const memUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});
const { parseWorkbook } = require('../services/parseMoldSheet');
const { extractImagesByRow } = require('../services/extractXlsxImages');
router.post('/mold-sheet', requireAuth, memUpload.single('file'), async (req, res) => {
  if (req.user.dept !== 'engineering' && req.user.role !== 'admin') return res.status(403).json({ error: '仅工程或超级管理员可上传' });
  if (!req.file) return res.status(400).json({ error: '缺少文件' });
  if (!/\.(xls|xlsx)$/i.test(req.file.originalname)) {
    return res.status(400).json({ error: '当前只支持 .xls/.xlsx（PDF/图片待后续支持）' });
  }
  try {
    const result = parseWorkbook(req.file.buffer);
    if (result.error) return res.status(422).json(result);

    // xlsx 才尝试抽图（.xls 二进制不支持嵌入图提取）
    if (/\.xlsx$/i.test(req.file.originalname)) {
      try {
        const moldImgDir = path.join(UPLOAD_ROOT, 'mold');
        const anchored = await extractImagesByRow(req.file.buffer, moldImgDir);
        // anchored[].row = xlsx 0-based 行号；解析器已为每副模具记录 _rows=[起始,结束] 0-based 行范围
        // 直接按行范围归属（适用于有/无"模号"列两种表格）
        let assigned = 0;
        for (const img of anchored) {
          for (let mi = 0; mi < result.molds.length; mi++) {
            const range = result.molds[mi]._rows;
            if (!range) continue;
            if (img.row >= range[0] && img.row <= range[1]) {
              result.molds[mi].images = result.molds[mi].images || [];
              result.molds[mi].images.push('uploads/mold/' + img.file);
              const part = (result.molds[mi].parts || []).find(p => p._row === img.row);
              if (part) {
                part.images = part.images || [];
                part.images.push('uploads/mold/' + img.file);
              }
              assigned++;
              break;
            }
          }
        }
        result.images_extracted = anchored.length;
        if (anchored.length && !assigned) result.images_hint = `抽取到 ${anchored.length} 张图片但未能按行归位（图片锚点行=${anchored.map(a => a.row).join(',')}）。`;
      } catch (e) {
        result.images_extract_error = e.message;
      }
    } else {
      result.images_hint = '当前文件是 .xls 旧二进制格式，图片无法自动抽取。请在 WPS/Excel 里"另存为 → .xlsx"后重新上传即可自动识图。';
    }
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: '解析失败: ' + e.message });
  }
});

// POST /api/uploads/hardware-sheet  五金/外购件报价单 → 返回 items[]
const { parseWorkbook: parseHardwareWorkbook } = require('../services/parseHardwareSheet');
router.post('/hardware-sheet', requireAuth, memUpload.single('file'), async (req, res) => {
  if (!['engineering', 'sales'].includes(req.user.dept) && req.user.role !== 'admin') {
    return res.status(403).json({ error: '仅 工程/业务/超级管理员 可上传' });
  }
  if (!req.file) return res.status(400).json({ error: '缺少文件' });
  if (!/\.(xls|xlsx)$/i.test(req.file.originalname)) {
    return res.status(400).json({ error: '当前只支持 .xls/.xlsx' });
  }
  try {
    const result = await parseHardwareWorkbook(req.file.buffer);
    if (result.error) return res.status(422).json(result);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: '解析失败: ' + e.message });
  }
});

// POST /api/uploads/sewing-sheet  车缝报价单 xlsx → 返回 groups[]
const { parseWorkbook: parseSewingWorkbook } = require('../services/parseSewingSheet');
router.post('/sewing-sheet', requireAuth, memUpload.single('file'), async (req, res) => {
  if (!['sewing', 'sales', 'engineering'].includes(req.user.dept) && req.user.role !== 'admin') {
    return res.status(403).json({ error: '仅 车缝/业务/工程/超级管理员 可上传' });
  }
  if (!req.file) return res.status(400).json({ error: '缺少文件' });
  if (!/\.(xls|xlsx)$/i.test(req.file.originalname)) {
    return res.status(400).json({ error: '当前只支持 .xls/.xlsx' });
  }
  try {
    const result = await parseSewingWorkbook(req.file.buffer);
    if (result.error) return res.status(422).json(result);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: '解析失败: ' + e.message });
  }
});

// POST /api/uploads/electronic-sheet  电子报价单 xlsx → 返回 parts + extras
const { parseWorkbook: parseElectronicWorkbook } = require('../services/parseElectronicSheet');
router.post('/electronic-sheet', requireAuth, memUpload.single('file'), async (req, res) => {
  if (!['electronic', 'sales', 'engineering'].includes(req.user.dept) && req.user.role !== 'admin') {
    return res.status(403).json({ error: '仅 电子部/业务/工程/超级管理员 可上传' });
  }
  if (!req.file) return res.status(400).json({ error: '缺少文件' });
  if (!/\.(xls|xlsx)$/i.test(req.file.originalname)) {
    return res.status(400).json({ error: '当前只支持 .xls/.xlsx' });
  }
  try {
    const result = await parseElectronicWorkbook(req.file.buffer);
    if (result.error) return res.status(422).json(result);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: '解析失败: ' + e.message });
  }
});

// POST /api/uploads/electronic-lianxiang-sheet  联翔电子报价单 xlsx → 返回 parts + 报价摘要
const { parseWorkbook: parseLianxiangElectronicWorkbook } = require('../services/parseLianxiangElectronicSheet');
router.post('/electronic-lianxiang-sheet', requireAuth, memUpload.single('file'), async (req, res) => {
  if (!['electronic', 'sales', 'engineering'].includes(req.user.dept) && req.user.role !== 'admin') {
    return res.status(403).json({ error: '仅 电子部/业务/工程/超级管理员 可上传' });
  }
  if (!req.file) return res.status(400).json({ error: '缺少文件' });
  if (!/\.(xls|xlsx)$/i.test(req.file.originalname)) {
    return res.status(400).json({ error: '当前只支持 .xls/.xlsx' });
  }
  try {
    const result = await parseLianxiangElectronicWorkbook(req.file.buffer);
    if (result.error) return res.status(422).json(result);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: '解析失败: ' + e.message });
  }
});

// POST /api/uploads/assembly-sheet  生产排拉工序表 xlsx → 返回 { meta, steps }
const { parseWorkbook: parseAssemblyWorkbook } = require('../services/parseAssemblySheet');
router.post('/assembly-sheet', requireAuth, memUpload.single('file'), async (req, res) => {
  if (!['assembly', 'sales', 'engineering'].includes(req.user.dept) && req.user.role !== 'admin') {
    return res.status(403).json({ error: '仅 装配部/业务/工程/超级管理员 可上传' });
  }
  if (!req.file) return res.status(400).json({ error: '缺少文件' });
  if (!/\.(xls|xlsx)$/i.test(req.file.originalname)) return res.status(400).json({ error: '只支持 .xls/.xlsx' });
  try {
    const result = await parseAssemblyWorkbook(req.file.buffer);
    if (result.error) return res.status(422).json(result);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: '解析失败: ' + e.message });
  }
});

// POST /api/uploads/painting-sheet  喷油核价表 xlsx → 返回 { meta, items }
const { parseWorkbook: parsePaintingWorkbook } = require('../services/parsePaintingSheet');
router.post('/painting-sheet', requireAuth, memUpload.single('file'), async (req, res) => {
  if (!['painting', 'sales', 'engineering'].includes(req.user.dept) && req.user.role !== 'admin') {
    return res.status(403).json({ error: '仅 喷油部/业务/工程/超级管理员 可上传' });
  }
  if (!req.file) return res.status(400).json({ error: '缺少文件' });
  if (!/\.(xls|xlsx)$/i.test(req.file.originalname)) return res.status(400).json({ error: '只支持 .xls/.xlsx' });
  try {
    const result = await parsePaintingWorkbook(req.file.buffer);
    if (result.error) return res.status(422).json(result);

    // xlsx 才抽内嵌图，按锚点行号归到对应工序行（_row=0-based 源行号）
    if (/\.xlsx$/i.test(req.file.originalname)) {
      try {
        const moldImgDir = path.join(UPLOAD_ROOT, 'mold');
        const anchored = await extractImagesByRow(req.file.buffer, moldImgDir);
        let assigned = 0;
        for (const img of anchored) {
          // 先精确匹配同一行，否则归到锚点行上方最近的工序行（差 ≤2 行）
          let it = result.items.find(x => x._row === img.row);
          if (!it) {
            it = result.items
              .filter(x => x._row <= img.row && img.row - x._row <= 2)
              .sort((a, b) => b._row - a._row)[0];
          }
          if (it) { (it.images = it.images || []).push('uploads/mold/' + img.file); assigned++; }
        }
        result.images_extracted = anchored.length;
        if (anchored.length && !assigned) result.images_hint = `抽取到 ${anchored.length} 张图片但未能按行归位（锚点行=${anchored.map(a => a.row).join(',')}）。`;
      } catch (e) {
        result.images_extract_error = e.message;
      }
    } else {
      result.images_hint = '当前是 .xls 旧二进制格式，图片无法自动抽取。请另存为 .xlsx 后重新上传。';
    }
    result.items.forEach(it => { delete it._row; });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: '解析失败: ' + e.message });
  }
});

// POST /api/uploads/slush-sheet  搪胶报价模板 xlsx → 返回 { items, count, sheets_used }
const { parseWorkbook: parseSlushWorkbook } = require('../services/parseSlushSheet');
router.post('/slush-sheet', requireAuth, memUpload.single('file'), async (req, res) => {
  if (!['slush', 'sales', 'engineering'].includes(req.user.dept) && req.user.role !== 'admin') {
    return res.status(403).json({ error: '仅 搪胶/业务/工程/超级管理员 可上传' });
  }
  if (!req.file) return res.status(400).json({ error: '缺少文件' });
  if (!/\.(xls|xlsx)$/i.test(req.file.originalname)) return res.status(400).json({ error: '只支持 .xls/.xlsx' });
  try {
    const result = await parseSlushWorkbook(req.file.buffer);
    if (result.error) return res.status(422).json(result);

    if (/\.xlsx$/i.test(req.file.originalname)) {
      try {
        const moldImgDir = path.join(UPLOAD_ROOT, 'mold');
        const anchored = await extractImagesByRow(req.file.buffer, moldImgDir);
        // 标准模板每个工作簿只有一张有效核价卡；将卡片内图片归入该产品。
        if (result.items.length === 1) {
          result.items[0].images = anchored.map(img => 'uploads/mold/' + img.file);
        }
        result.images_extracted = anchored.length;
        if (anchored.length && result.items.length > 1) {
          result.images_hint = '工作簿含多张有效搪胶核价卡，图片无法可靠区分工作表，请应用后手工核对图片。';
        }
      } catch (error) {
        result.images_extract_error = error.message;
      }
    } else {
      result.images_hint = '当前是 .xls 旧二进制格式，图片无法自动抽取。请另存为 .xlsx 后重新上传。';
    }
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: '解析失败: ' + error.message });
  }
});

module.exports = router;
