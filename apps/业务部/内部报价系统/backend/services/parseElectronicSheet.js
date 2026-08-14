// 解析"电子报价单"型 xlsx
// 表头：零件名称 / 规格 / 用量 / 单价RMB(或 USD) / 合计RMB(或 USD) / 备注
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
  if (typeof v === 'object' && 'result' in v) {
    const result = Number(v.result);
    return Number.isNaN(result) ? null : result;
  }
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

function detectCurrency(ws, rows, headerRow) {
  const headerText = (headerRow || []).map(toStr).join('|').toUpperCase();
  const sheetText = String(ws.name || '').toUpperCase();
  const workbookText = rows.map(r => (r || []).map(toStr).join('|')).join('\n').toUpperCase();
  const usdSignals = [];
  const rmbSignals = [];
  if (/单价\s*USD|合计\s*USD/.test(headerText)) usdSignals.push('表头标注 USD');
  if (/单价\s*RMB|合计\s*RMB/.test(headerText)) rmbSignals.push('表头标注 RMB');
  if (/\bUSD\b/.test(sheetText)) usdSignals.push('工作表名称含 USD');
  if (/\bRMB\b/.test(sheetText)) rmbSignals.push('工作表名称含 RMB');
  if (/USD\s*(?:不含税|含税)|(?:不含税|含税)\s*USD|模费[^\n|]*USD/.test(workbookText)) usdSignals.push('报价内容标注 USD');
  if (/RMB\s*(?:不含税|含税)|(?:不含税|含税)\s*RMB|模费[^\n|]*RMB/.test(workbookText)) rmbSignals.push('报价内容标注 RMB');

  const headerCurrency = usdSignals[0] === '表头标注 USD' ? 'USD'
    : (rmbSignals[0] === '表头标注 RMB' ? 'RMB' : null);
  const currency = headerCurrency || (usdSignals.length > rmbSignals.length ? 'USD' : 'RMB');
  return {
    currency,
    confidence: headerCurrency ? 'high' : (usdSignals.length || rmbSignals.length ? 'medium' : 'low'),
    conflict: usdSignals.length > 0 && rmbSignals.length > 0 && !headerCurrency,
    signals: currency === 'USD' ? usdSignals : rmbSignals,
    all_signals: { USD: usdSignals, RMB: rmbSignals },
  };
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
  let headerRow = null;
  const parts = [];
  let lastParent = null;
  const extras = { test_repair: 0, packing_shipping: 0, profit_pct: 0, tax_diff: 0, tax_payable: 0 };
  let meta = {};

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] || [];
    const joined = r.map(toStr);
    const text = joined.join('|');

    // 标题元数据
    const productMatch = text.match(/产品名称[：:]\s*(.*?)(?=产品编号|客户|报价日期|\|)/);
    if (productMatch && productMatch[1].trim()) meta.product = productMatch[1].trim();
    const productNoMatch = text.match(/产品编号[：:]\s*([^\s|]+)/);
    if (productNoMatch) meta.product_no = productNoMatch[1];
    const custMatch = text.match(/客户[：:]\s*(.*?)(?=报价日期|\|)/);
    if (custMatch && custMatch[1].trim()) meta.customer = custMatch[1].trim();
    const dateMatch = text.match(/报价日期[：:]\s*([\d.\-/]+)/);
    if (dateMatch) meta.date = dateMatch[1];

    if (!headerIdx) {
      if (isHeader(r)) {
        headerIdx = indexHeader(r);
        headerRow = r;
      }
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
        else if (label.includes('合计成本')) extras.total_cost = val;
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
        name: '', spec, qty: qty ?? 1,
        unit_price: unitPrice ?? 0,
        amount: amount ?? (qty ?? 0) * (unitPrice ?? 0),
        note,
      });
      continue;
    }
    if (name) {
      const part = {
        name, spec: spec || '',
        qty: qty ?? 1, unit_price: unitPrice ?? 0,
        amount: amount ?? (qty ?? 0) * (unitPrice ?? 0),
        note,
        children: [],
      };
      parts.push(part);
      lastParent = part;
    }
  }

  if (!parts.length) return { error: '未解析到任何零件行（请确认表头含 零件名称/规格/用量/单价）' };

  const currencyDetection = detectCurrency(ws, rows, headerRow);
  const sourceCurrency = currencyDetection.currency;
  const fullText = rows.map(r => (r || []).map(toStr).join('|')).join('\n');
  const moldFees = [];
  for (const match of fullText.matchAll(/([^\n|：:]{0,20}模费)\s*[：:]\s*(?:USD|RMB|HKD|HK\$|￥|¥)?\s*([\d,.]+)/gi)) {
    moldFees.push({ name: match[1].trim(), amount: Number(match[2].replace(/,/g, '')), currency: sourceCurrency });
  }
  if (moldFees.length) extras.mold_fees = moldFees;
  const moqMatch = fullText.match(/MOQ\s*[：:]?\s*([\d,.]+)\s*([Kk万]?)/i);
  if (moqMatch) {
    let moq = Number(moqMatch[1].replace(/,/g, ''));
    if (/K/i.test(moqMatch[2])) moq *= 1000;
    else if (moqMatch[2] === '万') moq *= 10000;
    meta.moq = moq;
  }
  meta.tax_label = /USD\s*不含税|不含税价/.test(fullText) ? '不含税'
    : (/含税报价|含税价/.test(fullText) ? '含税' : '含税');

  const computedPartsCost = parts.reduce((total, part) => total + (part.amount ?? part.qty * part.unit_price)
    + (part.children || []).reduce((childTotal, child) => childTotal + (child.amount ?? child.qty * child.unit_price), 0), 0);
  const computedTotalCost = computedPartsCost + ['bonding_cost', 'smt_cost', 'labor_cost', 'test_repair', 'packing_shipping']
    .reduce((total, key) => total + (Number(extras[key]) || 0), 0);
  const computedProfitPrice = computedTotalCost * (1 + (Number(extras.profit_pct) || 0) / 100);
  const tolerance = 0.000001;
  const validation = {
    parts_cost: { expected: extras.parts_cost ?? null, actual: computedPartsCost, ok: extras.parts_cost == null || Math.abs(extras.parts_cost - computedPartsCost) <= tolerance },
    total_cost: { expected: extras.total_cost ?? null, actual: computedTotalCost, ok: extras.total_cost == null || Math.abs(extras.total_cost - computedTotalCost) <= tolerance },
    profit_price: { expected: extras.profit_price ?? null, actual: computedProfitPrice, ok: extras.profit_price == null || Math.abs(extras.profit_price - computedProfitPrice) <= tolerance },
  };
  validation.ok = validation.parts_cost.ok && validation.total_cost.ok && validation.profit_price.ok;

  const markSourceCurrency = row => {
    row.currency = sourceCurrency;
    row.source_unit_price = row.unit_price;
    row.source_amount = row.amount;
    (row.children || []).forEach(markSourceCurrency);
  };
  parts.forEach(markSourceCurrency);

  return {
    meta, parts, extras, count: parts.length, sheet_used: ws.name,
    source_currency: sourceCurrency,
    currency_detection: currencyDetection,
    validation,
  };
}

module.exports = { parseWorkbook };
