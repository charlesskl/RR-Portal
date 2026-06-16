// 解析"车缝报价单"型 xlsx
// 期望结构：每个产品分组顶部有一个标题行（一般是合并单元格 + 浅色填充），
// 紧接着是表头行（物料名称 / 裁片部位 / 供应商 / ... / 用量 / 单价 / 成本 / 码点 / 价钱 / 备注），
// 然后是若干物料行 + 人工行（裁床人工 / 车缝人工 / 手工人工），
// 末行 "合计 ¥xx.xx"
// 多个产品在同一工作表里堆叠。
const ExcelJS = require('exceljs');

const HEADER_KEYS = ['物料名称', '裁片部位', '用量', '单价', '价钱'];

function toStr(v) {
  if (v == null) return '';
  if (typeof v === 'object' && 'richText' in v) {
    return v.richText.map(t => t.text).join('');
  }
  if (typeof v === 'object' && 'text' in v) return String(v.text);
  if (typeof v === 'object' && 'result' in v) return String(v.result);
  return String(v).trim();
}

function toNum(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'object' && 'result' in v) return Number(v.result) || null;
  const n = Number(String(v).replace(/[^\d.\-]/g, ''));
  return isNaN(n) ? null : n;
}

function isHeaderRow(values) {
  const joined = values.map(toStr).join('|');
  return HEADER_KEYS.every(k => joined.includes(k));
}

// 给一行的 header 单元格，建 colIndex 索引（1-based）
function buildHeaderIndex(headerCells) {
  const idx = {};
  const setOnce = (key, i) => { if (idx[key] == null) idx[key] = i; };
  headerCells.forEach((v, i) => {
    const s = toStr(v);
    if (!s) return;
    // 只取第一次匹配，避免右侧"显示客人单价/用量/总价"等额外列覆盖
    if (s.includes('物料名称')) setOnce('material', i);
    else if (s.includes('裁片部位')) setOnce('part', i);
    else if (s.includes('供应商')) setOnce('supplier', i);
    else if (s.includes('用量')) setOnce('qty', i);
    else if (s === '单价' || s.includes('单价')) setOnce('unit_price', i);
    else if (s.includes('成本')) setOnce('cost', i);
    else if (s.includes('码点')) setOnce('markup', i);
    else if (s.includes('价钱')) setOnce('price', i);
    else if (s.includes('备注')) setOnce('note', i);
  });
  return idx;
}

async function parseWorkbook(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) return { error: '工作簿为空' };

  // 抓出每行 values（1-based 的数组）
  const rows = [];
  ws.eachRow({ includeEmpty: true }, (row, rn) => {
    const arr = [];
    row.eachCell({ includeEmpty: true }, (cell, cn) => { arr[cn] = cell.value; });
    rows.push(arr);
  });

  const groups = [];
  let cur = null;
  let headerIdx = null;
  let pendingTitle = null;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] || [];
    const joined = r.map(toStr).filter(Boolean);
    if (!joined.length) { continue; }

    // header 行 → 新分组开始
    if (isHeaderRow(r)) {
      headerIdx = buildHeaderIndex(r);
      const name = pendingTitle || ('产品 ' + (groups.length + 1));
      cur = { name, items: [], labor_amount: 0, sub_parts: [] };
      groups.push(cur);
      pendingTitle = null;
      continue;
    }

    // 全行只有 1 个 cell + 不是 header → 视为下一分组的标题
    if (joined.length <= 2 && !isHeaderRow(r) && !headerIdx) {
      pendingTitle = joined.join(' ');
      continue;
    }

    if (!cur || !headerIdx) continue;

    const matName = toStr(r[headerIdx.material]);
    const part = toStr(r[headerIdx.part]);
    const price = toNum(r[headerIdx.price]);
    const qty = toNum(r[headerIdx.qty]);
    const unitPrice = toNum(r[headerIdx.unit_price]);

    // 合计行
    if (matName.includes('合计') || (part === '' && matName === '' && price != null && qty == null)) {
      // 重置 header 等待下一个产品
      headerIdx = null;
      continue;
    }

    // 仅当行没有 价钱 和 用量 → 跳过
    if (matName === '' && qty == null && price == null) continue;

    // 人工类
    if (/裁床人工|车缝人工|手工人工|人工/.test(matName)) {
      cur.labor_amount = (cur.labor_amount || 0) + (price || 0);
      cur.items.push({
        material: matName, part: part || '',
        qty: qty || 1, unit_price: unitPrice || price || 0,
        markup: toNum(r[headerIdx.markup]) || 1,
        price: price || 0,
        note: toStr(r[headerIdx.note]),
        is_labor: true,
      });
      continue;
    }

    cur.items.push({
      material: matName,
      part: part || '',
      supplier: toStr(r[headerIdx.supplier]),
      qty: qty || 0,
      unit_price: unitPrice || 0,
      cost: toNum(r[headerIdx.cost]) || 0,
      markup: toNum(r[headerIdx.markup]) || 1,
      price: price || 0,
      note: toStr(r[headerIdx.note]),
    });
  }

  if (!groups.length) return { error: '没有解析到任何产品分组（请确认表头含 物料名称/裁片部位/用量/单价/价钱）' };

  return { groups, count: groups.length, sheet_used: ws.name };
}

module.exports = { parseWorkbook };
