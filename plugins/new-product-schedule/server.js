const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const XLSX = require('xlsx');

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------
const PORT = parseInt(process.env.PORT, 10) || 3000;
const DATA_PATH = process.env.DATA_PATH || './data';
const DATA_FILE = path.join(DATA_PATH, 'data.json');
const BACKUP_FILE = path.join(DATA_PATH, 'data.json.bak');
const UPLOADS_DIR = path.resolve(DATA_PATH, '..', 'uploads');

// ---------------------------------------------------------------------------
// Default data structure
// ---------------------------------------------------------------------------
const DEFAULT_DATA = {
  workshops: ['兴信A', '兴信B', '华登'],
  customers: [
    'ZURU', 'JAZWARES', 'Moose', 'TOMY', 'Tigerhead', 'Zanzoon(嘉苏)',
    'AZAD', 'Brybelly +Entertoymen', 'Lifelines', 'ToyMonster', 'Cepia',
    'Tikino', 'Sky Castle', 'Masterkidz', 'John Adams', '智海鑫',
    'PWP(多美）', 'CareFocus',
  ],
  supervisors: [
    '易东存', '段新辉', '蒙海欢', '唐海林', '万志勇',
    '章发东', '王玉国', '甘勇辉', '刘际维',
  ],
  projects: [],
};

// ---------------------------------------------------------------------------
// Ensure directories exist
// ---------------------------------------------------------------------------
function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

ensureDir(DATA_PATH);
ensureDir(UPLOADS_DIR);

// ---------------------------------------------------------------------------
// Data helpers — serialised write queue
// ---------------------------------------------------------------------------
let writeChain = Promise.resolve();

function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(DEFAULT_DATA, null, 2), 'utf-8');
  }
  const raw = fs.readFileSync(DATA_FILE, 'utf-8');
  return JSON.parse(raw);
}

function saveData(data) {
  writeChain = writeChain.then(() => {
    // Backup before writing
    if (fs.existsSync(DATA_FILE)) {
      fs.copyFileSync(DATA_FILE, BACKUP_FILE);
    }
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
  });
  return writeChain;
}

// ---------------------------------------------------------------------------
// Progress / status helpers
// ---------------------------------------------------------------------------
const STAGE_ORDER = [
  'dev_start', 'fs', 'ep', 'fep', 'pp',
  'bom_plastic', 'bom_purchase', 'po1_date',
];

/**
 * Parse a date-like string. For EP/PP fields that may contain multiple dates
 * (multi-round), extract all dates and return the LAST one.
 */
function parseLastDate(val) {
  if (!val) return null;
  const str = String(val);
  const regex = /(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/g;
  let match;
  let last = null;
  while ((match = regex.exec(str)) !== null) {
    const d = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    if (!isNaN(d.getTime())) last = d;
  }
  return last;
}

function isDatePast(dateStr) {
  const d = parseLastDate(dateStr);
  if (!d) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d <= today;
}

/**
 * Determine current stage status for a project.
 * Returns { currentStage, status } where status is one of:
 *   completed | in_progress | delayed | not_started
 */
function getProjectStatus(project) {
  const schedule = project.schedule || {};
  let lastCompletedIdx = -1;

  for (let i = 0; i < STAGE_ORDER.length; i++) {
    const stage = STAGE_ORDER[i];
    const val = schedule[stage];
    if (val && isDatePast(val)) {
      lastCompletedIdx = i;
    }
  }

  // All stages completed
  if (lastCompletedIdx === STAGE_ORDER.length - 1) {
    return { currentStage: 'po1_date', status: 'completed' };
  }

  // Check for delay: po1_date past but not all stages done
  if (schedule.po1_date && isDatePast(schedule.po1_date) && lastCompletedIdx < STAGE_ORDER.length - 1) {
    return { currentStage: STAGE_ORDER[lastCompletedIdx + 1], status: 'delayed' };
  }

  // Check if a filled-in date has passed but the next stage has no progress
  for (let i = 0; i < STAGE_ORDER.length - 1; i++) {
    const stage = STAGE_ORDER[i];
    const val = schedule[stage];
    if (val && isDatePast(val)) {
      const nextStage = STAGE_ORDER[i + 1];
      const nextVal = schedule[nextStage];
      if (!nextVal || !isDatePast(nextVal)) {
        // Check if the date of this stage is past and next has no progress
        if (isDatePast(val)) {
          const nextDate = parseLastDate(nextVal);
          if (!nextDate) {
            // If the completed date is more than a reasonable time ago, could be delayed
            // For now, mark in_progress unless po1_date is past
          }
        }
      }
    }
  }

  if (lastCompletedIdx >= 0) {
    const nextIdx = lastCompletedIdx + 1;
    if (nextIdx < STAGE_ORDER.length) {
      const nextStage = STAGE_ORDER[nextIdx];
      const nextVal = schedule[nextStage];
      // If the next stage has a date that's past but we didn't count it as completed,
      // that shouldn't happen. If next date exists but is future, it's in_progress.
      return { currentStage: nextStage, status: 'in_progress' };
    }
  }

  // Nothing completed yet
  if (!schedule.dev_start) {
    return { currentStage: 'dev_start', status: 'not_started' };
  }
  return { currentStage: 'dev_start', status: 'in_progress' };
}

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------
const app = express();

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Static files
const publicDir = path.join(__dirname, 'public');
ensureDir(publicDir);
app.use(express.static(publicDir));

// Uploaded images
app.use('/uploads', express.static(UPLOADS_DIR));

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// ---------------------------------------------------------------------------
// Config API
// ---------------------------------------------------------------------------
app.get('/api/config', (_req, res) => {
  const data = loadData();
  res.json({
    workshops: data.workshops,
    customers: data.customers,
    supervisors: data.supervisors,
  });
});

app.put('/api/config', async (req, res) => {
  const data = loadData();
  const { workshops, customers, supervisors } = req.body;

  const isStringArray = (v) => Array.isArray(v) && v.every((i) => typeof i === 'string');

  if (workshops !== undefined) {
    if (!isStringArray(workshops)) return res.status(400).json({ error: 'workshops must be a string array' });
    data.workshops = workshops;
  }
  if (customers !== undefined) {
    if (!isStringArray(customers)) return res.status(400).json({ error: 'customers must be a string array' });
    data.customers = customers;
  }
  if (supervisors !== undefined) {
    if (!isStringArray(supervisors)) return res.status(400).json({ error: 'supervisors must be a string array' });
    data.supervisors = supervisors;
  }

  await saveData(data);
  res.json({
    workshops: data.workshops,
    customers: data.customers,
    supervisors: data.supervisors,
  });
});

// ---------------------------------------------------------------------------
// Projects API
// ---------------------------------------------------------------------------

// List with optional filters
app.get('/api/projects', (req, res) => {
  const data = loadData();
  let projects = data.projects || [];

  const { workshop, customer, supervisor, keyword } = req.query;

  if (workshop) {
    projects = projects.filter((p) => p.workshop === workshop);
  }
  if (customer) {
    projects = projects.filter((p) => p.customer === customer);
  }
  if (supervisor) {
    projects = projects.filter((p) => p.supervisor === supervisor);
  }
  if (keyword) {
    const kw = keyword.toLowerCase();
    projects = projects.filter((p) => {
      return (
        (p.product_name && p.product_name.toLowerCase().includes(kw)) ||
        (p.engineer && p.engineer.toLowerCase().includes(kw)) ||
        (p.remarks && p.remarks.toLowerCase().includes(kw))
      );
    });
  }

  res.json(projects);
});

// Create
app.post('/api/projects', async (req, res) => {
  const data = loadData();
  const body = req.body;

  if (!body.workshop || !body.product_name) {
    return res.status(400).json({ error: 'workshop and product_name are required' });
  }

  const now = new Date().toISOString();
  const project = {
    id: uuidv4(),
    workshop: body.workshop || '',
    supervisor: body.supervisor || '',
    engineer: body.engineer || '',
    customer: body.customer || '',
    product_name: body.product_name || '',
    product_image: body.product_image || '',
    mold_sets: body.mold_sets || '',
    age_grade: body.age_grade || '',
    estimated_qty: body.estimated_qty || '',
    unit_price_usd: body.unit_price_usd || '',
    tax_rebate: body.tax_rebate || '',
    schedule: {
      dev_start: '',
      fs: '',
      ep: '',
      fep: '',
      pp: '',
      bom_plastic: '',
      bom_purchase: '',
      po1_date: '',
      po1_qty: '',
      ...(body.schedule || {}),
    },
    outsource_hunan: body.outsource_hunan || '',
    remarks: body.remarks || '',
    created_at: now,
    updated_at: now,
  };

  data.projects.push(project);
  await saveData(data);
  res.status(201).json(project);
});

// Batch delete — MUST be before /:id routes
app.delete('/api/projects/batch', async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'ids must be a non-empty array' });
  }
  const data = loadData();
  const idSet = new Set(ids);
  const before = data.projects.length;
  data.projects = data.projects.filter((p) => !idSet.has(p.id));
  const deleted = before - data.projects.length;
  await saveData(data);
  res.json({ deleted });
});

// Update
app.put('/api/projects/:id', async (req, res) => {
  const data = loadData();
  const idx = data.projects.findIndex((p) => p.id === req.params.id);
  if (idx === -1) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const existing = data.projects[idx];
  const body = req.body;

  // Merge schedule separately
  if (body.schedule) {
    body.schedule = { ...existing.schedule, ...body.schedule };
  }

  data.projects[idx] = {
    ...existing,
    ...body,
    id: existing.id, // preserve id
    created_at: existing.created_at,
    updated_at: new Date().toISOString(),
  };

  await saveData(data);
  res.json(data.projects[idx]);
});

// Delete single
app.delete('/api/projects/:id', async (req, res) => {
  const data = loadData();
  const idx = data.projects.findIndex((p) => p.id === req.params.id);
  if (idx === -1) {
    return res.status(404).json({ error: 'Project not found' });
  }

  // Clean up image if any
  const project = data.projects[idx];
  if (project.product_image) {
    const imgPath = path.join(UPLOADS_DIR, path.basename(project.product_image));
    if (fs.existsSync(imgPath)) {
      fs.unlinkSync(imgPath);
    }
  }

  data.projects.splice(idx, 1);
  await saveData(data);
  res.json({ deleted: 1 });
});

// ---------------------------------------------------------------------------
// Image upload
// ---------------------------------------------------------------------------
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    ensureDir(UPLOADS_DIR);
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, `${req.params.id}_${Date.now()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPEG, PNG and WebP images are allowed'));
    }
  },
});

app.post('/api/projects/:id/image', (req, res) => {
  const data = loadData();
  const project = data.projects.find((p) => p.id === req.params.id);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  upload.single('image')(req, res, async (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        return res.status(400).json({ error: err.message });
      }
      return res.status(400).json({ error: err.message });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Re-read data in case it changed
    const freshData = loadData();
    const freshProject = freshData.projects.find((p) => p.id === req.params.id);
    if (!freshProject) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Delete old image
    if (freshProject.product_image) {
      const oldPath = path.join(UPLOADS_DIR, path.basename(freshProject.product_image));
      if (fs.existsSync(oldPath)) {
        try { fs.unlinkSync(oldPath); } catch (_) { /* ignore */ }
      }
    }

    freshProject.product_image = `/uploads/${req.file.filename}`;
    freshProject.updated_at = new Date().toISOString();
    await saveData(freshData);

    res.json({ product_image: freshProject.product_image });
  });
});

// ---------------------------------------------------------------------------
// Import API
// ---------------------------------------------------------------------------
app.post('/api/import', async (req, res) => {
  const records = req.body;
  if (!Array.isArray(records)) {
    return res.status(400).json({ error: 'Request body must be a JSON array' });
  }

  const data = loadData();
  const now = new Date().toISOString();

  for (const rec of records) {
    const project = {
      id: uuidv4(),
      workshop: rec.workshop || '',
      supervisor: rec.supervisor || '',
      engineer: rec.engineer || '',
      customer: rec.customer || '',
      product_name: rec.product_name || '',
      product_image: rec.product_image || '',
      mold_sets: rec.mold_sets || '',
      age_grade: rec.age_grade || '',
      estimated_qty: rec.estimated_qty || '',
      unit_price_usd: rec.unit_price_usd || '',
      tax_rebate: rec.tax_rebate || '',
      schedule: {
        dev_start: '',
        fs: '',
        ep: '',
        fep: '',
        pp: '',
        bom_plastic: '',
        bom_purchase: '',
        po1_date: '',
        po1_qty: '',
        ...(rec.schedule || {}),
      },
      outsource_hunan: rec.outsource_hunan || '',
      remarks: rec.remarks || '',
      created_at: now,
      updated_at: now,
    };
    data.projects.push(project);
  }

  await saveData(data);
  res.json({ imported: records.length });
});

// ---------------------------------------------------------------------------
// Export API
// ---------------------------------------------------------------------------
app.get('/api/export', (req, res) => {
  const data = loadData();
  let projects = data.projects || [];

  const { workshop, customer, supervisor } = req.query;
  if (workshop) projects = projects.filter((p) => p.workshop === workshop);
  if (customer) projects = projects.filter((p) => p.customer === customer);
  if (supervisor) projects = projects.filter((p) => p.supervisor === supervisor);

  const rows = projects.map((p, i) => ({
    '序号': i + 1,
    '厂区': p.workshop || '',
    '主管': p.supervisor || '',
    '跟进工程师': p.engineer || '',
    '客户': p.customer || '',
    '产品名称': p.product_name || '',
    '工模套数': p.mold_sets || '',
    '年龄等级': p.age_grade || '',
    '预计总数量': p.estimated_qty || '',
    '货价(USD)': p.unit_price_usd || '',
    '退税码点': p.tax_rebate || '',
    '开发时间': (p.schedule && p.schedule.dev_start) || '',
    'FS': (p.schedule && p.schedule.fs) || '',
    'EP': (p.schedule && p.schedule.ep) || '',
    'FEP': (p.schedule && p.schedule.fep) || '',
    'PP': (p.schedule && p.schedule.pp) || '',
    '塑胶物料BOM': (p.schedule && p.schedule.bom_plastic) || '',
    '采购物料BOM': (p.schedule && p.schedule.bom_purchase) || '',
    'PO1走货日期': (p.schedule && p.schedule.po1_date) || '',
    'PO1走货数量': (p.schedule && p.schedule.po1_qty) || '',
    '是否外发湖南': p.outsource_hunan || '',
    '备注': p.remarks || '',
  }));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, '新产品开发进度表');

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="dev-progress.xlsx"');
  res.send(buf);
});

// ---------------------------------------------------------------------------
// Stats API
// ---------------------------------------------------------------------------
app.get('/api/stats', (req, res) => {
  const data = loadData();
  const projects = data.projects || [];

  const byWorkshop = {};
  const byCustomer = {};
  const bySupervisor = {};
  let totalCompleted = 0;
  let totalInProgress = 0;
  let totalDelayed = 0;
  const upcoming = [];

  for (const p of projects) {
    const { status } = getProjectStatus(p);

    // byWorkshop
    const ws = p.workshop || '未分配';
    if (!byWorkshop[ws]) byWorkshop[ws] = { total: 0, stages: {} };
    byWorkshop[ws].total++;
    // Count which stage each project is at
    const stageInfo = getProjectStatus(p);
    const currentStage = stageInfo.currentStage || 'unknown';
    byWorkshop[ws].stages[currentStage] = (byWorkshop[ws].stages[currentStage] || 0) + 1;

    // byCustomer
    const cust = p.customer || '未分配';
    if (!byCustomer[cust]) byCustomer[cust] = { total: 0, completed: 0, inProgress: 0, delayed: 0 };
    byCustomer[cust].total++;
    if (status === 'completed') byCustomer[cust].completed++;
    else if (status === 'in_progress') byCustomer[cust].inProgress++;
    else if (status === 'delayed') byCustomer[cust].delayed++;

    // bySupervisor
    const sup = p.supervisor || '未分配';
    if (!bySupervisor[sup]) bySupervisor[sup] = { total: 0, completed: 0 };
    bySupervisor[sup].total++;
    if (status === 'completed') bySupervisor[sup].completed++;

    // overview counts
    if (status === 'completed') totalCompleted++;
    else if (status === 'in_progress') totalInProgress++;
    else if (status === 'delayed') totalDelayed++;

    // upcoming: projects with po1_date in the future
    if (p.schedule && p.schedule.po1_date) {
      const d = parseLastDate(p.schedule.po1_date);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (d && d > today) {
        upcoming.push({
          id: p.id,
          product_name: p.product_name,
          customer: p.customer,
          po1_date: p.schedule.po1_date,
        });
      }
    }
  }

  // Sort upcoming by date
  upcoming.sort((a, b) => {
    const da = parseLastDate(a.po1_date);
    const db = parseLastDate(b.po1_date);
    return (da || new Date(0)) - (db || new Date(0));
  });

  res.json({
    byWorkshop,
    byCustomer,
    bySupervisor,
    overview: {
      total: projects.length,
      completed: totalCompleted,
      inProgress: totalInProgress,
      delayed: totalDelayed,
      upcoming: upcoming.slice(0, 10),
    },
  });
});

// ---------------------------------------------------------------------------
// Global error handler
// ---------------------------------------------------------------------------
app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`[dev-progress-system] Server running on port ${PORT}`);
  console.log(`  Data path : ${path.resolve(DATA_PATH)}`);
  console.log(`  Uploads   : ${path.resolve(UPLOADS_DIR)}`);
});
