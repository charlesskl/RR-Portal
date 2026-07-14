// 解析"产品生产排拉工序表"型 xlsx → 返回 { steps: [{ name, count }] }
// 文件常见结构：序号1 / 工序名称 / 工具 / 人数 / 物料规格 / 重点工位注意事项
//             序号2 / 工序名称 / 工具 / 人数 / 物料规格 / 重点工位注意事项
const ExcelJS = require('exceljs');
const XLSX = require('xlsx');

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

function isHeaderRow(values) {
  const j = values.map(toStr).join('|');
  return /工序名称/.test(j) && /人数/.test(j);
}

function findLaborQuoteHeader(rows) {
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex] || [];
    const cols = { product: null, step: null, qty: null, count: null, note: null };
    row.forEach((v, i) => {
      const s = toStr(v).replace(/\s+/g, '');
      if (/^(货号或图片|产品名称|货号)$/.test(s)) cols.product = i;
      else if (/^(做工名称|工序名称)$/.test(s)) cols.step = i;
      else if (/^(总目标数量|目标数量|生产量)$/.test(s)) cols.qty = i;
      else if (s === '人数') cols.count = i;
      else if (/^备注/.test(s)) cols.note = i;
    });
    if (cols.product != null && cols.step != null && cols.qty != null && cols.count != null) {
      return { rowIndex, cols };
    }
  }
  return null;
}

function parseLaborQuoteSheet(sheet) {
  const found = findLaborQuoteHeader(sheet.rows);
  if (!found) return null;

  const assemblyGroups = [];
  const packagingGroups = [];
  let currentKind = 'assembly';
  let currentGroup = null;

  for (let i = found.rowIndex + 1; i < sheet.rows.length; i++) {
    const row = sheet.rows[i] || [];
    const product = toStr(row[found.cols.product]);
    const stepName = toStr(row[found.cols.step]);
    const qty = toNum(row[found.cols.qty]);
    const count = toNum(row[found.cols.count]);
    const note = found.cols.note != null ? toStr(row[found.cols.note]) : '';

    if (product && !/车间填写|货号或图片|合计|总计/.test(product)) {
      if (/包装|混装/.test(product)) currentKind = 'packaging';
      else if (/组装/.test(product)) currentKind = 'assembly';

      currentGroup = {
        product,
        qty: qty && qty > 0 ? qty : 1,
        team: 1,
        steps: [],
      };
      (currentKind === 'packaging' ? packagingGroups : assemblyGroups).push(currentGroup);
    }

    if (!currentGroup || !stepName || count == null || count <= 0) continue;
    if (/做工名称|工序名称|合计|总计/.test(stepName)) continue;
    if (qty && qty > 0) currentGroup.qty = qty;
    currentGroup.steps.push({ name: stepName, count, note });
  }

  const clean = groups => groups.filter(g => g.steps.length > 0);
  const assembly = clean(assemblyGroups);
  const packaging = clean(packagingGroups);
  const people = groups => groups.reduce(
    (total, group) => total + group.steps.reduce((sum, step) => sum + (toNum(step.count) || 0), 0),
    0,
  );
  const count = assembly.reduce((sum, g) => sum + g.steps.length, 0)
    + packaging.reduce((sum, g) => sum + g.steps.length, 0);

  if (!count) return { error: '识别到装工报价格式，但未解析到有效的做工名称和人数' };
  const groups = [
    ...assembly.map(group => ({ ...group, kind: 'assembly' })),
    ...packaging.map(group => ({ ...group, kind: 'packaging' })),
  ];
  return {
    format: 'labor_quote',
    meta: {
      assembly_people: people(assembly),
      packaging_people: people(packaging),
      total_people: people(assembly) + people(packaging),
    },
    assembly_groups: assembly,
    packaging_groups: packaging,
    groups,
    group_count: groups.length,
    count,
    sheet_used: sheet.name,
  };
}

// 找出表头里所有 "工序名称" 和 "人数" 的列位置（可能有 2 套）
function indexHeader(values) {
  const cols = []; // [{ nameCol, countCol }]
  let lastName = null;
  values.forEach((v, i) => {
    const s = toStr(v);
    if (s.includes('工序名称')) lastName = i;
    else if (s.includes('人数') && lastName != null) {
      cols.push({ nameCol: lastName, countCol: i });
      lastName = null;
    }
  });
  return cols;
}

// 用 SheetJS 把任意 sheet 转成 rows 数组（与 ExcelJS 输出格式一致：arr[colIdx]，1-based）
function sheetjsToRows(sheet) {
  const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });
  return aoa.map(row => {
    const arr = [];
    (row || []).forEach((v, i) => { arr[i + 1] = v; }); // 1-based
    return arr;
  });
}

async function parseWorkbook(buffer) {
  let sheets = [];
  let usedExceljs = false;
  // 尝试 .xlsx（ExcelJS）
  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    if (wb.worksheets && wb.worksheets.length) {
      usedExceljs = true;
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
  // 回退到 SheetJS（支持 .xls 旧二进制）
  if (!sheets.length) {
    try {
      const wb = XLSX.read(buffer, { type: 'buffer' });
      for (const name of wb.SheetNames) {
        sheets.push({ name, rows: sheetjsToRows(wb.Sheets[name]) });
      }
    } catch (e) {
      return { error: '解析失败：' + e.message };
    }
  }
  if (!sheets.length) return { error: '工作簿为空' };

  // 新版装工报价表：按产品分组，一次识别组装与包装人数。
  for (const sheet of sheets) {
    const grouped = parseLaborQuoteSheet(sheet);
    if (grouped) return grouped;
  }

  // 找出有"工序名称"+"人数"表头的 sheet
  let pickedSheet = null;
  for (const s of sheets) {
    if (s.rows.some(r => isHeaderRow(r))) { pickedSheet = s; break; }
  }
  if (!pickedSheet) return { error: '所有 sheet 都找不到"工序名称 / 人数"表头' };
  const ws = { name: pickedSheet.name };
  const rows = pickedSheet.rows;

  let cols = null;
  let meta = {};
  const steps = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] || [];
    const text = r.map(toStr).join('|');

    // 抓抬头元数据
    const m1 = text.match(/客名[：:]\s*([^\s|]+)/); if (m1) meta.customer = m1[1];
    const m2 = text.match(/货号[：:]\s*([^\s|]+)/); if (m2) meta.quote_no = m2[1];
    const m3 = text.match(/日期[：:]\s*([\d.\-/]+)/); if (m3) meta.date = m3[1];
    const m4 = text.match(/目标数[：:]?\s*(\d{2,})/); if (m4) meta.target_qty = Number(m4[1]);
    const m5 = text.match(/人数[：:]?\s*(\d{1,3})\s*人/); if (m5) meta.total_people = Number(m5[1]);
    const m6 = text.match(/时间[：:]?\s*(\d{1,2})\s*[Hh小时]/); if (m6) meta.work_hours = Number(m6[1]);

    if (!cols) {
      if (isHeaderRow(r)) cols = indexHeader(r);
      continue;
    }

    // 数据行：遍历每组 (nameCol, countCol)
    for (const { nameCol, countCol } of cols) {
      const name = toStr(r[nameCol]);
      const count = toNum(r[countCol]);
      if (!name) continue;
      if (/序号|工序名称|^生产拉线$/.test(name)) continue;
      // 跳过说明/表头类行（非工序），如「功能及要求事项描述:」「注意事项」等
      if (/功能.*要求.*事项|要求事项描述|功能及要求|注意事项|^备注|^说明|描述[：:]\s*$/.test(name)) continue;
      // 工序必须有人数(>0)；人数 0/空 多为说明行或空行
      if (count == null || count <= 0) continue;
      steps.push({ name, count });
    }
  }

  if (!steps.length) return { error: '未解析到任何工序行（请确认表头含 工序名称 / 人数）' };
  return { meta, steps, count: steps.length, sheet_used: ws.name };
}

module.exports = { parseWorkbook };
