const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { PDFParse } = require('pdf-parse');
const { v4: uuidv4 } = require('uuid');
const { autoParse } = require('./parsers');
const { writeToExcel, detectType, detectWorkbookType, getExistingPOs } = require('./excel-writer');

const app = express();
const PORT = Number(process.env.PORT || 3200);
const HOST = process.env.HOST || '127.0.0.1';
const DATA_PATH = process.env.DATA_PATH || path.join(__dirname, 'data');

// Ensure data directories exist
const uploadsDir = path.join(DATA_PATH, 'uploads');
const exportsDir = path.join(DATA_PATH, 'exports');
[DATA_PATH, uploadsDir, exportsDir].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Multer config
const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
});
const uploadPDF = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('只支持PDF文件'));
  },
  limits: { fileSize: 20 * 1024 * 1024 },
});

app.use(express.json());
app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.use(express.static(path.join(__dirname, 'public')));

const uuidPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
for (const param of ['id', 'sessionId']) {
  app.param(param, (_req, res, next, value) => {
    if (!uuidPattern.test(value)) return res.status(400).json({ error: '无效会话编号' });
    next();
  });
}

// 全局异常捕获，防止未处理错误让服务器闪退
process.on('uncaughtException', (err) => {
  console.error('\n[未捕获异常]', err);
  console.error('服务器继续运行...\n');
});
process.on('unhandledRejection', (reason) => {
  console.error('\n[未处理的 Promise rejection]', reason);
  console.error('服务器继续运行...\n');
});

// 请求日志：任何API调用都会打印到 cmd 窗口，方便排查
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    const t = new Date().toLocaleTimeString('zh-CN');
    console.log(`[${t}] ${req.method} ${req.path}`);
    res.on('finish', () => {
      console.log(`[${t}]   → ${res.statusCode}`);
    });
  }
  next();
});

// ============================================================
// API: 批量上传并解析PO PDF
// ============================================================
app.post('/api/po/upload', uploadPDF.array('files', 50), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: '请上传至少一个PDF文件' });
    }

    const results = [];
    for (const file of req.files) {
      try {
        const buffer = fs.readFileSync(file.path);
        const parser = new PDFParse({ data: buffer });
        let pdf;
        try { pdf = await parser.getText(); } finally { await parser.destroy(); }
        const parsed = autoParse(pdf.text, file.originalname);
        parsed.fileId = path.basename(file.path, '.pdf');
        results.push(parsed);
      } catch (err) {
        results.push({
          filename: file.originalname,
          error: `解析失败: ${err.message}`,
          items: [],
        });
      }
    }

    // 如果已上传排期模板，检查哪些PO是修改单
    const { templateId } = req.body || {};
    if (templateId) {
      try {
        const templateFiles = fs.readdirSync(uploadsDir).filter(f => path.parse(f).name === templateId);
        if (templateFiles.length > 0) {
          const XLSX = require('xlsx');
          const raw = XLSX.readFile(path.join(uploadsDir, templateFiles[0]));
          const { type } = detectWorkbookType(raw);
          const existingPOs = getExistingPOs(raw, type);
          results.forEach(r => { if (existingPOs.has(r.poNumber)) r.isRevised = true; });
        }
      } catch (e) { /* ignore */ }
    }

    // Save session data
    const sessionId = uuidv4();
    const sessionFile = path.join(DATA_PATH, `session_${sessionId}.json`);
    fs.writeFileSync(sessionFile, JSON.stringify({ id: sessionId, results, createdAt: new Date().toISOString() }, null, 2));

    res.json({ sessionId, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// API: 获取解析结果
// ============================================================
app.get('/api/po/session/:id', (req, res) => {
  const sessionFile = path.join(DATA_PATH, `session_${req.params.id}.json`);
  if (!fs.existsSync(sessionFile)) {
    return res.status(404).json({ error: '会话不存在' });
  }
  const data = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
  res.json(data);
});

// ============================================================
// API: 更新解析结果（用户手动修正）
// ============================================================
app.put('/api/po/session/:id', (req, res) => {
  const sessionFile = path.join(DATA_PATH, `session_${req.params.id}.json`);
  if (!fs.existsSync(sessionFile)) {
    return res.status(404).json({ error: '会话不存在' });
  }
  const data = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
  data.results = req.body.results;
  data.updatedAt = new Date().toISOString();
  fs.writeFileSync(sessionFile, JSON.stringify(data, null, 2));
  res.json({ success: true });
});

// ============================================================
// API: 上传排期Excel模板
// ============================================================
app.post('/api/po/template', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: '请上传排期Excel文件' });

    if (path.extname(req.file.originalname).toLowerCase() !== '.xlsx') {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: '请先将原排期另存为 .xlsx 再上传，以保留完整工作簿' });
    }
    const templateId = path.basename(req.file.path, path.extname(req.file.path));
    const { type, sheets } = await detectType(req.file.path);

    res.json({ templateId, type, filename: req.file.originalname, sheets });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// API: 写入现有排期Excel（核心功能）
// ============================================================
app.post('/api/po/write/:sessionId', async (req, res) => {
  try {
    const { templateId, factory } = req.body;

    const sessionFile = path.join(DATA_PATH, `session_${req.params.sessionId}.json`);
    if (!fs.existsSync(sessionFile)) {
      return res.status(404).json({ error: '会话不存在' });
    }
    const session = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));

    const templateFiles = fs.readdirSync(uploadsDir).filter(f => path.parse(f).name === templateId);
    if (templateFiles.length === 0) {
      return res.status(404).json({ error: '排期模板文件不存在，请重新上传' });
    }
    const templatePath = path.join(uploadsDir, templateFiles[0]);

    // 用 exceljs 写入，保留原文件所有格式
    const { wb, type, orders } = await writeToExcel(templatePath, session.results, { factory });

    const exportFile = path.join(exportsDir, `排期_${uuidv4()}.xlsx`);
    if (type === 'skycastle') {
      await require('./paste-workbook').writePasteWorkbook(templatePath, exportFile, wb, orders);
    } else {
      await require('./full-workbook').writeFullWorkbook(templatePath, exportFile, wb, type, session.results, req.body.dateConfirmation);
    }

    res.download(exportFile, `${type === 'skycastle' ? '排期粘贴副本' : '排期_已入录'}_${new Date().toLocaleDateString('zh-CN')}.xlsx`, () => {
      try { fs.unlinkSync(exportFile); } catch (e) { /* ignore */ }
    });
  } catch (err) {
    if (err.token && err.changes) return res.status(409).json({error:err.message,dateConfirmation:err.token,changes:err.changes});
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// API: 导出为新Excel（备用）
// ============================================================
app.post('/api/po/export/:id', async (req, res) => {
  try {
    const sessionFile = path.join(DATA_PATH, `session_${req.params.id}.json`);
    if (!fs.existsSync(sessionFile)) {
      return res.status(404).json({ error: '会话不存在' });
    }
    const session = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
    const { format } = req.body;

    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('PO汇总');
    ws.addRow(['客户', 'PO号', '接单期', '出货期', '客PO号', '货号', '数量', '单价USD', '金额USD', '国家', '工厂', '备注']);
    session.results.forEach(po => {
      if (!po.items) return;
      po.items.forEach(item => {
        ws.addRow([po.client, po.poNumber, po.poDate || po.creationDate, item.dueDate, po.customerPO || '', item.partNo, item.quantity, item.unitPrice, item.amount, item.country, item.factory, item.remark || '']);
      });
    });

    const exportFile = path.join(exportsDir, `PO导出_${uuidv4()}.xlsx`);
    await wb.xlsx.writeFile(exportFile);

    res.download(exportFile, `PO排期导出_${new Date().toLocaleDateString('zh-CN')}.xlsx`, () => {
      try { fs.unlinkSync(exportFile); } catch (e) { /* ignore */ }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function excelDateSerial(dateStr) {
  // Convert "2026-01-28" to Excel date serial number
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d;
}

function buildTomyExcel(workbook, results, format) {
  // 总接单 sheet
  const ws1 = workbook.addWorksheet('总接单');
  ws1.columns = [
    { header: '接单日期', key: 'orderDate', width: 14 },
    { header: '国家', key: 'country', width: 12 },
    { header: 'Tomy PO', key: 'tomyPO', width: 14 },
    { header: 'Cust. PO NO.', key: 'custPO', width: 16 },
    { header: '货号', key: 'partNo', width: 14 },
    { header: '数量', key: 'qty', width: 10 },
    { header: 'PO走货期', key: 'dueDate', width: 14 },
    { header: '单价USD', key: 'unitPrice', width: 12 },
    { header: '金额USD', key: 'amount', width: 14 },
    { header: '金额HKD', key: 'amountHKD', width: 14 },
    { header: '车间', key: 'factory', width: 10 },
  ];

  // Style header
  styleHeader(ws1);

  // 总排期 sheet
  const ws2 = workbook.addWorksheet('总排期');
  ws2.columns = [
    { header: '接单期', key: 'orderDate', width: 14 },
    { header: '国家', key: 'country', width: 12 },
    { header: '客名', key: 'clientName', width: 28 },
    { header: '客跟单', key: 'handler', width: 10 },
    { header: 'Tomy PO', key: 'tomyPO', width: 14 },
    { header: 'Cust. PO NO.', key: 'custPO', width: 16 },
    { header: '货号', key: 'partNo', width: 14 },
    { header: '产品名称', key: 'productName', width: 20 },
    { header: '数量', key: 'qty', width: 10 },
    { header: '外箱', key: 'cartonPack', width: 8 },
    { header: '总箱数', key: 'totalCartons', width: 10 },
    { header: '走货期', key: 'dueDate', width: 14 },
    { header: '验货期', key: 'inspDate', width: 14 },
    { header: '备注', key: 'remark', width: 30 },
    { header: '单价USD', key: 'unitPrice', width: 12 },
    { header: '金额USD', key: 'amount', width: 14 },
    { header: '金额HKD', key: 'amountHKD', width: 14 },
    { header: '是否入系统', key: 'inSystem', width: 12 },
    { header: '车间', key: 'factory', width: 10 },
  ];
  styleHeader(ws2);

  const isIndonesia = format === 'tomy_indonesia';

  results.forEach(po => {
    if (po.client !== 'TOMY' || po.error) return;
    po.items.forEach(item => {
      // Filter by factory
      if (isIndonesia && item.factory !== '印尼') return;
      if (!isIndonesia && item.factory === '印尼') return;

      const row1Data = {
        orderDate: excelDateSerial(po.poDate),
        country: item.country,
        tomyPO: po.poNumber,
        custPO: po.customerPO,
        partNo: item.partNo,
        qty: item.quantity,
        dueDate: excelDateSerial(item.dueDate),
        unitPrice: item.unitPrice,
        amount: item.amount,
        amountHKD: Math.round(item.amount * 7.75 * 100) / 100,
        factory: item.factory === '印尼' ? '印尼' : '',
      };
      ws1.addRow(row1Data);

      const row2Data = {
        orderDate: excelDateSerial(po.poDate),
        country: item.country,
        clientName: '',
        handler: '',
        tomyPO: po.poNumber,
        custPO: po.customerPO,
        partNo: item.partNo,
        productName: item.description,
        qty: item.quantity,
        cartonPack: '',
        totalCartons: '',
        dueDate: excelDateSerial(item.dueDate),
        inspDate: '',
        remark: '',
        unitPrice: item.unitPrice,
        amount: item.amount,
        amountHKD: Math.round(item.amount * 7.75 * 100) / 100,
        inSystem: '',
        factory: item.factory === '印尼' ? '印尼' : '',
      };
      ws2.addRow(row2Data);
    });
  });

  // Format date columns
  [ws1, ws2].forEach(ws => {
    ws.eachRow((row, rowNum) => {
      if (rowNum === 1) return;
      row.eachCell(cell => {
        if (cell.value instanceof Date) {
          cell.numFmt = 'yyyy/mm/dd';
        }
      });
    });
  });
}

function buildSkyCastleExcel(workbook, results) {
  // 总接单 sheet
  const ws1 = workbook.addWorksheet('总接单');
  ws1.columns = [
    { header: '接单期', key: 'orderDate', width: 14 },
    { header: '出货期', key: 'shipDate', width: 14 },
    { header: 'CUSTOMER PO', key: 'custPO', width: 16 },
    { header: 'PO号', key: 'poNumber', width: 18 },
    { header: '货号', key: 'partNo', width: 16 },
    { header: '数量', key: 'qty', width: 10 },
    { header: '单价USD', key: 'unitPrice', width: 12 },
    { header: '金额USD', key: 'amount', width: 14 },
    { header: '金额HKD', key: 'amountHKD', width: 14 },
  ];
  styleHeader(ws1);

  // 排期明细 sheet
  const ws2 = workbook.addWorksheet('排期明细');
  ws2.columns = [
    { header: '接单期', key: 'orderDate', width: 14 },
    { header: '客名', key: 'clientName', width: 24 },
    { header: '国家', key: 'country', width: 12 },
    { header: 'CUSTOMER PO', key: 'custPO', width: 16 },
    { header: 'PO号', key: 'poNumber', width: 18 },
    { header: '货号', key: 'partNo', width: 16 },
    { header: '产品名称', key: 'productName', width: 30 },
    { header: '数量', key: 'qty', width: 10 },
    { header: '客PO期（订单）', key: 'poDate', width: 14 },
    { header: 'RR回复出货期', key: 'shipDate', width: 14 },
    { header: '备注', key: 'remark', width: 30 },
    { header: '单价USD', key: 'unitPrice', width: 12 },
    { header: '金额USD', key: 'amount', width: 14 },
    { header: '金额HKD', key: 'amountHKD', width: 14 },
  ];
  styleHeader(ws2);

  results.forEach(po => {
    if (po.client !== 'Sky Castle' || po.error) return;

    // Extract customer PO from filename if needed
    const filenamePO = po.poNumber || '';

    po.items.forEach(item => {
      ws1.addRow({
        orderDate: excelDateSerial(po.creationDate),
        shipDate: excelDateSerial(po.shippingDate || item.dueDate),
        custPO: '',
        poNumber: filenamePO,
        partNo: item.partNo,
        qty: item.quantity,
        unitPrice: item.unitPrice,
        amount: item.amount,
        amountHKD: Math.round(item.amount * 7.75 * 100) / 100,
      });

      ws2.addRow({
        orderDate: excelDateSerial(po.creationDate),
        clientName: 'Sky Castle Toys, LLC',
        country: item.country,
        custPO: '',
        poNumber: filenamePO,
        partNo: item.partNo,
        productName: item.description,
        qty: item.quantity,
        poDate: excelDateSerial(po.shippingDate || item.dueDate),
        shipDate: excelDateSerial(po.shippingDate || item.dueDate),
        remark: po.notes || '',
        unitPrice: item.unitPrice,
        amount: item.amount,
        amountHKD: Math.round(item.amount * 7.75 * 100) / 100,
      });
    });
  });

  [ws1, ws2].forEach(ws => {
    ws.eachRow((row, rowNum) => {
      if (rowNum === 1) return;
      row.eachCell(cell => {
        if (cell.value instanceof Date) {
          cell.numFmt = 'yyyy/mm/dd';
        }
      });
    });
  });
}

function buildGenericExcel(workbook, results) {
  const ws = workbook.addWorksheet('PO汇总');
  ws.columns = [
    { header: '客户', key: 'client', width: 16 },
    { header: 'PO号', key: 'poNumber', width: 16 },
    { header: '接单期', key: 'orderDate', width: 14 },
    { header: '出货期', key: 'dueDate', width: 14 },
    { header: '客PO号', key: 'custPO', width: 16 },
    { header: '货号', key: 'partNo', width: 14 },
    { header: '产品描述', key: 'description', width: 30 },
    { header: '数量', key: 'qty', width: 10 },
    { header: '单价USD', key: 'unitPrice', width: 12 },
    { header: '金额USD', key: 'amount', width: 14 },
    { header: '国家', key: 'country', width: 12 },
    { header: '工厂', key: 'factory', width: 10 },
    { header: '来源文件', key: 'filename', width: 30 },
  ];
  styleHeader(ws);

  results.forEach(po => {
    if (po.error) return;
    po.items.forEach(item => {
      ws.addRow({
        client: po.client,
        poNumber: po.poNumber,
        orderDate: excelDateSerial(po.poDate || po.creationDate),
        dueDate: excelDateSerial(item.dueDate),
        custPO: po.customerPO || '',
        partNo: item.partNo,
        description: item.description,
        qty: item.quantity,
        unitPrice: item.unitPrice,
        amount: item.amount,
        country: item.country,
        factory: item.factory,
        filename: po.filename,
      });
    });
  });

  ws.eachRow((row, rowNum) => {
    if (rowNum === 1) return;
    row.eachCell(cell => {
      if (cell.value instanceof Date) {
        cell.numFmt = 'yyyy/mm/dd';
      }
    });
  });
}

function styleHeader(ws) {
  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
  headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
  headerRow.height = 22;
  ws.autoFilter = { from: 'A1', to: { row: 1, column: ws.columns.length } };
}

// ============================================================
// API: 历史记录
// ============================================================
app.get('/api/po/history', (req, res) => {
  try {
    const files = fs.readdirSync(DATA_PATH)
      .filter(f => f.startsWith('session_') && f.endsWith('.json'))
      .map(f => {
        const data = JSON.parse(fs.readFileSync(path.join(DATA_PATH, f), 'utf8'));
        return {
          id: data.id,
          createdAt: data.createdAt,
          totalPOs: data.results.length,
          totalItems: data.results.reduce((sum, r) => sum + (r.items ? r.items.length : 0), 0),
          clients: [...new Set(data.results.map(r => r.client).filter(Boolean))],
        };
      })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json(files);
  } catch (err) {
    res.json([]);
  }
});

// ============================================================
// Start server
// ============================================================
app.listen(PORT, HOST, () => {
  console.log(`PO智能识别系统运行中: http://127.0.0.1:${PORT}`);
  if (process.platform === 'win32' && process.env.AUTO_OPEN !== '0') {
    require('child_process').exec(`start http://127.0.0.1:${PORT}`);
  }
}).on('error', (err) => {
  console.error('Server error:', err.message);
  process.exitCode = 1;
});
