const express = require('express');
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------
const PORT = parseInt(process.env.PORT, 10) || 3000;
const DATA_PATH = process.env.DATA_PATH || './data';

const CONFIG_FILE = path.join(DATA_PATH, 'config.json');
const INDEX_FILE = path.join(DATA_PATH, 'index.json');
const PRODUCTS_DIR = path.join(DATA_PATH, 'products');

// ---------------------------------------------------------------------------
// Default config
// ---------------------------------------------------------------------------
const DEFAULT_CONFIG = {
  factories: [
    { name: '华登', full_name: '东莞华登塑胶制品有限公司', logo: 'huadeng.png' },
    { name: '兴信', full_name: '东莞兴信塑胶制品有限公司', logo: 'xingxin.png' },
  ],
  engineers: [],
  suppliers: [],
};

// ---------------------------------------------------------------------------
// Ensure directories exist
// ---------------------------------------------------------------------------
function ensureDataDirs() {
  if (!fs.existsSync(DATA_PATH)) fs.mkdirSync(DATA_PATH, { recursive: true });
  if (!fs.existsSync(PRODUCTS_DIR)) fs.mkdirSync(PRODUCTS_DIR, { recursive: true });
}

ensureDataDirs();

// ---------------------------------------------------------------------------
// Data helpers — serialised write queue
// ---------------------------------------------------------------------------
let writeChain = Promise.resolve();

function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf-8');
  }
  const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
  return JSON.parse(raw);
}

function saveConfig(config) {
  writeChain = writeChain.then(() => {
    if (fs.existsSync(CONFIG_FILE)) {
      fs.copyFileSync(CONFIG_FILE, CONFIG_FILE + '.bak');
    }
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
  });
  return writeChain;
}

function loadIndex() {
  if (!fs.existsSync(INDEX_FILE)) {
    fs.writeFileSync(INDEX_FILE, JSON.stringify([], null, 2), 'utf-8');
  }
  const raw = fs.readFileSync(INDEX_FILE, 'utf-8');
  return JSON.parse(raw);
}

function saveIndex(index) {
  writeChain = writeChain.then(() => {
    if (fs.existsSync(INDEX_FILE)) {
      fs.copyFileSync(INDEX_FILE, INDEX_FILE + '.bak');
    }
    fs.writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2), 'utf-8');
  });
  return writeChain;
}

function loadProduct(id) {
  const productFile = path.join(PRODUCTS_DIR, `${id}.json`);
  if (!fs.existsSync(productFile)) return null;
  const raw = fs.readFileSync(productFile, 'utf-8');
  return JSON.parse(raw);
}

function saveProduct(product) {
  const productFile = path.join(PRODUCTS_DIR, `${product.id}.json`);
  writeChain = writeChain.then(() => {
    if (fs.existsSync(productFile)) {
      fs.copyFileSync(productFile, productFile + '.bak');
    }
    fs.writeFileSync(productFile, JSON.stringify(product, null, 2), 'utf-8');
  });
  return writeChain;
}

function deleteProduct(id) {
  const productFile = path.join(PRODUCTS_DIR, `${id}.json`);
  if (fs.existsSync(productFile)) {
    fs.unlinkSync(productFile);
  }
  const bakFile = productFile + '.bak';
  if (fs.existsSync(bakFile)) {
    fs.unlinkSync(bakFile);
  }
}

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------
const app = express();

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Static files
app.use(express.static(path.join(__dirname, 'public')));
app.use('/assets', express.static(path.join(__dirname, 'assets')));

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// ---------------------------------------------------------------------------
// Global error handler
// ---------------------------------------------------------------------------
app.use((err, _req, res, _next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`工程资料生成器 running on port ${PORT}`);
  console.log(`  Data path : ${path.resolve(DATA_PATH)}`);
});
