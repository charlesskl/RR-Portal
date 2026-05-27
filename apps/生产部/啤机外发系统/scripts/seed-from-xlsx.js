// Seed JSON data files from the source Excel.
// Run: node scripts/seed-from-xlsx.js [path-to-xlsx]
const fs = require('fs');
const path = require('path');

const XLSX_PATH = process.argv[2] || 'C:\\DL\\啤机外发\\2026年啤机外发模具表.2026-4-27最新更新.xlsx';
const DATA_DIR = path.join(__dirname, '..', 'server', 'data');
const { workshopFromPmc } = require('../server/pmc-workshop-map');

let XLSX;
try { XLSX = require('xlsx'); } catch (e) {
  console.error('Missing dep: xlsx. Run `npm i xlsx` in scripts/ first.');
  process.exit(1);
}

function nid() {
  return Math.random().toString(36).slice(2, 12);
}

function pad2(n) { return String(n).padStart(2, '0'); }
function dateToISO(d) {
  // xlsx (cellDates:true) builds Date in local time — use local accessors
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function toISO(v) {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'number') {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    const d = new Date(epoch.getTime() + Math.round(v) * 86400000);
    return dateToISO(d);
  }
  if (v instanceof Date) return dateToISO(v);
  const s = String(v).trim();
  const m = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
  if (m) return `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`;
  return '';
}

function toNum(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}

const wb = XLSX.readFile(XLSX_PATH, { cellDates: true });

// Forward-fill values across merged-cell ranges so that rows visually under a
// merged 供应商/PMC/货号/日期 cell receive the same value as the top row.
function fillMergedCells(ws) {
  const merges = ws['!merges'] || [];
  for (const m of merges) {
    const topAddr = XLSX.utils.encode_cell({ r: m.s.r, c: m.s.c });
    const top = ws[topAddr];
    if (!top || top.v === undefined || top.v === null || top.v === '') continue;
    for (let r = m.s.r; r <= m.e.r; r++) {
      for (let c = m.s.c; c <= m.e.c; c++) {
        if (r === m.s.r && c === m.s.c) continue;
        ws[XLSX.utils.encode_cell({ r, c })] = { ...top };
      }
    }
  }
}
for (const name of wb.SheetNames) fillMergedCells(wb.Sheets[name]);

// ---- 外发明细 ----
{
  const ws = wb.Sheets['外发明细'];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: '' });
  // Row 1: title; Row 2: headers; Row 3+: data
  const out = [];
  for (let i = 2; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length < 5) continue;
    const mold = (r[4] || '').toString().trim();
    if (!mold) continue;
    const pmcRaw = (r[14] || '').toString().trim();
    const workshopFromExcel = (r[2] || '').toString().trim();
    // Derive workshop from PMC; fall back to Excel column 车间 if PMC isn't mapped
    const derivedWorkshop = workshopFromPmc(pmcRaw) || workshopFromExcel;
    out.push({
      id: nid(),
      seq: (r[1] || '').toString().trim() || null,
      workshop: derivedWorkshop,
      item_code: (r[3] || '').toString().trim() || '',
      mold,
      order_qty_pcs: toNum(r[5]),
      order_qty_shots: toNum(r[6]),
      quoted_capacity: toNum(r[7]),
      actual_capacity: toNum(r[8]),
      // estimated_days: r[9] — computed
      quote_price_usd: toNum(r[10]),
      supplier_price_rmb: toNum(r[11]),
      supplier_price_usd: toNum(r[12]),
      supplier: (r[13] || '').toString().trim() || '',
      pmc_follow: pmcRaw,
      order_date: toISO(r[15]),
      production_start: toISO(r[16]),
      estimated_delivery: toISO(r[17]),
      remark: (r[18] || '').toString().trim() || '',
      status: 'open',
      // seed records are backdated so they don't trigger the "new order" highlight
      created_at: '2025-01-01T00:00:00.000Z',
      updated_at: '2025-01-01T00:00:00.000Z',
    });
  }
  fs.writeFileSync(path.join(DATA_DIR, 'orders.json'), JSON.stringify(out, null, 2), 'utf8');
  console.log(`✓ orders.json — ${out.length} 条`);
}

// ---- 外发加工厂明细 ----
{
  const ws = wb.Sheets['外发加工厂明细'];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: '' });
  const out = [];
  for (let i = 2; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r[1]) continue;
    const name = (r[1] || '').toString().trim();
    if (!name) continue;
    out.push({
      id: nid(),
      seq: (r[0] || '').toString().trim() || null,
      name,
      total_machines: toNum(r[2]),
      machines_for_xx: toNum(r[3]),
      xx_ratio: toNum(r[4]),
      actual_running: toNum(r[5]),
      running_rate: toNum(r[6]),
      contact: (r[7] || '').toString().trim() || '',
      address: (r[8] || '').toString().trim() || '',
      mold_count: toNum(r[9]),
      remark: (r[10] || '').toString().trim() || '',
    });
  }
  fs.writeFileSync(path.join(DATA_DIR, 'suppliers.json'), JSON.stringify(out, null, 2), 'utf8');
  console.log(`✓ suppliers.json — ${out.length} 条`);
}

// ---- PC料 ----
{
  const ws = wb.Sheets['PC料'];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: '' });
  const out = [];
  for (let i = 2; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r[1]) continue;
    const factory = (r[1] || '').toString().trim();
    if (!factory || factory.startsWith('备注')) continue;
    out.push({
      id: nid(),
      seq: (r[0] || '').toString().trim() || null,
      factory,
      item_code: (r[2] || '').toString().trim() || '',
      mold: (r[3] || '').toString().trim() || '',
      mold_sets: (r[4] || '').toString().trim() || '',
      remark: (r[5] || '').toString().trim() || '',
    });
  }
  fs.writeFileSync(path.join(DATA_DIR, 'pc_orders.json'), JSON.stringify(out, null, 2), 'utf8');
  console.log(`✓ pc_orders.json — ${out.length} 条`);
}
