// 解析"产品生产排拉工序表"型 xlsx → 返回 { groups, steps }
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

function cleanGroupName(header) {
  const s = toStr(header).replace(/工序名称/g, '').trim();
  return s || '排拉工序';
}

function isPackagingGroup(name) {
  return /包装|混装|入箱|装箱|彩盒|外箱|吸塑/.test(toStr(name));
}

// 找出表头里所有 "工序名称" 和 "人数" 的列位置（可能有 2 套）
function indexHeader(values) {
  const cols = []; // [{ nameCol, countCol, noteCol, title }]
  let lastName = null;
  values.forEach((v, i) => {
    const s = toStr(v);
    if (s.includes('工序名称')) lastName = { col: i, title: cleanGroupName(s) };
    else if (s.includes('人数') && lastName != null) {
      cols.push({
        nameCol: lastName.col,
        countCol: i,
        noteCol: i + 2,
        title: lastName.title,
        kind: isPackagingGroup(lastName.title) ? 'packaging' : 'assembly',
      });
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
  // 尝试 .xlsx（ExcelJS）
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

  // 找出有"工序名称"+"人数"表头的 sheet
  let pickedSheet = null;
  for (const s of sheets) {
    if (s.rows.some(r => isHeaderRow(r))) { pickedSheet = s; break; }
  }
  if (!pickedSheet) return { error: '所有 sheet 都找不到"工序名称 / 人数"表头' };
  const ws = { name: pickedSheet.name };
  const rows = pickedSheet.rows;

  let activeGroups = null;
  let meta = {};
  const groups = [];
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

    if (isHeaderRow(r)) {
      activeGroups = indexHeader(r).map((c) => {
        const group = {
          product: c.title,
          name: c.title,
          kind: c.kind,
          qty: Number(meta.target_qty) || 1,
          steps: [],
          _cols: c,
        };
        groups.push(group);
        return group;
      });
      continue;
    }

    if (!activeGroups || !activeGroups.length) continue;

    // 数据行：遍历每组 (nameCol, countCol)
    for (const group of activeGroups) {
      const { nameCol, countCol, noteCol } = group._cols;
      const name = toStr(r[nameCol]);
      const count = toNum(r[countCol]);
      const sideLabel = toStr(r[countCol - 1]);
      if (/产能/.test(sideLabel) && count != null && count > 0) {
        group.qty = count;
        continue;
      }
      if (/合计/.test(sideLabel)) continue;
      if (!name) continue;
      if (/序号|工序名称|^生产拉线$/.test(name)) continue;
      if (/产品生产排拉工序表|产品图片|客名|货名|货号|目标数/.test(name)) continue;
      // 跳过说明/表头类行（非工序），如「功能及要求事项描述:」「注意事项」等
      if (/功能.*要求.*事项|要求事项描述|功能及要求|注意事项|^备注|^说明|描述[：:]\s*$/.test(name)) continue;
      // 工序必须有人数(>0)；人数 0/空 多为说明行或空行
      if (count == null || count <= 0) continue;
      const step = { name, count, note: toStr(r[noteCol]) };
      group.steps.push(step);
      steps.push(step);
    }
  }

  if (!steps.length) return { error: '未解析到任何工序行（请确认表头含 工序名称 / 人数）' };
  const nonEmptyGroups = groups
    .filter(g => (g.steps || []).length)
    .map(({ _cols, ...g }) => g);
  return { meta, groups: nonEmptyGroups, steps, count: steps.length, group_count: nonEmptyGroups.length, sheet_used: ws.name };
}

module.exports = { parseWorkbook };
