const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { db }  = require('../config/db');
const { processZouhuoFile, processZouhuoFilePair } = require('../zouhuo-logic');
const { generateExport, generateTemplate } = require('../excel-export');
const { generateBom } = require('../utils/bomGenerator');
const { auditLog } = require('../middleware/audit');

const router = express.Router();

const maxFileSize = (parseInt(process.env.MAX_FILE_SIZE_MB) || 50) * 1024 * 1024;

const UPLOADS_DIR = process.pkg
  ? path.join(path.dirname(process.execPath), 'uploads')
  : path.join(__dirname, '..', 'uploads');

const upload = multer({
  dest: UPLOADS_DIR,
  fileFilter: (req, file, cb) => {
    const safeName = path.basename(file.originalname);
    file.originalname = safeName;
    const extOk = /\.(xlsx|xlsm|xls)$/i.test(safeName);
    const mimeOk = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'application/vnd.ms-excel.sheet.macroEnabled.12',
      'application/octet-stream',
    ].includes(file.mimetype);
    const ok = extOk && mimeOk;
    cb(ok ? null : new Error('只支持 xlsx/xlsm/xls 文件'), ok);
  },
  limits: { fileSize: maxFileSize },
});

const ID_PATTERN = /^[a-f0-9]{24}$/;

function validateId(req, res, next) {
  if (!ID_PATTERN.test(req.params.id)) {
    return res.status(400).json({ message: '无效的记录ID' });
  }
  next();
}

// GET /api/products
router.get('/products', (req, res) => {
  try {
    const products = db.products.find();
    products.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json(products);
  } catch (err) {
    console.error('获取产品列表失败:', err);
    res.status(500).json({ message: '获取数据失败，请稍后重试' });
  }
});

// GET /api/products/:id/rows
router.get('/products/:id/rows', validateId, (req, res) => {
  try {
    const product = db.products.findById(req.params.id);
    if (!product) return res.status(404).json({ message: '记录不存在' });
    const rows = db.rows.find({ productId: req.params.id });
    rows.sort((a, b) => a.seq - b.seq);
    res.json({ product, rows });
  } catch (err) {
    console.error('获取明细行失败:', err);
    res.status(500).json({ message: '获取数据失败，请稍后重试' });
  }
});

// POST /api/upload
router.post('/upload', upload.array('file', 10), async (req, res) => {
  const tmpFiles = (req.files || []).map(f => f.path);
  try {
    if (!req.files || req.files.length === 0) return res.status(400).json({ message: '请选择文件' });

    let result;
    const productName = req.body.productName || req.files[0].originalname.replace(/\.(xlsx|xlsm|xls)$/i, '');

    if (req.files.length === 1) {
      result = await processZouhuoFile(fs.readFileSync(tmpFiles[0]));
    } else {
      const buffers = req.files.map((f, i) => ({
        buffer: fs.readFileSync(tmpFiles[i]),
        fileName: f.originalname,
      }));
      result = await processZouhuoFilePair(buffers);
    }

    const fileNames = req.files.map(f => f.originalname).join(' + ');
    const finalName = result.productName || productName;
    const product = db.products.create({
      name: finalName,
      prodNo: result.prodNo,
      productName: result.productName,
      fileName: fileNames,
      sheetNames: result.sheetNames,
      stats: result.stats,
    });

    for (const row of result.rows) {
      db.rows.create({ productId: product._id, ...row });
    }

    auditLog('upload', req.user.id, { productId: product._id, name: finalName, files: fileNames });

    res.json({
      message: `处理成功！共生成 ${result.stats.total} 条走货明细（排模 ${result.stats.mold} 条，外购 ${result.stats.purchase} 条）`,
      product,
      stats: result.stats,
    });
  } catch (err) {
    console.error('文件处理失败:', err);
    res.status(400).json({ message: '文件处理失败，请检查文件格式是否正确' });
  } finally {
    tmpFiles.forEach(f => { try { fs.unlinkSync(f); } catch {} });
  }
});

// GET /api/products/:id/export
router.get('/products/:id/export', validateId, async (req, res) => {
  try {
    const product = db.products.findById(req.params.id);
    if (!product) return res.status(404).json({ message: '记录不存在' });
    const rows = db.rows.find({ productId: req.params.id });
    rows.sort((a, b) => a.seq - b.seq);

    const buffer = await generateExport(product, rows);
    const fileName = encodeURIComponent(`${product.name}_走货明细.xlsx`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${fileName}`);
    res.send(buffer);
  } catch (err) {
    console.error('导出失败:', err);
    res.status(500).json({ message: '导出失败，请稍后重试' });
  }
});

// GET /api/products/:id/bom
router.get('/products/:id/bom', validateId, async (req, res) => {
  try {
    const product = db.products.findById(req.params.id);
    if (!product) return res.status(404).json({ message: '记录不存在' });
    const rows = db.rows.find({ productId: req.params.id });
    rows.sort((a, b) => a.seq - b.seq);
    const buffer = await generateBom(rows);
    const fileName = encodeURIComponent(`${product.name}_BOM图.xlsx`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${fileName}`);
    res.send(buffer);
  } catch (err) {
    console.error('BOM图导出失败:', err);
    res.status(500).json({ message: 'BOM图导出失败，请稍后重试' });
  }
});

// GET /api/template
router.get('/template', async (req, res) => {
  try {
    const buffer = await generateTemplate();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''%E8%B5%B0%E8%B4%A7%E6%98%8E%E7%BB%86%E6%A8%A1%E6%9D%BF.xlsx");
    res.send(buffer);
  } catch (err) {
    console.error('模板下载失败:', err);
    res.status(500).json({ message: '模板下载失败，请稍后重试' });
  }
});

// DELETE /api/products/:id
router.delete('/products/:id', validateId, (req, res) => {
  try {
    const product = db.products.findById(req.params.id);
    if (!product) return res.status(404).json({ message: '记录不存在' });

    const rows = db.rows.find({ productId: req.params.id });
    rows.forEach(row => db.rows.delete(row._id));
    db.products.delete(req.params.id);

    auditLog('delete', req.user.id, { productId: req.params.id, name: product.name });

    res.json({ message: '已删除' });
  } catch (err) {
    console.error('删除失败:', err);
    res.status(500).json({ message: '删除失败，请稍后重试' });
  }
});

// POST /api/merge
router.post('/merge', (req, res) => {
  try {
    const { ids, name } = req.body;
    if (!Array.isArray(ids) || ids.length < 2 || ids.length > 20) {
      return res.status(400).json({ message: '请选择2-20条记录合并' });
    }
    if (!ids.every(id => ID_PATTERN.test(id))) {
      return res.status(400).json({ message: '无效的记录ID' });
    }
    if (name !== undefined && (typeof name !== 'string' || name.trim().length === 0 || name.length > 200)) {
      return res.status(400).json({ message: '合并名称不合法' });
    }

    let allRows = [];
    let prodNo = '';
    const fileNames = [];
    const sheetNames = [];
    const productNames = [];

    for (const id of ids) {
      const product = db.products.findById(id);
      if (!product) return res.status(404).json({ message: `记录 ${id} 不存在` });
      if (product.prodNo) prodNo = product.prodNo;
      productNames.push(product.name);
      fileNames.push(product.fileName || '');
      if (product.sheetNames) sheetNames.push(...product.sheetNames);
      const rows = db.rows.find({ productId: id });
      allRows.push(...rows);
    }

    const moldRows     = allRows.filter(r => r.type === 'mold');
    const purchaseRows = allRows.filter(r => r.type === 'purchase');
    const merged = [...moldRows, ...purchaseRows];
    merged.forEach((r, i) => { r.seq = i + 1; });

    const newProduct = db.products.create({
      name: name || productNames.join(' + '),
      prodNo,
      fileName: fileNames.join(' + '),
      sheetNames,
      stats: { total: merged.length, mold: moldRows.length, purchase: purchaseRows.length },
    });

    for (const row of merged) {
      const { _id, productId, createdAt, updatedAt, ...rowData } = row;
      db.rows.create({ productId: newProduct._id, ...rowData });
    }

    allRows.forEach(r => db.rows.delete(r._id));
    ids.forEach(id => db.products.delete(id));

    auditLog('merge', req.user.id, { ids, newProductId: newProduct._id, name: newProduct.name });

    res.json({ message: `合并成功，共 ${merged.length} 条`, product: newProduct });
  } catch (err) {
    console.error('合并失败:', err);
    res.status(500).json({ message: '合并失败，请稍后重试' });
  }
});

module.exports = router;
