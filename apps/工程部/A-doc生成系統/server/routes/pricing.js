const express = require('express');
const { db }  = require('../config/db');
const { auditLog } = require('../middleware/audit');

const router = express.Router();

const ID_PATTERN = /^[a-f0-9]{24}$/;

function validateId(req, res, next) {
  if (!ID_PATTERN.test(req.params.id)) {
    return res.status(400).json({ message: '无效的记录ID' });
  }
  next();
}

const ALLOWED_FIELDS = [
  'productName', 'productId', 'status', 'customer', 'currency',
  'exchangeRate', 'pricingDate', 'remark', 'items', 'totalPrice',
  'prodNo', 'specifications', 'quantity', 'unit',
];

function pickFields(body) {
  const result = {};
  for (const key of ALLOWED_FIELDS) {
    if (body[key] !== undefined) result[key] = body[key];
  }
  return result;
}

// GET /api/pricings
router.get('/', (req, res) => {
  try {
    let items = db.pricings.find();
    if (req.query.status) items = items.filter(i => i.status === req.query.status);
    if (req.query.productId) items = items.filter(i => i.productId === req.query.productId);
    items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    items = items.map(item => {
      const product = item.productId ? db.products.findById(item.productId) : null;
      return { ...item, product: product ? { _id: product._id, name: product.name, prodNo: product.prodNo } : null };
    });
    res.json(items);
  } catch (err) {
    console.error('获取核价列表失败:', err);
    res.status(500).json({ message: '获取数据失败，请稍后重试' });
  }
});

// POST /api/pricings
router.post('/', (req, res) => {
  try {
    const data = pickFields(req.body);
    if (!data.productName) return res.status(400).json({ message: '产品名称不能为空' });
    const item = db.pricings.create({
      ...data,
      status: data.status || 'pending',
    });
    auditLog('pricing_create', req.user.id, { pricingId: item._id, productName: data.productName });
    res.status(201).json(item);
  } catch (err) {
    console.error('创建核价记录失败:', err);
    res.status(400).json({ message: '创建失败，请稍后重试' });
  }
});

// PUT /api/pricings/:id
router.put('/:id', validateId, (req, res) => {
  try {
    const item = db.pricings.findById(req.params.id);
    if (!item) return res.status(404).json({ message: '核价记录不存在' });
    const data = pickFields(req.body);
    const updated = db.pricings.update(req.params.id, data);
    auditLog('pricing_update', req.user.id, { pricingId: req.params.id });
    res.json(updated);
  } catch (err) {
    console.error('更新核价记录失败:', err);
    res.status(400).json({ message: '更新失败，请稍后重试' });
  }
});

// DELETE /api/pricings/:id
router.delete('/:id', validateId, (req, res) => {
  try {
    const item = db.pricings.findById(req.params.id);
    if (!item) return res.status(404).json({ message: '核价记录不存在' });
    db.pricings.delete(req.params.id);
    auditLog('pricing_delete', req.user.id, { pricingId: req.params.id, productName: item.productName });
    res.json({ message: '已删除' });
  } catch (err) {
    console.error('删除核价记录失败:', err);
    res.status(500).json({ message: '删除失败，请稍后重试' });
  }
});

module.exports = router;
