import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { customAlphabet } from 'nanoid';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_PATH = process.env.DATA_PATH || path.join(__dirname, '..', 'data');
const CUSTOMERS_FILE = path.join(DATA_PATH, 'customers.json');

fs.mkdirSync(DATA_PATH, { recursive: true });
if (!fs.existsSync(CUSTOMERS_FILE)) fs.writeFileSync(CUSTOMERS_FILE, '[]', 'utf8');

const nanoid = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 10);

function readAll() {
  if (!fs.existsSync(CUSTOMERS_FILE)) return [];
  return JSON.parse(fs.readFileSync(CUSTOMERS_FILE, 'utf8'));
}
function writeAll(list) {
  fs.writeFileSync(CUSTOMERS_FILE, JSON.stringify(list, null, 2), 'utf8');
}

const router = Router();

router.get('/', (_req, res) => {
  const list = readAll().sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  res.json({ ok: true, list });
});

router.post('/', (req, res) => {
  const name = (req.body && req.body.name ? String(req.body.name) : '').trim();
  if (!name) return res.status(400).json({ error: '客户名称不能为空' });
  if (name.length > 60) return res.status(400).json({ error: '客户名称过长' });
  const list = readAll();
  const dup = list.find(c => c.name === name);
  if (dup) return res.json({ ok: true, customer: dup, duplicated: true });
  const customer = { id: nanoid(), name, createdAt: new Date().toISOString() };
  list.push(customer);
  writeAll(list);
  res.json({ ok: true, customer });
});

router.delete('/:id', (req, res) => {
  const list = readAll();
  const idx = list.findIndex(c => c.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: '未找到' });
  list.splice(idx, 1);
  writeAll(list);
  res.json({ ok: true });
});

export function getCustomerById(id) {
  if (!id) return null;
  const list = readAll();
  return list.find(c => c.id === id) || null;
}

export default router;
