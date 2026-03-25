const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const archiver = require('archiver');

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
// API Routes — Products
// ---------------------------------------------------------------------------

// GET /api/products — List products with optional search/engineer filter
app.get('/api/products', (req, res) => {
  let index = loadIndex();
  const { search, engineer } = req.query;
  if (search) {
    const s = search.toLowerCase();
    index = index.filter(p =>
      (p.product_number || '').toLowerCase().includes(s) ||
      (p.product_name || '').toLowerCase().includes(s) ||
      (p.client_name || '').toLowerCase().includes(s)
    );
  }
  if (engineer) {
    index = index.filter(p => p.engineer === engineer);
  }
  // Sort by updated_at descending
  index.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
  res.json(index);
});

// GET /api/products/:id — Get full product
app.get('/api/products/:id', (req, res) => {
  const product = loadProduct(req.params.id);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  res.json(product);
});

// POST /api/products — Create product
app.post('/api/products', async (req, res) => {
  const { factory, product_number, product_name } = req.body;
  if (!factory || !product_number || !product_name) {
    return res.status(400).json({ error: 'factory, product_number, product_name are required' });
  }

  const now = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const product = {
    id: uuidv4(),
    factory: factory,
    product_number: product_number,
    product_name: product_name,
    client_name: req.body.client_name || '',
    order_qty: req.body.order_qty || null,
    age_grade: req.body.age_grade || '',
    engineer: req.body.engineer || '',
    created_at: now,
    updated_at: now,
    parts: req.body.parts || [],
    purchases: req.body.purchases || [],
    dimensions: req.body.dimensions || {
      packing_method: '', inner_box_material: '', outer_box_material: '',
      product: { stage: '', width: null, depth: null, height: null, weight_kg: null },
      package: { stage: '', width: null, depth: null, height_with_hook: null, height_no_hook: null, gross_weight_kg: null },
      display: { width: null, depth: null, closed_height: null, open_height: null, total_weight_kg: null },
      inner_carton_order: { width: null, depth: null, height: null, nw_kg: null, gw_kg: null },
      inner_carton_measure: { width: null, depth: null, height: null, nw_kg: null, gw_kg: null },
      outer_carton_order: { width: null, depth: null, height: null, nw_kg: null, gw_kg: null },
      outer_carton_measure: { width: null, depth: null, height: null, nw_kg: null, gw_kg: null }
    },
    production_notes: req.body.production_notes || {
      product_intro: '', function_desc: '', test_requirements: '',
      injection_notes: '', assembly_notes: '', packaging_notes: ''
    },
    work_instructions: req.body.work_instructions || []
  };

  await saveProduct(product);

  // Add to index
  const index = loadIndex();
  index.push({
    id: product.id,
    product_number: product.product_number,
    product_name: product.product_name,
    client_name: product.client_name,
    factory: product.factory,
    engineer: product.engineer,
    created_at: product.created_at,
    updated_at: product.updated_at
  });
  await saveIndex(index);

  res.status(201).json(product);
});

// PUT /api/products/:id — Update product (merge)
app.put('/api/products/:id', async (req, res) => {
  const existing = loadProduct(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Product not found' });

  // Merge top-level fields
  const updated = { ...existing, ...req.body, id: existing.id, created_at: existing.created_at };
  updated.updated_at = new Date().toISOString().slice(0, 10);

  await saveProduct(updated);

  // Update index entry
  const index = loadIndex();
  const idx = index.findIndex(p => p.id === updated.id);
  if (idx !== -1) {
    index[idx] = {
      id: updated.id,
      product_number: updated.product_number,
      product_name: updated.product_name,
      client_name: updated.client_name,
      factory: updated.factory,
      engineer: updated.engineer,
      created_at: updated.created_at,
      updated_at: updated.updated_at
    };
    await saveIndex(index);
  }

  res.json(updated);
});

// DELETE /api/products/:id — Delete product
app.delete('/api/products/:id', async (req, res) => {
  const existing = loadProduct(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Product not found' });

  deleteProduct(req.params.id);

  const index = loadIndex();
  const filtered = index.filter(p => p.id !== req.params.id);
  await saveIndex(filtered);

  res.json({ success: true });
});

// ---------------------------------------------------------------------------
// API Routes — Copy
// ---------------------------------------------------------------------------

// POST /api/products/:id/copy — Deep copy product with new ID
app.post('/api/products/:id/copy', async (req, res) => {
  const source = loadProduct(req.params.id);
  if (!source) return res.status(404).json({ error: 'Product not found' });

  const now = new Date().toISOString().slice(0, 10);
  const copy = JSON.parse(JSON.stringify(source)); // Deep clone
  copy.id = uuidv4();
  copy.product_number = ''; // Clear for user to fill
  copy.created_at = now;
  copy.updated_at = now;

  await saveProduct(copy);

  const index = loadIndex();
  index.push({
    id: copy.id,
    product_number: copy.product_number,
    product_name: copy.product_name + ' (副本)',
    client_name: copy.client_name,
    factory: copy.factory,
    engineer: copy.engineer,
    created_at: copy.created_at,
    updated_at: copy.updated_at
  });
  await saveIndex(index);

  res.status(201).json(copy);
});

// ---------------------------------------------------------------------------
// API Routes — Config
// ---------------------------------------------------------------------------

// GET /api/config — Get config
app.get('/api/config', (req, res) => {
  res.json(loadConfig());
});

// PUT /api/config — Update config
app.put('/api/config', async (req, res) => {
  await saveConfig(req.body);
  res.json(req.body);
});

// ---------------------------------------------------------------------------
// API Routes — Generate Excel
// ---------------------------------------------------------------------------
const moldTable = require('./generators/mold-table');
const cartonSpec = require('./generators/carton-spec');
const purchaseList = require('./generators/purchase-list');
const productionNotes = require('./generators/production-notes');
const workInstructions = require('./generators/work-instructions');

const GENERATORS = {
  mold: { gen: moldTable, suffix: '排模表' },
  carton: { gen: cartonSpec, suffix: '外箱资料' },
  purchase: { gen: purchaseList, suffix: '外购清单' },
  notes: { gen: productionNotes, suffix: '生产注意事项' },
  sop: { gen: workInstructions, suffix: '作业指导书' },
};

// Generate all → ZIP download
app.post('/api/products/:id/generate', async (req, res) => {
  try {
    const product = loadProduct(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });

    const config = loadConfig();
    const factory = config.factories.find(f => f.name === product.factory) || config.factories[0];

    const zipName = `${product.product_number}_${product.product_name}_工程资料.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(zipName)}`);

    const archive = archiver('zip', { zlib: { level: 5 } });
    archive.pipe(res);

    for (const [key, { gen, suffix }] of Object.entries(GENERATORS)) {
      const wb = await gen.generate(product, factory);
      const buffer = await wb.xlsx.writeBuffer();
      const fileName = `${product.product_number} ${product.product_name}${suffix}.xlsx`;
      archive.append(buffer, { name: fileName });
    }

    await archive.finalize();
  } catch (err) {
    console.error('Generate error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to generate Excel files' });
    }
  }
});

// Generate single document
app.post('/api/products/:id/generate/:type', async (req, res) => {
  try {
    const { type } = req.params;
    if (!GENERATORS[type]) return res.status(400).json({ error: 'Invalid type. Valid: ' + Object.keys(GENERATORS).join(', ') });

    const product = loadProduct(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });

    const config = loadConfig();
    const factory = config.factories.find(f => f.name === product.factory) || config.factories[0];
    const { gen, suffix } = GENERATORS[type];

    const wb = await gen.generate(product, factory);
    const buffer = await wb.xlsx.writeBuffer();
    const fileName = `${product.product_number} ${product.product_name}${suffix}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    res.send(Buffer.from(buffer));
  } catch (err) {
    console.error('Generate error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to generate Excel file' });
    }
  }
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
