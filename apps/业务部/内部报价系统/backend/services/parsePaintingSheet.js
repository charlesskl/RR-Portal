// 解析"喷油核价表"型 xlsx → 返回 { meta, items, count, sheet_used }
// 常见表头：图片 | 位置 | 夹模 | 夹模单价 | 移印 | 移印单价 | 散枪 | 散枪单价 |
//           边模 | 边模单价 | 油色 | 油色价格 | 浸油 | 浸油单价 | 抹油 | 抹油单价 |
//           擦PP水 | 擦PP水单价 | UV | UV单价 | 总报价 | 备注
const ExcelJS = require('exceljs');
const XLSX = require('xlsx');

// 工序：数量列 = 表头恰为 label；单价列 = 紧邻其右一列
const PROCS = [
  { key: 'clamp', label: '夹模' },
  { key: 'pad',   label: '移印' },
  { key: 'spray', label: '散枪' },
  { key: 'edge',  label: '边模' },
  { key: 'color', label: '油色' },
  { key: 'dip',   label: '浸油' },
  { key: 'oil',   label: '抹油' },
  { key: 'pp_water', label: '擦PP水' },
  { key: 'uv', label: 'UV' },
];

function toStr(v) {
  if (v == null) return '';
  if (typeof v === 'object' && 'richText' in v) return v.richText.map(t => t.text).join('');
  if (typeof v === 'object' && 'text' in v) return String(v.text);
  if (typeof v === 'object' && 'result' in v) return String(v.result);
  return String(v).trim();
}
function toNum(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'object' && 'result' in v) return Number(v.result) || 0;
  const n = Number(String(v).replace(/[^\d.\-]/g, ''));
  return isNaN(n) ? 0 : n;
}

function isHeaderRow(values) {
  const j = values.map(toStr).join('|');
  return /位置/.test(j) && /(夹模|移印|散枪|边模|抹油)/.test(j);
}

// 只有“1#公仔 / 2#产品”这类明确编号才视为产品边界。
// 图片、空白分隔行和零件名称都不能单独触发多产品配比。
function parseProductLabel(value) {
  const text = toStr(value).replace(/\s+/g, ' ').trim();
  const match = text.match(/^(\d+)\s*[#＃号]\s*(.*)$/);
  if (!match) return null;
  const number = Number(match[1]);
  return {
    id: `product-${number}`,
    name: text || `${number}#产品`,
    number,
  };
}

// SheetJS sheet → 1-based 行数组（与 ExcelJS 输出一致）
function sheetjsToRows(sheet) {
  const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });
  return aoa.map(row => {
    const arr = [];
    (row || []).forEach((v, i) => { arr[i + 1] = v; });
    return arr;
  });
}

// 按表头定位列：名称 / 位置 / 备注 / 各工序数量列(+右邻单价列)
function indexHeader(values) {
  const map = { name: null, position: null, note: null, procs: {} };
  values.forEach((v, i) => {
    const s = toStr(v);
    if (s === '名称') map.name = i;
    else if (s === '位置') map.position = i;
    else if (/^备注/.test(s)) map.note = i;
    else {
      const p = PROCS.find(p => p.label === s);
      if (p) map.procs[p.key] = { qty: i, unit: i + 1 };
    }
  });
  return map;
}

async function parseWorkbook(buffer) {
  let sheets = [];
  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    if (wb.worksheets && wb.worksheets.length) {
      for (const ws of wb.worksheets) {
        const tmp = [];
        ws.eachRow({ includeEmpty: true }, (row) => {
          const arr = [];
          row.eachCell({ includeEmpty: true }, (cell, cn) => { arr[cn] = cell.value; });
          tmp.push(arr);
        });
        sheets.push({ name: ws.name, rows: tmp });
      }
    }
  } catch {}
  if (!sheets.length) {
    try {
      const wb = XLSX.read(buffer, { type: 'buffer' });
      for (const name of wb.SheetNames) sheets.push({ name, rows: sheetjsToRows(wb.Sheets[name]) });
    } catch (e) {
      return { error: '解析失败：' + e.message };
    }
  }
  if (!sheets.length) return { error: '工作簿为空' };

  let picked = null;
  for (const s of sheets) {
    if (s.rows.some(r => isHeaderRow(r))) { picked = s; break; }
  }
  if (!picked) return { error: '所有 sheet 都找不到喷油表头（位置 / 夹模…）' };
  const rows = picked.rows;

  const meta = {};
  let cols = null;
  const items = [];
  let currentProduct = null;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] || [];
    if (!cols) {
      // 表头之前的首个非空单元格作标题
      if (!meta.title) {
        const first = r.map(toStr).find(Boolean);
        if (first && !isHeaderRow(r)) meta.title = first.trim();
      }
      if (isHeaderRow(r)) cols = indexHeader(r);
      continue;
    }
    const first = toStr(r[1]);
    if (/合计|小计|总报价/.test(first)) continue; // 跳过底部合计行（"合计"在首列）
    const name = cols.name != null ? toStr(r[cols.name]) : '';
    const position = cols.position != null ? toStr(r[cols.position]) : '';
    const explicitProduct = parseProductLabel(name);
    if (explicitProduct) currentProduct = explicitProduct;
    if (!name && !position) continue; // 跳过分隔空行
    if (/合计|小计|总报价/.test(position) || /[:：]\s*$/.test(position)) continue; // 跳过合计/图例(如"夹模：")
    const item = {
      name,
      position,
      note: cols.note != null ? toStr(r[cols.note]) : '',
      _row: i,
      _product_marker: currentProduct,
    };
    let hasQty = false;
    for (const p of PROCS) {
      const c = cols.procs[p.key];
      const qty = c ? toNum(r[c.qty]) : 0;
      const unit = c ? toNum(r[c.unit]) : 0;
      item[p.key + '_qty'] = qty;
      item[p.key + '_unit'] = unit;
      if (qty > 0) hasQty = true;
    }
    if (!hasQty) continue; // 位置有但无任何工序数量 → 多为说明行
    items.push(item);
  }

  if (!items.length) return { error: '未解析到喷油工序行（请确认表头含 位置 / 夹模…）' };
  const distinctProducts = new Map();
  items.forEach(item => {
    if (item._product_marker) distinctProducts.set(item._product_marker.id, item._product_marker);
  });
  const isMultiProduct = distinctProducts.size > 1;
  items.forEach(item => {
    if (isMultiProduct && item._product_marker) {
      item.product_group_id = item._product_marker.id;
      item.product_group_name = item._product_marker.name;
    }
    delete item._product_marker;
  });
  const productGroups = isMultiProduct
    ? [...distinctProducts.values()].sort((a, b) => a.number - b.number)
    : [];
  return {
    meta,
    items,
    count: items.length,
    sheet_used: picked.name,
    product_groups: productGroups,
    multi_product: isMultiProduct,
  };
}

module.exports = { parseWorkbook };
