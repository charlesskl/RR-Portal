'use strict';
const express  = require('express');
const multer   = require('multer');
const path     = require('path');
const { parseTomyPDF }  = require('../utils/pdfParser');
const { generateAdoc }  = require('../utils/adocGenerator');

const router = express.Router();

// Use memory storage so we don't need to manage temp files
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf' || path.extname(file.originalname).toLowerCase() === '.pdf') {
      cb(null, true);
    } else {
      cb(new Error('只允许上传 PDF 文件'));
    }
  },
});

/**
 * POST /api/adoc/parse
 * Upload a TOMY substance watch PDF, parse it, return list of materials and all records.
 */
router.post('/parse', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: '请上传 PDF 文件' });
    const records = await parseTomyPDF(req.file.buffer);

    // Build map of materialCode → { description, count }
    const materialMap = {};
    for (const r of records) {
      if (!materialMap[r.materialCode]) {
        materialMap[r.materialCode] = { code: r.materialCode, description: r.materialDescription, count: 0 };
      }
      materialMap[r.materialCode].count++;
    }

    res.json({
      totalRecords: records.length,
      materials: Object.values(materialMap).sort((a, b) => a.code.localeCompare(b.code)),
      records,
    });
  } catch (err) {
    console.error('PDF parse error:', err);
    res.status(500).json({ message: `解析失败: ${err.message}` });
  }
});

/**
 * POST /api/adoc/generate
 * Body: { records: [...], materialCode, supplierName }
 * Returns a Word document (.docx).
 */
router.post('/generate', express.json({ limit: '10mb' }), async (req, res) => {
  try {
    const { records, materialCode, supplierName } = req.body;
    const signerName = req.user?.realName || req.user?.username || '';
    if (!records || !records.length) return res.status(400).json({ message: '没有数据' });

    const filtered = materialCode
      ? records.filter(r => r.materialCode === materialCode)
      : records;

    const materialDesc = filtered[0]?.materialDescription || materialCode || 'material';
    const buf = await generateAdoc(filtered, supplierName || '', materialDesc, signerName);

    const filename = `TOMY A-DOC ${materialCode || 'all'}.docx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.send(buf);
  } catch (err) {
    console.error('ADOC generate error:', err);
    res.status(500).json({ message: `生成失败: ${err.message}` });
  }
});

module.exports = router;
