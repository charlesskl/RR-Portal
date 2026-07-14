/* ══════════════════════════════════════════════════════════════
   兴信 QMS 后端服务器  ·  零依赖（Node 内置 http + node:sqlite）
   ────────────────────────────────────────────────────────────
   职责：
     1. 用 SQLite 文件库 qc.db 持久化 验货记录 / 账号 / 不良描述库
     2. 首次启动从 seed.json 灌入 30 条记录 + 默认账号 + 不良库
     3. 提供 REST API：/api/bootstrap (拉全量)、/api/records|users|defects (全量写回)
     4. 同端口静态托管前端（index.html / app.js / ...）
   启动：node server.js   （默认端口 8765，可用环境变量 PORT 覆盖）
══════════════════════════════════════════════════════════════ */
'use strict';
const http = require('node:http');
const fs   = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const ROOT      = path.join(__dirname, '..');           // 前端静态根目录 C:\DL\QC
const DB_PATH   = process.env.DATA_PATH ? path.join(process.env.DATA_PATH, 'qc.db') : path.join(__dirname, 'qc.db');
const SEED_PATH = path.join(__dirname, 'seed.json');
const AI_CONFIG_PATH = path.join(__dirname, 'ai-config.json');
const PORT      = Number(process.env.PORT) || 8765;

/* ════════ AI 配置（阿里百炼 / DashScope OpenAI 兼容）════════ */
function loadAiConfig() {
  let cfg = {
    enabled: false,
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKey: '',
    ocrModel: 'qwen-vl-max',
    textModel: 'qwen-plus',
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
  '  "items": [ { "productNo": "货号/Item No", "productName": "货名/品名/Description", "qty": "数量(纯数字,去千分位)", "unit": "单位如 KG/PCS/桶" } ]',
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
  const resp = await fetch(AI.baseURL.replace(/\/$/, '') + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + AI.apiKey },
    body: JSON.stringify(payload),
  });
  const raw = await resp.text();
  if (!resp.ok) { const err = new Error('百炼返回 HTTP ' + resp.status + '：' + raw.slice(0, 600)); err.code = 'UPSTREAM'; throw err; }
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

/* ════════ 数据库初始化 ════════ */
const db = new DatabaseSync(DB_PATH);
db.exec(`
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
`);

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
function replaceRecords(records) {
  const ph = RECORD_COLS.map(() => '?').join(',');
  const ins = db.prepare(`INSERT INTO records(${RECORD_COLS.join(',')}) VALUES(${ph})`);
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM records').run();
    for (const r of records) ins.run(...recordValues(r));
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

function replaceUsers(users) {
  const ins = db.prepare('INSERT INTO users(username,password,role,enabled,createdAt,lastLoginAt) VALUES(?,?,?,?,?,?)');
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM users').run();
    for (const u of users) ins.run(u.username, u.password ?? null, u.role ?? 'viewer', u.enabled ? 1 : 0, u.createdAt ?? null, u.lastLoginAt ?? null);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

function replaceDefects(lib) {
  const ins = db.prepare('INSERT INTO defect_library(name,category,defaultLevel,keywords,enabled,createdAt) VALUES(?,?,?,?,?,?)');
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM defect_library').run();
    for (const d of lib) ins.run(d.name ?? null, d.category ?? null, d.defaultLevel ?? null, JSON.stringify(d.keywords || []), d.enabled ? 1 : 0, d.createdAt ?? null);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

/* ── 首次启动灌种子（仅在对应表为空时）── */
function seedIfEmpty() {
  let seed = { records: [], users: [], defectLib: [] };
  try { seed = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8')); }
  catch (e) { console.warn('[seed] 读取 seed.json 失败，跳过灌种子：', e.message); }

  if (db.prepare('SELECT COUNT(*) c FROM users').get().c === 0 && seed.users?.length) {
    replaceUsers(seed.users);
    console.log('[seed] 灌入默认账号', seed.users.length, '个');
  }
  if (db.prepare('SELECT COUNT(*) c FROM records').get().c === 0 && seed.records?.length) {
    replaceRecords(seed.records);
    console.log('[seed] 灌入验货记录', seed.records.length, '条');
  }
  if (db.prepare('SELECT COUNT(*) c FROM defect_library').get().c === 0 && seed.defectLib?.length) {
    replaceDefects(seed.defectLib);
    console.log('[seed] 灌入不良描述库', seed.defectLib.length, '条');
  }
}
seedIfEmpty();

/* ════════ 读取全量（供前端开机预加载）════════ */
function getBootstrap() {
  const records = db.prepare('SELECT * FROM records ORDER BY id').all().map(rowToRecord);
  const nextId  = records.reduce((m, r) => Math.max(m, Number(r.id) || 0), 30) + 1;
  const users   = db.prepare('SELECT * FROM users').all().map(u => Object.assign({}, u, { enabled: !!u.enabled }));
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

function getFilteredExportRecords(searchParams) {
  const search = String(searchParams.get('search') || '').trim().toLowerCase();
  const result = String(searchParams.get('result') || '').trim().toUpperCase();
  const from = String(searchParams.get('dateFrom') || '').trim();
  const to = String(searchParams.get('dateTo') || '').trim();
  return getBootstrap().records.filter(r => {
    if (search) {
      const haystack = [r.supplier, r.productNo, r.productName, r.client, r.defect]
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
  const hdr = ['ID','来料日期','检验日期','供应商','客户','货号','款式名称','类型',
    '来料数量','抽查数量','PASS数','FAIL数','不良率','不良现象','判定结果','检验员','备注'];
  const rows = records
    .slice()
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
    .map(r => [
      r.id, r.date, r.inspDate, r.supplier, r.client, r.productNo, r.productName,
      r.type, r.qty, r.sampleQty, r.pass, r.fail, r.defectRate, r.defect, r.result, r.qc, r.remark,
    ].map(csvCell));
  return '\uFEFF' + [hdr.map(csvCell), ...rows].map(r => r.join(',')).join('\n');
}

function buildFactoryExcelHtml(records) {
  const headers = ['序号','来货日期','供应商','加工类型','客户','送货单号','货号','产品名称','数量','单数','检验结果','不良描述','检验人','备注'];
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
  <tr><td class="title" colspan="14">加工厂品质检验明细统计表</td></tr>
  <tr>${headers.map(h => `<th class="head">${htmlCell(h)}</th>`).join('')}</tr>
  ${rows.map((r, i) => `<tr>
    <td>${i + 1}</td>
    <td>${htmlCell(r.date || '')}</td>
    <td>${htmlCell(r.supplier || '')}</td>
    <td>${htmlCell(r.type || '')}</td>
    <td>${htmlCell(r.client || '')}</td>
    <td>${htmlCell(r.deliveryNo || '')}</td>
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
    if (p === '/api/bootstrap' && req.method === 'GET') {
      return sendJson(res, 200, getBootstrap());
    }
    if (p === '/api/export/records.csv' && (req.method === 'GET' || req.method === 'HEAD')) {
      const records = getFilteredExportRecords(url.searchParams);
      const body = buildRecordsCsv(records);
      return sendDownload(req, res, 'text/csv; charset=utf-8', `东莞兴信验货明细_${todayStr()}.csv`, body);
    }
    if (p === '/api/export/factory-excel.xls' && (req.method === 'GET' || req.method === 'HEAD')) {
      const records = getFilteredExportRecords(url.searchParams);
      const from = String(url.searchParams.get('dateFrom') || '').trim();
      const to = String(url.searchParams.get('dateTo') || '').trim();
      const span = (from || to) ? `_${from || '起始'}至${to || '今'}` : '_全部';
      const body = '\uFEFF' + buildFactoryExcelHtml(records);
      return sendDownload(req, res, 'application/vnd.ms-excel; charset=utf-8', `加工厂品质检验明细统计表${span}.xls`, body);
    }
    if (p === '/api/records' && req.method === 'POST') {
      const body = await readBody(req);
      replaceRecords(Array.isArray(body.records) ? body.records : []);
      return sendJson(res, 200, { ok: true, count: db.prepare('SELECT COUNT(*) c FROM records').get().c });
    }
    if (p === '/api/users' && req.method === 'POST') {
      const body = await readBody(req);
      replaceUsers(Array.isArray(body.users) ? body.users : []);
      return sendJson(res, 200, { ok: true, count: db.prepare('SELECT COUNT(*) c FROM users').get().c });
    }
    if (p === '/api/defects' && req.method === 'POST') {
      const body = await readBody(req);
      replaceDefects(Array.isArray(body.defectLib) ? body.defectLib : []);
      return sendJson(res, 200, { ok: true, count: db.prepare('SELECT COUNT(*) c FROM defect_library').get().c });
    }
    /* ── AI（阿里百炼）── */
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
  const b = getBootstrap();
  console.log('════════════════════════════════════════════');
  console.log('  兴信 QMS 后端已启动');
  console.log('  本机:   http://localhost:' + PORT + '/index.html');
  console.log('  DB:     ' + DB_PATH);
  console.log('  当前库存: 记录 ' + b.records.length + ' 条 / 账号 ' + b.users.length + ' 个 / 不良库 ' + b.defectLib.length + ' 条');
  console.log('  AI(百炼): ' + (AI.ready ? ('已就绪, 模型 ' + AI.ocrModel) : '未配置(填 ai-config.json 后调 /api/ai/reload)'));
  console.log('════════════════════════════════════════════');
});
