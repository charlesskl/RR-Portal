/* ══════════════════════════════════════════════════════════════
   兴信 QMS 后端服务器  ·  零依赖（Node 内置 http + node:sqlite）
   ────────────────────────────────────────────────────────────
   职责：
     1. 用 SQLite 文件库持久化 验货记录 / 账号 / 不良描述库
     2. 首次启动从 seed.json 灌入默认账号 + 不良库
     3. 提供 REST API：/api/bootstrap (拉全量)、/api/records|users|defects (全量写回)
     4. 同端口静态托管前端（index.html / app.js / ...）

   多厂区（2026-09 新增）：
     · 每个厂区一套完全独立的数据库文件：server/data/<厂区id>/qc.db
     · 数据（记录 / 账号 / 不良库）在厂区之间物理隔离、互不流通
     · 所有数据 API 通过 ?company=<厂区id> 指定目标厂区（缺省默认 dg-xingxin，兼容旧链接）
     · 旧版单库（生产：DATA_PATH/qc.db；本地：server/qc.db）首次启动自动迁移为东莞兴信库
   启动：node server.js   （默认端口 8765，可用环境变量 PORT 覆盖）
══════════════════════════════════════════════════════════════ */
'use strict';
const http = require('node:http');
const fs   = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const ROOT      = path.join(__dirname, '..');           // 前端静态根目录
const DATA_DIR  = process.env.DATA_PATH || path.join(__dirname, 'data');
const LEGACY_DB = path.join(__dirname, 'qc.db');        // 本地开发的旧版单库路径（自动迁移用；生产旧库在 DATA_PATH/qc.db）
const SEED_PATH = path.join(__dirname, 'seed.json');
const AI_CONFIG_PATH = path.join(__dirname, 'ai-config.json');
const PORT      = Number(process.env.PORT) || 8765;

/* ════════ 厂区 → 子公司清单（数据隔离边界；每家子公司一个独立库 server/data/<id>/qc.db）════════
   新增子公司：在这里加一行 + 前端 app.js 的 QC_COMPANIES 加一行即可 */
const COMPANIES = [
  /* 东莞厂区 */
  { id: 'dg-xingxin',   site: '东莞', name: '东莞兴信' },
  { id: 'dg-huadeng-a', site: '东莞', name: '东莞华登A' },
  { id: 'dg-huadeng-b', site: '东莞', name: '东莞华登B' },
  { id: 'dg-huajia',    site: '东莞', name: '东莞华嘉' },
  /* 河源厂区 */
  { id: 'hy-huakang-a', site: '河源', name: '华康A' },
  { id: 'hy-huakang-b', site: '河源', name: '华康B' },
  { id: 'hy-huakang-c', site: '河源', name: '华康C' },
  { id: 'hy-huakang-d', site: '河源', name: '华康D' },
  { id: 'hy-huadeng',   site: '河源', name: '河源华登' },
  { id: 'hy-huaxing',   site: '河源', name: '河源华兴' },
  /* 湖南厂区 */
  { id: 'sy-huadeng',   site: '湖南', name: '邵阳华登' },
  { id: 'sy-xingxin',   site: '湖南', name: '邵阳兴信' },
  { id: 'xs-huadeng',   site: '湖南', name: '新邵华登' },
];
const DEFAULT_COMPANY = 'dg-xingxin';
/* 旧版兼容：早期按厂区名当 company 的链接/缓存自动映射到该厂区默认子公司 */
const LEGACY_ALIAS = { dongguan: 'dg-xingxin', heyuan: 'hy-huakang-a', hunan: 'sy-huadeng' };

function resolveCompany(searchParams) {
  let raw = String((searchParams && searchParams.get('company')) || '').trim().toLowerCase();
  if (!raw) return DEFAULT_COMPANY;
  if (LEGACY_ALIAS[raw]) raw = LEGACY_ALIAS[raw];
  const hit = COMPANIES.find(c => c.id === raw);
  return hit ? hit.id : null;   // 非法子公司 → null → 路由返回 400
}
function companyName(id) {
  const c = COMPANIES.find(c => c.id === id);
  return c ? c.name : id;
}
function companySite(id) {
  const c = COMPANIES.find(c => c.id === id);
  return c ? c.site : id;
}

/* ════════ AI 配置（阿里百炼 / DashScope OpenAI 兼容，全局共用）════════ */
function loadAiConfig() {
  let cfg = {
    enabled: false,
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKey: '',
    ocrModel: 'qwen3.5-omni-plus',
    textModel: 'qwen3.5-omni-plus',
  };
  try { Object.assign(cfg, JSON.parse(fs.readFileSync(AI_CONFIG_PATH, 'utf8'))); }
  catch (e) { console.warn('[AI] config not loaded:', e.message); }
  // 环境变量可覆盖密钥
  const envApiKey = process.env.DASHSCOPE_API_KEY || process.env.QC_BAILIAN_API_KEY;
  if (envApiKey) cfg.apiKey = envApiKey;
  // 仅当密钥已填写真实值（非占位）才算可用
  const placeholder = !cfg.apiKey || /粘贴|你的|YOUR|xxxx|sk-xxx/i.test(cfg.apiKey) || cfg.apiKey.includes('****');
  cfg.ready = cfg.enabled !== false && !placeholder;
  return cfg;
}
let AI = loadAiConfig();

/* OCR 提取提示词：锁死只输出系统需要的字段 */
const OCR_FIELD_PROMPT = [
  '这是一张工厂「送货单/来料单」的照片，可能被旋转、字迹偏淡或带有印章。',
  '请只提取下列字段，并严格输出 JSON（不要任何解释、不要 markdown 代码块）：',
  '{',
  '  "date": "来料/送货日期，格式 YYYY-MM-DD；找不到留空字符串",',
  '  "supplier": "供应商/送货公司全称（开单抬头的公司，如东莞市XX有限公司，不是收货方兴信）；找不到留空",',
  '  "deliveryNo": "送货单号（单据右上角 NO. 后的编号）；找不到留空",',
  '  "orderNo": "订单号/PO号；找不到留空",',
  '  "type": "固定为 来料",',
  '  "items": [ { "productNo": "货号/Item No", "productName": "货名/品名/Description", "qty": "送货数量/实送数量（纯数字,去千分位；不要取订单数量）", "unit": "单位如 KG/PCS/桶" } ]',
  '}',
  '要点：supplier 取单据顶部开单公司，绝不要取「寶號/Messrs」后面的收货单位；每一行货品作为 items 的一个元素，可能有多行；只输出 JSON 对象本身。',
].join('\n');

/* 调用阿里百炼（OpenAI 兼容）视觉模型，从图片提取字段 */
async function aiVisionExtract(dataUrl) {
  if (!AI.ready) {
    const err = new Error('AI 未配置：请在 server/ai-config.json 填入阿里百炼 API Key 后调用 /api/ai/reload');
    err.code = 'NO_AI'; throw err;
  }
  const payload = {
    model: AI.ocrModel || 'qwen-vl-max',
    temperature: 0,
    messages: [
      { role: 'system', content: '你是工厂 IQC 验货助手，只从送货单图片中提取指定字段并输出严格 JSON。' },
      { role: 'user', content: [
        { type: 'text', text: OCR_FIELD_PROMPT },
        { type: 'image_url', image_url: { url: dataUrl } },
      ] },
    ],
  };
  async function callModel(model) {
    payload.model = model;
    const resp = await fetch(AI.baseURL.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + AI.apiKey },
      body: JSON.stringify(payload),
    });
    return { status: resp.status, raw: await resp.text() };
  }
  let r = await callModel(payload.model);
  /* 主模型无权限(403 AccessDenied)时自动回退到 qwen3.5-ocr */
  if (r.status === 403 && /denied|Unpurchased/i.test(r.raw) && payload.model !== 'qwen3.5-ocr') {
    console.warn('[AI] 模型 %s 无权限，回退 qwen3.5-ocr', payload.model);
    r = await callModel('qwen3.5-ocr');
  }
  const raw = r.raw;
  if (r.status >= 400) { const err = new Error('百炼返回 HTTP ' + r.status + '：' + raw.slice(0, 600)); err.code = 'UPSTREAM'; throw err; }
  let data; try { data = JSON.parse(raw); } catch (e) { throw new Error('百炼响应非 JSON：' + raw.slice(0, 300)); }
  let content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content || '';
  if (Array.isArray(content)) content = content.map(c => (typeof c === 'string' ? c : (c && c.text) || '')).join('');
  content = String(content).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let fields = null;
  try { fields = JSON.parse(content); }
  catch (e) { const m = content.match(/\{[\s\S]*\}/); if (m) { try { fields = JSON.parse(m[0]); } catch (e2) {} } }
  if (!fields) throw new Error('AI 输出无法解析为 JSON：' + content.slice(0, 300));
  return { fields, usage: data.usage || null };
}

/* ── 记录表列顺序（写入/读取都按这个顺序）── */
const RECORD_COLS = [
  'id', 'date', 'inspDate', 'supplier', 'client', 'productNo', 'productName',
  'deliveryNo', 'orderNo', 'type', 'qty', 'sampleQty', 'pass', 'fail',
  'defectRate', 'result', 'result2', 'defect', 'defects', 'measurements',
  'qc', 'confirmBy', 'remark', 'orderQty', 'updatedAt',
];

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS records (
    id INTEGER PRIMARY KEY,
    date TEXT, inspDate TEXT, supplier TEXT, client TEXT,
    productNo TEXT, productName TEXT, deliveryNo TEXT, orderNo TEXT,
    type TEXT, qty INTEGER, sampleQty INTEGER, pass INTEGER, fail INTEGER,
    defectRate TEXT, result TEXT, result2 TEXT, defect TEXT,
    defects TEXT, measurements TEXT,
    qc TEXT, confirmBy TEXT, remark TEXT, orderQty INTEGER, updatedAt TEXT
  );
  CREATE TABLE IF NOT EXISTS users (
    username TEXT PRIMARY KEY, password TEXT, role TEXT,
    enabled INTEGER, createdAt TEXT, lastLoginAt TEXT
  );
  CREATE TABLE IF NOT EXISTS defect_library (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT, category TEXT, defaultLevel TEXT,
    keywords TEXT, enabled INTEGER, createdAt TEXT
  );
`;

const toNum = (v) => (v === '' || v === null || v === undefined || isNaN(Number(v))) ? null : Number(v);
const j     = (v) => JSON.stringify(Array.isArray(v) ? v : (v ? [v] : []));

function recordValues(r) {
  return [
    toNum(r.id), r.date ?? null, r.inspDate ?? null, r.supplier ?? null, r.client ?? null,
    r.productNo ?? null, r.productName ?? null, r.deliveryNo ?? null, r.orderNo ?? null,
    r.type ?? null, toNum(r.qty), toNum(r.sampleQty), toNum(r.pass), toNum(r.fail),
    r.defectRate ?? null, r.result ?? null, r.result2 ?? null, r.defect ?? null,
    j(r.defects), j(r.measurements),
    r.qc ?? null, r.confirmBy ?? null, r.remark ?? null, toNum(r.orderQty),
    r.updatedAt || new Date().toISOString(),
  ];
}

function rowToRecord(row) {
  const r = Object.assign({}, row);
  try { r.defects = JSON.parse(row.defects || '[]'); } catch (e) { r.defects = []; }
  try { r.measurements = JSON.parse(row.measurements || '[]'); } catch (e) { r.measurements = []; }
  return r;
}

/* ── 全量替换（事务）── */
function replaceRecords(db, records) {
  const ph = RECORD_COLS.map(() => '?').join(',');
  const ins = db.prepare(`INSERT INTO records(${RECORD_COLS.join(',')}) VALUES(${ph})`);
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM records').run();
    for (const r of records) ins.run(...recordValues(r));
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

function replaceUsers(db, users) {
  migrateUsersTable(db);
  const ins = db.prepare('INSERT INTO users(username,password,role,enabled,createdAt,lastLoginAt,name,dept,perms) VALUES(?,?,?,?,?,?,?,?,?)');
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM users').run();
    for (const u of users) ins.run(
      u.username, u.password ?? null, u.role ?? 'viewer', u.enabled ? 1 : 0,
      u.createdAt ?? null, u.lastLoginAt ?? null,
      u.name ?? null, u.dept ?? null,
      u.perms ? (typeof u.perms === 'string' ? u.perms : JSON.stringify(u.perms)) : null,
    );
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  ensureSuperAdmin(db);
}

/* 保底：主账号 jc 在任何子公司都不能被删除/停用（确保管理员永远进得去） */
function ensureSuperAdmin(db) {
  try {
    const seed = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));
    const jc = (seed.users || []).find(u => u.username === 'jc');
    if (!jc) return;
    const cur = db.prepare("SELECT * FROM users WHERE username='jc'").get();
    if (!cur) {
      db.prepare('INSERT INTO users(username,password,role,enabled,createdAt,lastLoginAt) VALUES(?,?,?,1,?,NULL)')
        .run('jc', jc.password ?? null, 'admin', new Date().toISOString());
      console.log('[保底] jc 主账号被删除，已自动恢复');
    } else if (!cur.enabled || cur.role !== 'admin') {
      db.prepare("UPDATE users SET enabled=1, role='admin' WHERE username='jc'").run();
      console.log('[保底] jc 主账号被停用/降权，已自动恢复');
    }
  } catch (e) { console.warn('[保底] jc 主账号检查失败：', e.message); }
}

function replaceDefects(db, lib) {
  const ins = db.prepare('INSERT INTO defect_library(name,category,defaultLevel,keywords,enabled,createdAt) VALUES(?,?,?,?,?,?)');
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM defect_library').run();
    for (const d of lib) ins.run(d.name ?? null, d.category ?? null, d.defaultLevel ?? null, JSON.stringify(d.keywords || []), d.enabled ? 1 : 0, d.createdAt ?? null);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

/* ── 首次启动灌种子（仅在对应表为空时）──
   includeRecords=false 时只灌默认账号 + 不良库（用于新厂区，不带示例验货记录） */
function seedIfEmpty(db, { includeRecords = true } = {}) {
  let seed = { records: [], users: [], defectLib: [] };
  try { seed = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8')); }
  catch (e) { console.warn('[seed] 读取 seed.json 失败，跳过灌种子：', e.message); }

  if (db.prepare('SELECT COUNT(*) c FROM users').get().c === 0 && seed.users?.length) {
    replaceUsers(db, seed.users);
    console.log('[seed] 灌入默认账号', seed.users.length, '个');
  }
  if (includeRecords && db.prepare('SELECT COUNT(*) c FROM records').get().c === 0 && seed.records?.length) {
    replaceRecords(db, seed.records);
    console.log('[seed] 灌入验货记录', seed.records.length, '条');
  }
  if (db.prepare('SELECT COUNT(*) c FROM defect_library').get().c === 0 && seed.defectLib?.length) {
    replaceDefects(db, seed.defectLib);
    console.log('[seed] 灌入不良描述库', seed.defectLib.length, '条');
  }
}

/* 用户表新增字段（姓名/部门/权限矩阵），老库自动补齐 */
const USER_EXTRA_COLS = [
  { col: 'name',  ddl: "ALTER TABLE users ADD COLUMN name TEXT" },
  { col: 'dept',  ddl: "ALTER TABLE users ADD COLUMN dept TEXT" },
  { col: 'perms', ddl: "ALTER TABLE users ADD COLUMN perms TEXT" },
];
function migrateUsersTable(db) {
  const cols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
  for (const c of USER_EXTRA_COLS) {
    if (!cols.includes(c.col)) { try { db.exec(c.ddl); } catch (e) {} }
  }
}

/* ════════ 多厂区数据库管理（每厂区一个独立 qc.db，懒加载 + 缓存）════════ */
const _dbs = new Map();

/* 旧版单库迁移：旧 qc.db → data/dg-xingxin/qc.db（仅首次）。
   旧库可能的位置：生产容器是 DATA_PATH/qc.db（/app/data/qc.db，bind-mount 持久卷），
   本地开发是 server/qc.db（server.js 同目录）。两处都要看，漏掉生产路径会导致
   上线后旧数据"消失"（文件还在 data/qc.db 但没人读）。 */
function migrateLegacyDb() {
  try {
    const dgDir = path.join(DATA_DIR, DEFAULT_COMPANY);
    const dgDb  = path.join(dgDir, 'qc.db');
    if (fs.existsSync(dgDb)) return;
    const candidates = [path.join(DATA_DIR, 'qc.db'), LEGACY_DB];
    const legacy = candidates.find(p => fs.existsSync(p));
    if (legacy) {
      fs.mkdirSync(dgDir, { recursive: true });
      fs.renameSync(legacy, dgDb);
      console.log('[迁移] 旧版数据库已迁移为东莞兴信库：' + legacy + ' → ' + dgDb);
    }
  } catch (e) {
    console.error('[迁移] 旧版数据库迁移失败：', e.message);
  }
}

function getDb(companyId) {
  if (_dbs.has(companyId)) return _dbs.get(companyId);
  const dir = path.join(DATA_DIR, companyId);
  fs.mkdirSync(dir, { recursive: true });
  const dbPath = path.join(dir, 'qc.db');
  const db = new DatabaseSync(dbPath);
  db.exec(SCHEMA_SQL);
  migrateUsersTable(db);   /* 老库补齐 姓名/部门/权限 列 */
  // 东莞老库已带数据则无需灌种子；全新厂区只灌账号 + 不良库，不带示例记录
  seedIfEmpty(db, { includeRecords: companyId === DEFAULT_COMPANY });
  _dbs.set(companyId, db);
  console.log('[DB] 厂区「' + companyName(companyId) + '」数据库就绪：' + dbPath);
  return db;
}

migrateLegacyDb();

/* ════════ 读取全量（供前端开机预加载）════════ */
function getBootstrap(db) {
  const records = db.prepare('SELECT * FROM records ORDER BY id').all().map(rowToRecord);
  const nextId  = records.reduce((m, r) => Math.max(m, Number(r.id) || 0), 30) + 1;
  const users   = db.prepare('SELECT * FROM users').all().map(u => Object.assign({}, u, {
    enabled: !!u.enabled,
    perms: (() => { try { return u.perms ? JSON.parse(u.perms) : null; } catch (e) { return null; } })(),
  }));
  const defectLib = db.prepare('SELECT * FROM defect_library ORDER BY id').all().map(d => ({
    name: d.name, category: d.category, defaultLevel: d.defaultLevel,
    keywords: (() => { try { return JSON.parse(d.keywords || '[]'); } catch (e) { return []; } })(),
    enabled: !!d.enabled, createdAt: d.createdAt,
  }));
  return { records, nextId, users, defectLib };
}

/* ════════ HTTP 工具 ════════ */
function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function sendDownload(req, res, contentType, filename, body) {
  const safeName = String(filename || 'download').replace(/[\\/:*?"<>|]/g, '_');
  const fallbackName = safeName.replace(/[^\x20-\x7E]/g, '_') || 'download';
  const encoded = encodeURIComponent(safeName);
  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Disposition': `attachment; filename="${fallbackName}"; filename*=UTF-8''${encoded}`,
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    'Pragma': 'no-cache',
    'Expires': '0',
  });
  res.end(req.method === 'HEAD' ? undefined : body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 50 * 1024 * 1024) req.destroy(); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function formatModifiedDate(value) {
  if (!value) return '';
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function neutralizeSpreadsheetFormula(v) {
  const value = String(v == null ? '' : v);
  return /^[=+\-@\t\r]/.test(value) ? "'" + value : value;
}

function csvCell(v) {
  return '"' + neutralizeSpreadsheetFormula(v).replace(/"/g, '""') + '"';
}

function htmlCell(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isPassRecord(r) {
  return String(r.result || '').toUpperCase() === 'PASS';
}

function isFailRecord(r) {
  const v = String(r.result || '').toUpperCase();
  return v === 'REJ' || v === 'FAIL';
}

function getFilteredExportRecords(db, searchParams) {
  const search = String(searchParams.get('search') || '').trim().toLowerCase();
  const result = String(searchParams.get('result') || '').trim().toUpperCase();
  const from = String(searchParams.get('dateFrom') || '').trim();
  const to = String(searchParams.get('dateTo') || '').trim();
  return getBootstrap(db).records.filter(r => {
    if (search) {
      const haystack = [
        r.supplier, r.productNo, r.productName, r.client, r.orderNo, r.deliveryNo,
        r.defect, r.updatedAt, formatModifiedDate(r.updatedAt),
      ]
        .filter(Boolean).join(' ').toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    if (result === 'PASS' && !isPassRecord(r)) return false;
    if (result === 'REJ' && !isFailRecord(r)) return false;
    if (from && String(r.date || '') < from) return false;
    if (to && String(r.date || '') > to) return false;
    return true;
  });
}

function buildRecordsCsv(records) {
  const hdr = ['ID','来料日期','检验日期','修改日期','供应商','客户','货号','款式名称','PO号','类型',
    '来料数量','抽查数量','PASS数','FAIL数','不良率','不良现象','判定结果','检验员','备注'];
  const rows = records
    .slice()
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
    .map(r => [
      r.id, r.date, r.inspDate, formatModifiedDate(r.updatedAt), r.supplier, r.client, r.productNo, r.productName,
      r.orderNo, r.type, r.qty, r.sampleQty, r.pass, r.fail, r.defectRate, r.defect, r.result, r.qc, r.remark,
    ].map(csvCell));
  return '﻿' + [hdr.map(csvCell), ...rows].map(r => r.join(',')).join('\n'); // 前导 ﻿ = BOM，Excel 正确识别 UTF-8
}

function buildFactoryExcelHtml(records) {
  const headers = ['序号','来货日期','供应商','加工类型','客户','送货单号','PO号','货号','产品名称','数量','单数','检验结果','不良描述','检验人','备注'];
  const rows = records.slice().sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  table { border-collapse: collapse; font-family: "Microsoft YaHei", Arial, sans-serif; font-size: 10pt; }
  th, td { border: 1px solid #000; padding: 4px 6px; text-align: center; mso-number-format:"\\@"; }
  .title { font-size: 14pt; font-weight: 700; text-align: center; height: 26px; }
  .head { background: #d9e1f2; font-weight: 700; }
  .left { text-align: left; }
</style>
</head>
<body>
<table>
  <tr><td class="title" colspan="15">加工厂品质检验明细统计表</td></tr>
  <tr>${headers.map(h => `<th class="head">${htmlCell(h)}</th>`).join('')}</tr>
  ${rows.map((r, i) => `<tr>
    <td>${i + 1}</td>
    <td>${htmlCell(r.date || '')}</td>
    <td>${htmlCell(r.supplier || '')}</td>
    <td>${htmlCell(r.type || '')}</td>
    <td>${htmlCell(r.client || '')}</td>
    <td>${htmlCell(r.deliveryNo || '')}</td>
    <td>${htmlCell(r.orderNo || '')}</td>
    <td>${htmlCell(r.productNo || '')}</td>
    <td class="left">${htmlCell(r.productName || '')}</td>
    <td>${htmlCell(r.qty != null && r.qty !== '' ? r.qty : '')}</td>
    <td></td>
    <td>${htmlCell(r.result || '')}</td>
    <td class="left">${htmlCell(r.defect || '')}</td>
    <td>${htmlCell(r.qc || '')}</td>
    <td>${htmlCell(r.remark || '')}</td>
  </tr>`).join('')}
</table>
</body>
</html>`;
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.gz': 'application/gzip',
};

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const norm = rel.replace(/\\/g, '/').toLowerCase();
  // 安全：禁止访问后端目录、数据目录(qc.db)、上级目录
  if (norm.includes('..') || norm.startsWith('/server/') || norm.startsWith('/data/')) {
    res.writeHead(403); return res.end('forbidden');
  }
  const filePath = path.join(ROOT, rel);
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(filePath, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('404 not found'); }
    const ext = path.extname(filePath).toLowerCase();
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
    // 前端代码类资源禁用缓存，避免手机/浏览器缓存旧版（适配、逻辑改了不生效）
    if (['.html', '.js', '.css', '.json', '.wasm', '.gz'].includes(ext)) {
      headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0';
      headers['Pragma'] = 'no-cache';
      headers['Expires'] = '0';
    }
    res.writeHead(200, headers);
    res.end(buf);
  });
}

/* ════════ 路由 ════════ */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  if (!p.startsWith('/api/')) return serveStatic(req, res, p);

  try {
    if (p === '/api/health' && req.method === 'GET') {
      return sendJson(res, 200, { ok: true, time: new Date().toISOString() });
    }
    /* ── 厂区清单（登录页用，无需鉴权）── */
    if (p === '/api/companies' && req.method === 'GET') {
      return sendJson(res, 200, { companies: COMPANIES });
    }

    /* ── 数据类路由：解析目标厂区（缺省东莞，兼容旧链接）── */
    const companyId = resolveCompany(url.searchParams);
    if (companyId === null) {
      return sendJson(res, 400, { ok: false, error: '未知厂区：' + String(url.searchParams.get('company')) });
    }
    const db = getDb(companyId);

    if (p === '/api/bootstrap' && req.method === 'GET') {
      return sendJson(res, 200, Object.assign({ company: companyId }, getBootstrap(db)));
    }
    if (p === '/api/export/records.csv' && (req.method === 'GET' || req.method === 'HEAD')) {
      const records = getFilteredExportRecords(db, url.searchParams);
      const body = buildRecordsCsv(records);
      return sendDownload(req, res, 'text/csv; charset=utf-8', `${companyName(companyId)}验货明细_${todayStr()}.csv`, body);
    }
    if (p === '/api/export/factory-excel.xls' && (req.method === 'GET' || req.method === 'HEAD')) {
      const records = getFilteredExportRecords(db, url.searchParams);
      const from = String(url.searchParams.get('dateFrom') || '').trim();
      const to = String(url.searchParams.get('dateTo') || '').trim();
      const span = (from || to) ? `_${from || '起始'}至${to || '今'}` : '_全部';
      const body = '﻿' + buildFactoryExcelHtml(records);
      return sendDownload(req, res, 'application/vnd.ms-excel; charset=utf-8', `${companyName(companyId)}品质检验明细统计表${span}.xls`, body);
    }
    if (p === '/api/records' && req.method === 'POST') {
      const body = await readBody(req);
      replaceRecords(db, Array.isArray(body.records) ? body.records : []);
      return sendJson(res, 200, { ok: true, count: db.prepare('SELECT COUNT(*) c FROM records').get().c });
    }
    if (p === '/api/users' && req.method === 'POST') {
      const body = await readBody(req);
      replaceUsers(db, Array.isArray(body.users) ? body.users : []);
      return sendJson(res, 200, { ok: true, count: db.prepare('SELECT COUNT(*) c FROM users').get().c });
    }
    if (p === '/api/defects' && req.method === 'POST') {
      const body = await readBody(req);
      replaceDefects(db, Array.isArray(body.defectLib) ? body.defectLib : []);
      return sendJson(res, 200, { ok: true, count: db.prepare('SELECT COUNT(*) c FROM defect_library').get().c });
    }
    /* ── AI（阿里百炼，全局共用，不分厂区）── */
    if (p === '/api/ai/status' && req.method === 'GET') {
      return sendJson(res, 200, { ready: AI.ready, ocrModel: AI.ocrModel, baseURL: AI.baseURL });
    }
    if (p === '/api/ai/reload' && req.method === 'POST') {
      AI = loadAiConfig();
      return sendJson(res, 200, { ok: true, ready: AI.ready, ocrModel: AI.ocrModel });
    }
    if (p === '/api/ai/ocr-extract' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body || !body.image) return sendJson(res, 400, { ok: false, error: '缺少 image 字段（base64 dataURL）' });
      try {
        const r = await aiVisionExtract(body.image);
        return sendJson(res, 200, { ok: true, fields: r.fields, usage: r.usage });
      } catch (e) {
        const code = e.code === 'NO_AI' ? 503 : 502;
        return sendJson(res, code, { ok: false, error: String(e && e.message || e), code: e.code || 'ERR' });
      }
    }
    return sendJson(res, 404, { ok: false, error: 'unknown api route' });
  } catch (e) {
    console.error('[api error]', p, e);
    return sendJson(res, 500, { ok: false, error: String(e && e.message || e) });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('════════════════════════════════════════════');
  console.log('  兴信 QMS 后端已启动（多厂区模式）');
  console.log('  本机:   http://localhost:' + PORT + '/index.html');
  console.log('  数据目录: ' + DATA_DIR);
  for (const c of COMPANIES) {
    const b = getBootstrap(getDb(c.id));
    console.log('  厂区「' + c.name + '」: 记录 ' + b.records.length + ' 条 / 账号 ' + b.users.length + ' 个 / 不良库 ' + b.defectLib.length + ' 条');
  }
  console.log('  AI(百炼): ' + (AI.ready ? ('已就绪, 模型 ' + AI.ocrModel) : '未配置(填 ai-config.json 后调 /api/ai/reload)'));
  console.log('════════════════════════════════════════════');
});
