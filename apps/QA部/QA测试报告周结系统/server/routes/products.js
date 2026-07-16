import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { STAGES, buildProducts, normalizeProductNo, summarizeProduct } from '../lib/lifecycle.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_PATH = process.env.DATA_PATH || path.join(__dirname, '..', 'data');
const REPORTS_FILE = path.join(DATA_PATH, 'reports.json');

function readAll() {
  if (!fs.existsSync(REPORTS_FILE)) return [];
  return JSON.parse(fs.readFileSync(REPORTS_FILE, 'utf8'));
}

const router = Router();

router.get('/', (req, res) => {
  let reports = readAll();
  const customerId = String(req.query.customerId || '');
  const query = String(req.query.q || '').trim().toUpperCase();
  if (customerId) reports = reports.filter(report => String(report.customerId || '') === customerId);

  let products = buildProducts(reports);
  if (query) {
    products = products.filter(product =>
      product.productNo.includes(query) ||
      String(product.productName || '').toUpperCase().includes(query) ||
      String(product.customerName || '').toUpperCase().includes(query)
    );
  }
  res.json({ ok: true, stages: STAGES, list: products.map(summarizeProduct) });
});

router.get('/:productNo', (req, res) => {
  const productNo = normalizeProductNo(decodeURIComponent(req.params.productNo));
  const product = buildProducts(readAll()).find(item => item.productNo === productNo);
  if (!product) return res.status(404).json({ error: '未找到该货号的产品记录' });

  const reports = product.reports.map(report => ({
    id: report.id,
    originalName: report.originalName,
    customerId: report.customerId,
    customerName: report.customerName,
    productNo: report.productNo,
    productName: report.productName,
    stage: report.stage,
    reportDate: report.reportDate,
    uploadedAt: report.uploadedAt,
    failCount: report.failCount,
    passCount: report.passCount || 0,
    totalImages: report.totalImages || 0
  }));

  res.json({
    ok: true,
    stages: STAGES,
    product: {
      ...summarizeProduct(product),
      reports,
      issues: product.issues,
      openIssues: product.openIssues,
      resolvedIssues: product.resolvedIssues
    }
  });
});

export default router;
