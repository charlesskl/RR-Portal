const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { parseExcelWithColors } = require('../services/color-reader');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.xlsx', '.xls'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('只支持 .xlsx 和 .xls 文件'));
    }
  },
});

router.post('/', upload.array('files', 50), async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: '请上传文件' });
  }
  const allResults = [];
  const errors = [];
  for (const file of req.files) {
    try {
      // 解码文件名（浏览器可能编码中文）
      let fileName = file.originalname;
      try { fileName = decodeURIComponent(fileName); } catch {}
      try { fileName = Buffer.from(fileName, 'latin1').toString('utf8'); } catch {}

      // 从文件名提取客名（如 "2025年zuru 92119" → "ZURU"）
      let clientFromFile = '';
      const match = fileName.match(/年\s*([a-zA-Z\u4e00-\u9fff]+)/);
      if (match) clientFromFile = match[1].toUpperCase();

      const results = await parseExcelWithColors(file.buffer, fileName);
      // 给每条结果加上从文件名提取的客名
      for (const r of results) {
        r.clientFromFile = clientFromFile;
      }
      allResults.push(...results);
    } catch (err) {
      errors.push({ file: file.originalname, error: err.message });
    }
  }
  res.json({
    total: allResults.length,
    newCount: allResults.filter(r => r.type === 'new').length,
    modifiedCount: allResults.filter(r => r.type === 'modified').length,
    results: allResults,
    errors,
  });
});

module.exports = router;
