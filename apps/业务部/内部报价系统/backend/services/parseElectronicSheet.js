// 解析"电子报价单"型 xlsx
// 表头：零件名称 / 规格 / 用量 / 单价RMB / 合计RMB / 备注
// 末尾：模费/外购 + 成本汇总（零件成本 / 邦定 / 贴片 / 人工 / 测试 / 包装运输 / 含利润价 / 含税报价）
const ExcelJS = require('exceljs');

function toStr(v) {
  if (v == null) return '';
  if (typeof v === 'object' && 'richText' in v) return v.richText.map(t => t.text).join('');
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
function isHeader(values) {
  const j = values.map(toStr).join('|');
  return j.includes('零件名称') && j.includes('规格') && j.includes('用量');
}
function indexHeader(headerCells) {
  const idx = {};
  const setOnce = (k, i) => { if (idx[k] == null) idx[k] = i; };
  headerCells.forEach((v, i) => {
    const s = toStr(v);
    if (!s) return;
    if (s.includes('零件名称')) setOnce('name', i);
    else if (s.includes('规格')) setOnce('spec', i);
    else if (s.includes('用量')) setOnce('qty', i);
    else if (s.includes('单价')) setOnce('unit_price', i);
    else if (s.includes('合计')) setOnce('amount', i);
    else if (s.includes('备注')) setOnce('note', i);
  });
  return idx;
}

async function parseWorkbook(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) return { error: '工作簿为空' };

  const rows = [];
  ws.eachRow({ includeEmpty: true }, (row) => {
    const arr = [];
    row.eachCell({ includeEmpty: true }, (cell, cn) => { arr[cn] = cell.value; });
    rows.push(arr);
  });

  let headerIdx = null;
  const parts = [];
  let lastParent = null;
  const extras = { test_repair: 0, packing_shipping: 0, profit_pct: 0, tax_diff: 0, tax_payable: 0 };
  let meta = {};

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] || [];
    const joined = r.map(toStr);
    const text = joined.join('|');

    // 标题元数据
    const productMatch = text.match(/产品(?:名称|编号)[：:]\s*([^\s|]+)/);
    if (productMatch) meta.product = productMatch[1];
    const custMatch = text.match(/客户[：:]\s*([^\s|]+)/);
    if (custMatch) meta.customer = custMatch[1];
    const dateMatch = text.match(/报价日期[：:]\s*([\d.\-/]+)/);
    if (dateMatch) meta.date = dateMatch[1];

    if (!headerIdx) {
      if (isHeader(r)) headerIdx = indexHeader(r);
      continue;
    }

    // 在表头后扫描数据行
    const name = toStr(r[headerIdx.name]);
    const spec = toStr(r[headerIdx.spec]);
    const qty = toNum(r[headerIdx.qty]);
    const unitPrice = toNum(r[headerIdx.unit_price]);
    const amount = toNum(r[headerIdx.amount]);
    const note = toStr(r[headerIdx.note]);

    // 成本汇总段（散落在右侧）
    if (text.includes('零件成本') || text.includes('邦定成本') || text.includes('贴片成本')
        || text.includes('人工成本') || text.includes('测试费用') || text.includes('包装运输')
        || text.includes('含利润价') || text.includes('抵税差额') || text.includes('应交税负')
        || text.includes('含税报价') || text.includes('合计成本')) {
      // 在该行里找标签 + 紧邻数值
      for (let c = 1; c < r.length; c++) {
        const label = toStr(r[c]);
        const val = toNum(r[c + 1]);
        if (val == null) continue;
        if (label.includes('测试费用')) extras.test_repair = val;
        else if (label.includes('包装运输')) extras.packing_shipping = val;
        else if (label.includes('邦定成本')) extras.bonding_cost = val;
        else if (label.includes('贴片成本')) extras.smt_cost = val;
        else if (label.includes('人工成本')) extras.labor_cost = val;
        else if (label.includes('抵税差额')) extras.tax_diff = val;
        else if (label.includes('应交税负')) extras.tax_payable = val;
        else if (label.includes('含税报价')) extras.taxed_price = val;
        else if (label.includes('含利润价')) extras.profit_price = val;
        else if (label.includes('零件成本')) extras.parts_cost = val;
      }
      // 含 *N%利润 提取利润 %
      const profitMatch = text.match(/[*\s]*(\d{1,3})%\s*利润/);
      if (profitMatch) extras.profit_pct = +profitMatch[1];
      continue;
    }
    // 模费/外购 / 报价人 / 审核 / 核准 / 注 等说明行 — 跳过
    if (text.includes('模费') || text.includes('此报价') || text.includes('注：')
        || /报价人|审\s*核|核\s*准|签\s*字/.test(text)) continue;

    // 跳过完全空行
    if (!name && !spec && qty == null && unitPrice == null) continue;

    // 子项（name 空 + 有 spec）→ 挂到 lastParent.children
    if (!name && spec && lastParent) {
      lastParent.children = lastParent.children || [];
      lastParent.children.push({
        name: '', spec, qty: qty || 1,
        unit_price: unitPrice || 0,
        amount: amount || (qty || 0) * (unitPrice || 0),
        note,
      });
      continue;
    }
    if (name) {
      const part = {
        name, spec: spec || '',
        qty: qty || 1, unit_price: unitPrice || 0,
        amount: amount || (qty || 0) * (unitPrice || 0),
        note,
        children: [],
      };
      parts.push(part);
      lastParent = part;
    }
  }

  if (!parts.length) return { error: '未解析到任何零件行（请确认表头含 零件名称/规格/用量/单价）' };

  return { meta, parts, extras, count: parts.length, sheet_used: ws.name };
}

module.exports = { parseWorkbook };
