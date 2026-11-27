/**
 * Excel写入模块
 *
 * 策略：
 *   1. 尝试用exceljs直接写入原文件（只填非公式列）
 *   2. 如果原文件有共享公式读不了，自动生成粘贴用临时表
 *
 * 颜色：新增蓝色，扣数红色提示
 */
const ExcelJS = require('exceljs');

// exceljs共享公式问题已在 node_modules/exceljs/lib/xlsx/xform/sheet/cell-xform.js 中修复

const HKD_RATE = 7.75;
const DATE_FMT = 'yyyy/m/d"周"aaa';

// 颜色规范（和排期表一致）
const FILL_YELLOW = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } }; // 黄色填充 = 新加单
const FILL_PINK = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF99CC' } };   // 粉色填充 = 扣单/转单

// ============================================================
// 公共工具
// ============================================================

/**
 * 把 PDF 抽取的原始包装文字映射到用户习惯的标准命名
 * 参考排期表历史数据得出：
 *   Jazwares + NL 语言 → "Jazwares客版（NL）"
 *   COUK / Character Options / Smyths → "Toy客版本"
 *   US Generic / Sky Castle English artwork → "第三代美文版" 或 "第二代美文版"（按系列）
 *   Jazwares + US Generic → "Jazwares客版（美文）"
 *   韩国 / 希腊 → "韩国客版" / "希腊客版"
 *   其他 → 原文
 */
function standardizePackaging(rawPackaging, po, series) {
  if (!rawPackaging) return '';
  const text = String(rawPackaging).trim();
  const shipTo = (po.shipTo || '').toLowerCase();
  const isCharOption = /character options|smyths|ukco/i.test(shipTo) || /\bCOUK\b/i.test(text);
  const isKorean = /korea|韩国/i.test(shipTo);
  const isGreek = /greek|greece|希腊/i.test(shipTo);
  // "US Generic packaging" / "US PACKAGING" / "Sky Castle English artwork" 等都视为美文版
  const isUSGeneric = /\bus\s*(generic|packaging)|sky castle english|generic packaging/i.test(text);

  // 1. NL 语言模式（如 "2L ENGLISH/FRENCH"）— 最特定
  const langMatch = text.match(/(\d+)L\s+[A-Z]+(?:\/[A-Z]+)+/i);
  if (langMatch) {
    const n = langMatch[1];
    if (n !== '2' && /^jazwares\b/i.test(shipTo)) return `Jazwares客版（${n}L）`;
    return `${n}L客版`;
  }

  // 2. COUK / Character Options → Toy客版本
  if (/\bCOUK\b/i.test(text) || (isCharOption && !isUSGeneric)) {
    return 'Toy客版本';
  }

  // 3. US Generic / Sky Castle English → 美文版
  if (isUSGeneric) {
    if (series === '三代') return '第三代美文版';
    if (series === '二代' || series === '一代') return '第二代美文版';
    return '美文版';
  }

  // 4. 特定地区客户
  if (isKorean) return '韩国客版';
  if (isGreek) return '希腊客版';

  // 5. 其他保留原文
  return text;
}

/** 从"名称"sheet构建产品查找表（用xlsx读，不怕公式） */
/**
 * 名称 sheet 里没有这个 SKU 时，按前缀规则推断系列
 *
 * 三代 SkyCastle:
 *   - SR + 3 位字母 + 4 位数字   (SRBFF3703)
 *   - SR + 2 位字母 + 3~4 位数字 (SRAP1302, SRMC201, SRAP8002)
 *   - SR + 4 位数字              (SR1023, SR1602, SR2013, SR3013, SR3203, SR8003)
 *   - JS + 4 位数字              (JS1003)
 *   - JS + 2 位字母 + 3 位数字   (JSSM100)
 *
 * 一二代：
 *   - SR + 3 位数字 (SR100, SR300, SR600, SR101, SR102)
 *   - JS + 3 位数字 (JS300)
 *
 * 蛋糕：JC 开头
 *
 * 注：用 (?!\d) 锁死位数，避免 SR1023 被 3 位数字规则误匹配
 */
function inferSeries(partNo) {
  if (!partNo) return '';
  const sku = String(partNo).toUpperCase();

  if (sku.startsWith('JC')) return '蛋糕';

  // 三代规则（按特异性排序）
  if (/^SR[A-Z]{3}\d{4}(?!\d)/.test(sku)) return '三代';
  if (/^SR[A-Z]{2}\d{3,4}(?!\d)/.test(sku)) return '三代';
  if (/^SR\d{4}(?!\d)/.test(sku)) return '三代';
  if (/^JS\d{4}(?!\d)/.test(sku)) return '三代';
  if (/^JS[A-Z]{2}\d{3}(?!\d)/.test(sku)) return '三代';

  // 一二代规则
  if (/^SR\d{3}(?!\d)/.test(sku)) return '二代';
  if (/^JS\d{3}(?!\d)/.test(sku)) return '二代';

  // 实在认不出，默认三代（当前业务主力）
  return '三代';
}

function buildProductLookup(excelPath) {
  const XLSX = require('xlsx');
  const raw = XLSX.readFile(excelPath);
  const ws = raw.Sheets['名称'];
  if (!ws) return {};
  const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
  const headers = data[0] || [];
  const lookup = {};
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row || !row[0]) continue;
    lookup[String(row[0]).trim()] = {};
    headers.forEach((h, ci) => {
      if (ci > 0 && row[ci] != null) lookup[String(row[0]).trim()][h] = row[ci];
    });
  }
  return lookup;
}

/** 读取产品列映射 */
function readProductColumnMap(excelPath, sheetName, headerRow, startCol, endCol) {
  const XLSX = require('xlsx');
  const raw = XLSX.readFile(excelPath);
  const ws = raw.Sheets[sheetName];
  if (!ws) return {};
  const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
  const row = data[headerRow];
  if (!row) return {};
  const map = {};
  for (let c = startCol; c <= Math.min(endCol, row.length - 1); c++) {
    if (row[c]) String(row[c]).split('/').forEach(s => { map[s.trim()] = c + 1; }); // +1转exceljs列号
  }
  return map;
}

function matchProdCol(map, partNo) {
  if (map[partNo] != null) return map[partNo];
  const base = partNo.replace(/[A-Z]$/, '');
  if (base !== partNo && map[base] != null) return map[base];
  for (const [h, c] of Object.entries(map)) {
    if (h.includes(partNo) || partNo.includes(h)) return c;
  }
  return -1;
}

function extractClientName(po) {
  if (!po.shipTo) return '';
  let name = po.shipTo.split(',')[0].trim();
  // 去掉括号及里面的内容，如 "Character Options [UKCOXXX]" → "Character Options"
  name = name.replace(/\s*[\[\(（【].*?[\]\)）】]\s*/g, '').trim();
  return name;
}

/**
 * 设置单元格值
 * @param {object} ws - worksheet
 * @param {number} rowNum - 行号
 * @param {number} col - 列号
 * @param {*} value - 值
 * @param {object} [fill] - 填充色（如 FILL_YELLOW），不传则不设填充
 */
function setCell(ws, rowNum, col, value, fill) {
  if (value == null || value === '') return;
  const cell = ws.getRow(rowNum).getCell(col);
  const isDateStr = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
  if (isDateStr) {
    const parts = value.split('-');
    const serial = Math.round((new Date(Date.UTC(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]))) - new Date(Date.UTC(1899, 11, 30))) / 86400000);
    cell.value = serial;
  } else {
    cell.value = value;
  }
  if (isDateStr) cell.numFmt = DATE_FMT;
  if (fill) cell.fill = fill;
}

/**
 * 复制一行的格式（边框、填充、对齐、数字格式）到新行的所有列
 * 这样新行会继承表格的样式
 */
const _styleCache = new WeakMap();
function copyRowStyle(ws, sourceRowNum, targetRowNum) {
  // 缓存：同一sheet同一源行只读一次
  const cacheKey = `${sourceRowNum}`;
  let styles = _styleCache.get(ws);
  if (!styles) { styles = {}; _styleCache.set(ws, styles); }

  if (!styles[cacheKey]) {
    const srcRow = ws.getRow(sourceRowNum);
    const colStyles = {};
    const colCount = srcRow.cellCount || 80;
    for (let c = 1; c <= colCount; c++) {
      const srcCell = srcRow.getCell(c);
      colStyles[c] = {
        border: srcCell.border ? JSON.parse(JSON.stringify(srcCell.border)) : undefined,
        fill: srcCell.fill ? JSON.parse(JSON.stringify(srcCell.fill)) : undefined,
        alignment: srcCell.alignment ? JSON.parse(JSON.stringify(srcCell.alignment)) : undefined,
        // 不复制numFmt，由setCell根据值类型自行设置（避免数字列变成日期格式）
      };
    }
    // 也复制行高
    styles[cacheKey] = { colStyles, height: srcRow.height };
  }

  const { colStyles, height } = styles[cacheKey];
  const tgtRow = ws.getRow(targetRowNum);
  if (height) tgtRow.height = height;
  for (const [c, style] of Object.entries(colStyles)) {
    const cell = tgtRow.getCell(Number(c));
    if (style.border) cell.border = style.border;
    if (style.fill) cell.fill = style.fill;
    if (style.alignment) cell.alignment = style.alignment;
  }
}

/** 找最后一条数据行：只看PO列，匹配实际的PO号格式 */
function findLastDataRow(ws, poCol) {
  let last = 2;
  ws.eachRow((row, rowNum) => {
    if (rowNum <= 2) return;
    const raw = row.getCell(poCol).value;
    if (!raw) return;
    // 浮点数直接跳过（PO号不可能是小数，小数一定是金额合计）
    if (typeof raw === 'number' && !Number.isInteger(raw)) return;

    let v = raw;
    if (typeof v === 'object' && v !== null) {
      if (v.result != null) v = v.result;
      else if (v.richText) v = v.richText.map(t => t.text).join('');
      else v = String(v);
    }
    // 公式结果也检查浮点
    if (typeof v === 'number' && !Number.isInteger(v)) return;

    const s = String(v).trim();
    if (!s) return;

    const isShortChinese = /^[\u4e00-\u9fff]{1,4}$/.test(s);
    const isSummary = /合计|以下|类型|填充|字体|标注|备注/.test(s);
    const isSingleLetter = /^[A-Z]$/i.test(s);
    const isPureInt = /^\d+$/.test(s);

    if (isSummary || isShortChinese || isSingleLetter) return;
    if (isPureInt && s.length >= 5) last = rowNum;     // 纯整数5位以上 (如10114426)
    else if (!isPureInt && /\d/.test(s)) last = rowNum; // 字母+数字混合 (如PO0000156, CAJZ039)
    else if (s.includes('转单')) last = rowNum;          // 内部转单
  });
  return last;
}

// ============================================================
/**
 * 在指定行后面插入空行（把下面的内容往下推，保留合计行等）
 * @param {object} ws - worksheet
 * @param {number} afterRow - 在这行后面插入
 * @param {number} count - 插入多少行
 */
function insertEmptyRows(ws, afterRow, count) {
  if (count <= 0) return;
  // exceljs的insertRows：在afterRow+1的位置插入count行空行
  // 这会把afterRow+1及以下的所有行往下移
  const emptyRows = [];
  for (let i = 0; i < count; i++) emptyRows.push([]);
  ws.insertRows(afterRow + 1, emptyRows);
}

/** 从排期Excel提取所有已有的PO号 */
function getExistingPOs(raw, type) {
  const XLSX_utils = require('xlsx').utils;
  const poSet = new Set();
  const currentSky = type === 'skycastle' && raw.Sheets['四代排期'];

  // 从总排期/排期sheet读PO列
  let sheets, poCol;
  if (type === 'tomy') {
    sheets = ['KIK总排期', 'RRM总排期', '总排期'];
    poCol = 5;
  } else if (type === 'jaz_plastic') {
    sheets = ['CMW+NER+PKW客排', 'CMW+NER+PKW仓排'];
    poCol = 6;  // col 7 "现PO" (0-indexed 6)
  } else if (type === 'jaz_costume') {
    sheets = ['JWC客排', 'JWC仓排'];
    poCol = 7;  // col 8 "现PO" (0-indexed 7)
  } else if (type === 'skycastle') {
    sheets = ['一二代排期', '三代排期', '四代排期', '蛋糕系列'];
    poCol = 6;
  } else {
    return poSet;
  }

  for (const name of sheets) {
    const ws = raw.Sheets[name];
    if (!ws) continue;
    const data = XLSX_utils.sheet_to_json(ws, { header: 1 });
    const poIndex = currentSky ? data[0]?.findIndex(value => String(value ?? '').trim() === 'PO号') : poCol;
    if (poIndex == null || poIndex < 0) continue;
    for (let i = currentSky ? 1 : 2; i < data.length; i++) {
      const row = data[i];
      if (!row) continue;
      const v = row[poIndex];
      if (v) poSet.add(String(v).trim());
    }
  }

  return poSet;
}

/**
 * 提取排期里每个 PO+SKU 的字段当前值（用于改单 diff 比对）
 * 返回: { "POnumber|SKU": { dueDate, qty, unitPrice } }
 */
function buildExistingItemsMap(raw, type) {
  const XLSX_utils = require('xlsx').utils;
  const map = {};
  const sheets = type === 'tomy'
    ? [
      // 新格式 (KIK/RRM 总排期, 42 列): po=col6, part=col8, date=col13, qty=col10, price=col25
      // 0-indexed: 5, 7, 12, 9, 24
      { name: 'KIK总排期', cols: { po: 5, part: 7, date: 12, qty: 9, price: 24 } },
      { name: 'RRM总排期', cols: { po: 5, part: 7, date: 12, qty: 9, price: 24 } },
      // 旧格式 (单一总排期): po=col6, part=col8, date=col13, qty=col10, price=col23
      { name: '总排期', cols: { po: 5, part: 7, date: 12, qty: 9, price: 22 } },
    ]
    : [
      // 一二代排期 (54 列): po=col7, part=col8, date=col15, qty=col10, price=col40
      { name: '一二代排期', cols: { po: 6, part: 7, date: 14, qty: 9, price: 39 } },
      // 三代排期 (58 列, 2026-04-15 起): 与一二代结构一致
      { name: '三代排期', cols: { po: 6, part: 7, date: 14, qty: 9, price: 39 } },
      // 蛋糕系列 (58 列): 同一二代结构
      { name: '蛋糕系列', cols: { po: 6, part: 7, date: 14, qty: 9, price: 39 } },
    ];

  for (const { name, cols } of sheets) {
    const ws = raw.Sheets[name];
    if (!ws) continue;
    const data = XLSX_utils.sheet_to_json(ws, { header: 1 });
    for (let i = 2; i < data.length; i++) {
      const row = data[i];
      if (!row) continue;
      const po = String(row[cols.po] || '').trim();
      const part = String(row[cols.part] || '').trim();
      if (!po || !part) continue;
      const key = `${po}|${part}`;
      // 取第一条遇到的（同 PO+SKU 不应该有多条，若有则忽略后面）
      if (!map[key]) {
        map[key] = {
          dueDate: row[cols.date],
          qty: typeof row[cols.qty] === 'number' ? row[cols.qty] : null,
          unitPrice: typeof row[cols.price] === 'number' ? row[cols.price] : null,
        };
      }
    }
  }
  return map;
}

/**
 * 把日期值规范化成 'YYYY-MM-DD' 字符串
 * 处理三种来源：
 *   - JS Date 对象（exceljs 读出的）
 *   - Excel 序列号 number（xlsx 库读出的，如 46253）
 *   - 字符串 'YYYY-MM-DD' 或 ISO
 */
function normDate(d) {
  if (d == null || d === '') return '';
  if (typeof d === 'number') {
    // Excel 日期序列号（基准 1899-12-30 UTC）
    const date = new Date(Date.UTC(1899, 11, 30) + d * 86400000);
    return formatDateUTC(date);
  }
  if (d instanceof Date) {
    return formatDateUTC(d);
  }
  const s = String(d);
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  return s;
}

function formatDateUTC(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * 比较新 PO 数据 vs 排期已有数据，返回变更字段集合: 'date' | 'qty' | 'price'
 */
function detectChanges(existing, item, po) {
  const changes = new Set();
  if (!existing) return changes;

  const newDate = normDate(item.dueDate || po.shippingDate);
  const oldDate = normDate(existing.dueDate);
  if (newDate && oldDate && newDate !== oldDate) changes.add('date');

  if (existing.qty != null && Number(item.quantity) !== Number(existing.qty)) changes.add('qty');

  if (existing.unitPrice != null && Math.abs(Number(item.unitPrice) - Number(existing.unitPrice)) > 0.001) changes.add('price');

  return changes;
}

const FILL_NONE = { type: 'pattern', pattern: 'none' };

/**
 * 根据是否新单/转单方向/字段变更，给一行打不同颜色
 *
 * 规则:
 *   - 全新 PO+SKU                      → 整行黄
 *   - PDF 有 "from PO#XXX"（转入）     → 整行粉（本 PO 是接收方）
 *   - PDF 有 "to PO#XXX"（转出）       → 只数量格粉（本 PO 是被扣方）
 *   - 单纯改数量（无 divert）          → 只数量格黄
 *   - 单纯改货期 / 单价                → 只对应格子黄
 *   - 数据完全相同                     → 无颜色
 *
 * @param {object} sRow      exceljs Row
 * @param {boolean} isNew    排期里没有这个 PO+SKU
 * @param {object} item      PO 行项目（含 divertedFrom / divertedTo）
 * @param {Set<string>} changes 变更字段集合 ('date'/'qty'/'price')
 * @param {object} colMap    该 sheet 的列号映射（含 qty, custPODate, rrShipDate, unitPrice, amount, amountHKD 等）
 */
function applySmartRowColor(sRow, isNew, item, changes, colMap) {
  if (isNew) {
    sRow.eachCell(c => { c.fill = FILL_YELLOW; });
    return;
  }

  const isDivertedFrom = !!item.divertedFrom;  // 本 PO 接收转入 → 整行粉
  const isDivertedTo = !!item.divertedTo;      // 本 PO 转出去   → 只数量格粉

  if (isDivertedFrom) {
    sRow.eachCell(c => { c.fill = FILL_PINK; });
    return;
  }

  if (changes.size === 0 && !isDivertedTo) {
    sRow.eachCell(c => { c.fill = FILL_NONE; });
    return;
  }

  // 局部修改：整行清色，只标变更格子
  sRow.eachCell(c => { c.fill = FILL_NONE; });

  if (isDivertedTo && colMap.qty) {
    sRow.getCell(colMap.qty).fill = FILL_PINK;  // 被扣数量 → 数量格粉
  } else if (changes.has('qty') && colMap.qty) {
    sRow.getCell(colMap.qty).fill = FILL_YELLOW;  // 单纯改数量 → 黄
  }
  if (changes.has('date')) {
    if (colMap.custPODate) sRow.getCell(colMap.custPODate).fill = FILL_YELLOW;
    if (colMap.rrShipDate && colMap.rrShipDate !== colMap.custPODate) {
      sRow.getCell(colMap.rrShipDate).fill = FILL_YELLOW;
    }
  }
  if (changes.has('price')) {
    if (colMap.unitPrice) sRow.getCell(colMap.unitPrice).fill = FILL_YELLOW;
    if (colMap.amount) sRow.getCell(colMap.amount).fill = FILL_YELLOW;
    if (colMap.amountHKD) sRow.getCell(colMap.amountHKD).fill = FILL_YELLOW;
  }
}

// 检测文件类型
// ============================================================
function detectWorkbookType(raw) {
  const names = raw.SheetNames.map(n => n.toLowerCase());
  let type = 'unknown';
  if (names.some(n => n.includes('一二代') || n.includes('三代') || n === '四代排期')) type = 'skycastle';
  else if (names.some(n => n === '总排期' || n.includes('kik总排期') || n.includes('rrm总排期'))) type = 'tomy';
  else if (names.some(n => n.includes('cmw+ner+pkw接单') || n.includes('cmw+ner+pkw客排'))) type = 'jaz_plastic';
  else if (names.some(n => n === 'jwc接单' || n === 'jwc客排')) type = 'jaz_costume';
  return { type, sheets: raw.SheetNames };
}

async function detectType(excelPath) {
  return detectWorkbookType(require('xlsx').readFile(excelPath));
}

// ============================================================
// 主入口
// ============================================================
async function writeToExcel(excelPath, poResults, options = {}) {
  if (typeof excelPath !== 'string') throw new Error('excelPath must be string, got: ' + typeof excelPath);
  const { type } = await detectType(excelPath);
  const lookup = buildProductLookup(excelPath);

  const XLSX = require('xlsx');
  const raw = XLSX.readFile(excelPath);
  const wb = new ExcelJS.Workbook();

  // 从排期里提取已有PO号，区分新单/修改单
  const existingPOs = getExistingPOs(raw, type);
  // 标记每个PO结果是新单还是修改单
  for (const po of poResults) {
    if (existingPOs.has(po.poNumber)) {
      po.isRevised = true;  // 修改单
    }
  }

  if (type === 'skycastle') {
    const {normalizeServiceRows} = require('./parsers/sky-fees');
    poResults = poResults.map(normalizeServiceRows);
    if (raw.Sheets['四代排期']) require('./sky-current-layout').writeCurrentLayout(wb, raw, poResults, standardizePackaging);
    else pasteWriteSkyCastle(wb, raw, poResults, lookup);
    buildDivertSheet(wb, poResults);
    return { wb, type, orders: poResults };

  } else if (type === 'tomy') {
    pasteWriteTomy(wb, raw, poResults, lookup, options.factory);
    buildDivertSheet(wb, poResults);
    return { wb, type };

  } else if (type === 'jaz_plastic' || type === 'jaz_costume') {
    pasteWriteJaz(wb, raw, poResults, lookup, type);
    buildDivertSheet(wb, poResults);
    return { wb, type };

  } else {
    throw new Error('无法识别排期Excel类型');
  }
}

/**
 * Sky Castle 粘贴模式（2026-04 新格式）
 *
 * 总接单 (81 列):
 *   1:接单期 2:出货期 3:CUSTOMER PO 4:PO号 5:货号 6:数量 7:包装版 8:系列
 *   9-74: 产品列    78:单价USD 79:金额USD 80:金额HKD 81:系列
 *
 * 一二代排期 (54 列):
 *   ...10:数量 11:贴纸用量 12:总贴纸用量 13:外箱 14:总箱数 15:客PO期 16:RR回复出货期
 *   23:做货是否需要 25:客提供档案时间 30:做货版本 32:彩盒/CDU版本
 *   39:备注 40:单价USD 41:金额USD 42:金额HKD
 *
 * 三代排期 (56 列, 没有贴纸用量):
 *   ...10:数量 11:外箱 12:总箱数 13:客PO期 14:RR回复出货期
 *   21:做货是否需要 23:客提供档案时间 28:做货版本 30:彩盒/CDU版本
 *   37:备注 38:单价USD 39:金额USD 40:金额HKD
 *
 * 蛋糕系列 (58 列, 与一二代结构相同 + 中间多送货/欠数/贴纸/出单):
 *   跟一二代同样的列映射 + 尾部多字段
 */
const SCHED_COLS = {
  '一二代排期': {
    qty: 10,
    stickerQty: 11, totalStickers: 12, cartonPack: 13, totalCartons: 14,
    custPODate: 15, rrShipDate: 16,
    needLabel: 23, fileTime: 25, makeVersion: 30, boxVersion: 32,
    remark: 39, unitPrice: 40, amount: 41, amountHKD: 42,
    totalCols: 54,
  },
  '三代排期': {
    // 2026-04-15 起三代排期也加上贴纸用量/总贴纸用量两列，结构与一二代一致
    qty: 10,
    stickerQty: 11, totalStickers: 12, cartonPack: 13, totalCartons: 14,
    custPODate: 15, rrShipDate: 16,
    needLabel: 23, fileTime: 25, makeVersion: 30, boxVersion: 32,
    remark: 39, unitPrice: 40, amount: 41, amountHKD: 42,
    totalCols: 58,
  },
  '蛋糕系列': {
    qty: 10,
    stickerQty: 11, totalStickers: 12, cartonPack: 13, totalCartons: 14,
    custPODate: 15, rrShipDate: 16,
    needLabel: 23, fileTime: 25, makeVersion: 30, boxVersion: 32,
    remark: 39, unitPrice: 40, amount: 41, amountHKD: 42,
    totalCols: 58,
  },
};

function pasteWriteSkyCastle(wb, raw, poResults, lookup) {
  const XLSX_utils = require('xlsx').utils;

  // 读取产品列映射（新格式 col 9-74）
  const rawOrder = XLSX_utils.sheet_to_json(raw.Sheets['总接单'], { header: 1 });
  const pMap = {};
  const hRow = rawOrder[1] || [];
  for (let c = 8; c <= 73; c++) {
    // c 是 0-indexed 的数组下标，对应 Excel col c+1
    if (hRow[c]) String(hRow[c]).split('/').forEach(s => { pMap[s.trim()] = c + 1; });
  }

  // 排期里已有 PO+SKU 的字段值（用于 diff 比对）
  const existingItems = buildExistingItemsMap(raw, 'skycastle');

  // 总接单
  const wsOrder = wb.addWorksheet('总接单-粘贴用');
  if (rawOrder[0]) wsOrder.addRow(rawOrder[0]);
  if (rawOrder[1]) wsOrder.addRow(rawOrder[1]);
  wsOrder.getColumn(1).width = 16; // 接单期
  wsOrder.getColumn(2).width = 16; // 出货期
  wsOrder.getColumn(3).width = 18; // CUSTOMER PO
  wsOrder.getColumn(4).width = 16; // PO号
  wsOrder.getColumn(5).width = 14; // 货号
  wsOrder.getColumn(6).width = 10; // 数量
  wsOrder.getColumn(7).width = 16; // 包装版

  // 各排期 sheet
  const schedSheets = {};
  ['一二代排期', '三代排期', '蛋糕系列'].forEach(name => {
    if (!raw.Sheets[name]) return;
    const d = XLSX_utils.sheet_to_json(raw.Sheets[name], { header: 1 });
    const ws = wb.addWorksheet(name + '-粘贴用');
    if (d[0]) ws.addRow(d[0]);
    if (d[1]) ws.addRow(d[1]);
    [16,8,8,20,10,16,14,14,14,10,8,10,8,8,16,16].forEach((w, i) => { ws.getColumn(i+1).width = w; });
    schedSheets[name] = ws;
  });

  for (const po of poResults) {
    if (po.client !== 'Sky Castle' || po.error || !po.items) continue;
    for (const item of po.items) {
      const prodInfo = lookup[item.partNo] || {};
      // 系列优先用 名称 sheet 里的，没有则按 SKU 前缀推断
      const series = prodInfo['系列'] || inferSeries(item.partNo);

      // 标准化包装命名（按客户+系列映射到用户习惯的叫法）
      const pkgName = item.customerPackaging || standardizePackaging(po.packaging, po, series);

      // 总接单（新格式）
      const oRow = wsOrder.addRow([]);
      setCellRow(oRow, 1, po.creationDate);
      setCellRow(oRow, 2, item.dueDate || po.shippingDate);
      setCellRow(oRow, 3, po.customerPO || '');   // CUSTOMER PO
      setCellRow(oRow, 4, po.poNumber);
      setCellRow(oRow, 5, item.partNo);
      setCellRow(oRow, 6, item.quantity);
      if (item.customerPackaging) oRow.skyPackagingColumns = [7];
      setCellRow(oRow, 7, pkgName);                 // 包装版（标准化）
      setCellRow(oRow, 8, series);
      const pc = matchProdCol(pMap, item.partNo);
      if (pc >= 0) setCellRow(oRow, pc, item.quantity);
      setCellRow(oRow, 78, item.unitPrice);
      setCellRow(oRow, 79, item.amount);
      setCellRow(oRow, 80, Math.round(item.amount * HKD_RATE * 100) / 100);
      setCellRow(oRow, 81, 'SR');
      // 总接单也用同样的智能上色
      const orderKey = `${po.poNumber}|${item.partNo}`;
      const orderExisting = existingItems[orderKey];
      const orderChanges = detectChanges(orderExisting, item, po);
      const orderColMap = { qty: 6, custPODate: 2, rrShipDate: 2, unitPrice: 78, amount: 79, amountHKD: 80 };
      applySmartRowColor(oRow, !orderExisting, item, orderChanges, orderColMap);
      styleFullRow(oRow, 81);
      oRow.height = 27;

      // 排期 sheet
      const isCake = item.partNo.startsWith('JC');
      const is3gen = series === '三代' && !isCake;
      const schedName = isCake ? '蛋糕系列' : (is3gen ? '三代排期' : '一二代排期');
      const wsSched = schedSheets[schedName];
      if (!wsSched) continue;
      const cols = SCHED_COLS[schedName];

      const sRow = wsSched.addRow([]);
      // 前 10 列所有排期 sheet 都一样
      setCellRow(sRow, 1, po.creationDate);
      setCellRow(sRow, 2, '异常');
      setCellRow(sRow, 3, series);
      setCellRow(sRow, 4, extractClientName(po));
      setCellRow(sRow, 5, item.country);
      setCellRow(sRow, 6, po.customerPO || '');
      setCellRow(sRow, 7, po.poNumber);
      setCellRow(sRow, 8, item.partNo);
      setCellRow(sRow, 10, item.quantity);

      // 贴纸用量（仅 一二代 和 蛋糕系列 有）
      if (cols.stickerQty) {
        const stickerQty = prodInfo['贴纸用量'] || 0;
        if (stickerQty) {
          setCellRow(sRow, cols.stickerQty, stickerQty);
          setCellRow(sRow, cols.totalStickers, item.quantity * stickerQty);
        }
      }

      // 外箱/总箱数
      const cartonPack = prodInfo['装箱数'] || 0;
      if (cartonPack) {
        setCellRow(sRow, cols.cartonPack, cartonPack);
        setCellRow(sRow, cols.totalCartons, Math.ceil(item.quantity / cartonPack));
      }

      // 日期
      setCellRow(sRow, cols.custPODate, item.dueDate || po.shippingDate);
      setCellRow(sRow, cols.rrShipDate, item.dueDate || po.shippingDate);

      // 新单默认状态
      setCellRow(sRow, cols.fileTime, '欠');
      if (item.remark?.split('；').some(note => !/^Rework Cost\b/i.test(note))) {
        setCellRow(sRow, cols.needLabel, '需要(产品贴纸）');
      } else {
        setCellRow(sRow, cols.needLabel, '不需要');
      }
      // 备注列：组合贴纸 + 转单信息
      const skyRemark = [];
      if (item.remark) skyRemark.push(item.remark);
      if (item.divertedFrom) skyRemark.push(`${item.divertedFrom.qty}pcs 从 PO#${item.divertedFrom.sourcePO} 转入`);
      if (item.divertedTo) skyRemark.push(`${item.divertedTo.qty}pcs 转出至 PO#${item.divertedTo.targetPO}`);
      if (skyRemark.length) setCellRow(sRow, cols.remark, skyRemark.join('；'));

      // 做货版本 和 彩盒/CDU版本 用标准化后的包装名
      if (item.customerPackaging) sRow.skyPackagingColumns = [cols.makeVersion, cols.boxVersion];
      if (pkgName) {
        setCellRow(sRow, cols.makeVersion, pkgName);
        setCellRow(sRow, cols.boxVersion, pkgName);
      }

      // 金额
      setCellRow(sRow, cols.unitPrice, item.unitPrice);
      setCellRow(sRow, cols.amount, item.amount);
      setCellRow(sRow, cols.amountHKD, Math.round(item.amount * HKD_RATE * 100) / 100);

      // 智能上色：新单/转单方向/局部变更
      const key = `${po.poNumber}|${item.partNo}`;
      const existing = existingItems[key];
      const changes = detectChanges(existing, item, po);
      applySmartRowColor(sRow, !existing, item, changes, cols);
      styleFullRow(sRow, cols.totalCols);
      sRow.height = 27;
    }
  }
}

/**
 * TOMY 粘贴模式（2026-04 新格式）
 *
 * 总接单 (58 列):
 *   1:接单日期 2:国家 3:TOMY PO 4:CUSTOMER PO 5:货号 6:数量 7:PO走货期
 *   8-51: 产品列 (44 个)  55:单价USD 56:金额USD 57:金额HKD 58:车间
 *
 * 总排期 (分 KIK总排期 和 RRM总排期, 各 42 列):
 *   1:接单期 2:提交化学测试 3:国家 4:第三客户名称 5:客跟单
 *   6:TOMY PO 7:CUSTOMER PO 8:货号 9:产品名称 10:数量
 *   11:外箱 12:总箱数 13:PO走货期
 *   25:单价USD 26:金额USD 27:金额HKD 31:车间
 *
 * KIK/RRM 分配规则：根据 名称 sheet 里 货号 对应的 车间 列
 *   - "KIK"  → KIK总排期
 *   - "RRM"  → RRM总排期
 *   - 其他 (A/B/河源/空) → 默认 KIK
 */
function tomyRemarkColumn(sheet, newFormat) {
  const headers = sheet.getRow(1);
  const matches = [];
  headers.eachCell((cell, col) => {
    if (/^(备注|備註|remarks?)$/i.test(cell.text.trim())) matches.push(col);
  });
  const money = newFormat ? [25, 26, 27] : [23, 24, 25];
  if (matches.length !== 1 || money.includes(matches[0])) {
    throw new Error(sheet.name + ' 无法确认独立的备注列，请核对表头');
  }
  return matches[0];
}

function pasteWriteTomy(wb, raw, poResults, lookup, factory) {
  const XLSX_utils = require('xlsx').utils;
  const wsRaw = raw.Sheets['总接单'];
  const rawData = XLSX_utils.sheet_to_json(wsRaw, { header: 1 });
  const pMap = {};
  const headerRow = rawData[1] || [];
  // 新格式产品列：array idx 7-50 (col 8-51)
  for (let c = 7; c <= 50; c++) {
    if (headerRow[c]) String(headerRow[c]).split('/').forEach(s => { pMap[s.trim()] = c + 1; });
  }

  // 总接单
  const wsOrder = wb.addWorksheet('总接单-粘贴用');
  if (rawData[0]) wsOrder.addRow(rawData[0]);
  if (rawData[1]) wsOrder.addRow(rawData[1]);
  setTomyColumnWidths(wsOrder, '总接单');

  // 排期 sheet：优先使用新格式的 KIK总排期/RRM总排期，兼容旧格式的 总排期
  const schedSheets = {}; // 车间名 -> ws
  const schedNames = [];
  for (const name of ['KIK总排期', 'RRM总排期', '总排期']) {
    if (!raw.Sheets[name]) continue;
    const d = XLSX_utils.sheet_to_json(raw.Sheets[name], { header: 1 });
    const ws = wb.addWorksheet(name + '-粘贴用');
    if (d[0]) ws.addRow(d[0]);
    setTomyColumnWidths(ws, '总排期');
    schedSheets[name] = ws;
    schedNames.push(name);
  }
  const hasNewFormat = schedSheets['KIK总排期'] || schedSheets['RRM总排期'];
  const defaultSched = schedSheets['KIK总排期'] || schedSheets['总排期'] || null;

  // 排期里已有 PO+SKU 的字段值（用于 diff 比对）
  const existingItems = buildExistingItemsMap(raw, 'tomy');
  // TOMY 列号映射（用于 smart coloring）
  const tomyCols = hasNewFormat
    ? { qty: 10, custPODate: 13, rrShipDate: 13, unitPrice: 25, amount: 26, amountHKD: 27 }
    : { qty: 10, custPODate: 13, rrShipDate: 13, unitPrice: 23, amount: 24, amountHKD: 25 };

  for (const po of poResults) {
    if (po.client !== 'TOMY' || po.error || !po.items) continue;
    for (const item of po.items) {
      if (factory === '东莞' && item.factory === '印尼') continue;
      if (factory === '印尼' && item.factory !== '印尼') continue;
      const prodInfo = lookup[item.partNo] || {};
      const factoryName = (prodInfo['车间'] || '').toString().trim();

      // 总接单行（新格式 58 列）
      const oRow = wsOrder.addRow([]);
      setCellRow(oRow, 1, po.poDate);
      setCellRow(oRow, 2, item.country);
      setCellRow(oRow, 3, po.poNumber);
      setCellRow(oRow, 4, po.customerPO);
      setCellRow(oRow, 5, item.partNo);
      setCellRow(oRow, 6, item.quantity);
      setCellRow(oRow, 7, item.dueDate);
      const pc = matchProdCol(pMap, item.partNo);
      if (pc >= 0) setCellRow(oRow, pc, item.quantity);
      setCellRow(oRow, 55, item.unitPrice);
      setCellRow(oRow, 56, item.amount);
      setCellRow(oRow, 57, Math.round(item.amount * HKD_RATE * 100) / 100);
      setCellRow(oRow, 58, factoryName);
      // 总接单也用同样的智能上色
      const orderKey = `${po.poNumber}|${item.partNo}`;
      const orderExisting = existingItems[orderKey];
      const orderChanges = detectChanges(orderExisting, item, po);
      const orderColMap = { qty: 6, custPODate: 7, rrShipDate: 7, unitPrice: 55, amount: 56, amountHKD: 57 };
      applySmartRowColor(oRow, !orderExisting, item, orderChanges, orderColMap);
      styleFullRow(oRow, 58);
      oRow.height = 27;

      // 排期行 - 根据 车间 决定写 KIK 还是 RRM
      let wsSched;
      if (hasNewFormat) {
        if (factoryName === 'RRM') wsSched = schedSheets['RRM总排期'] || defaultSched;
        else wsSched = schedSheets['KIK总排期'] || defaultSched;
      } else {
        wsSched = defaultSched;
      }
      if (!wsSched) continue;

      const sRow = wsSched.addRow([]);
      setCellRow(sRow, 1, po.poDate);
      setCellRow(sRow, 3, item.country);
      setCellRow(sRow, 4, po.customerName || '');
      setCellRow(sRow, 5, po.handleBy || '');
      setCellRow(sRow, 6, po.poNumber);
      setCellRow(sRow, 7, po.customerPO);
      setCellRow(sRow, 8, item.partNo);
      setCellRow(sRow, 9, prodInfo['产品名称'] || '');
      setCellRow(sRow, 10, item.quantity);
      const cp = prodInfo['外箱'] || 0;
      if (cp) { setCellRow(sRow, 11, cp); setCellRow(sRow, 12, Math.ceil(item.quantity / cp)); }
      setCellRow(sRow, 13, item.dueDate);
      // 新格式金额列 25/26/27，旧格式是 23/24/25
      if (hasNewFormat) {
        setCellRow(sRow, 25, item.unitPrice);
        setCellRow(sRow, 26, item.amount);
        setCellRow(sRow, 27, Math.round(item.amount * HKD_RATE * 100) / 100);
        setCellRow(sRow, 31, factoryName);
      } else {
        setCellRow(sRow, 23, item.unitPrice);
        setCellRow(sRow, 24, item.amount);
        setCellRow(sRow, 25, Math.round(item.amount * HKD_RATE * 100) / 100);
        setCellRow(sRow, 29, factoryName);
      }
      // 备注列：组合 TBA 待定价 + 转单信息
      const remarkParts = [];
      if (item.priceTBA) remarkParts.push('待定价(TBA)');
      if (item.divertedFrom) remarkParts.push(`${item.divertedFrom.qty}pcs 从 PO#${item.divertedFrom.sourcePO} 转入`);
      if (item.divertedTo) remarkParts.push(`${item.divertedTo.qty}pcs 转出至 PO#${item.divertedTo.targetPO}`);
      if (remarkParts.length) {
        const remarkCol = tomyRemarkColumn(wsSched, hasNewFormat);
        setCellRow(sRow, remarkCol, remarkParts.join('；'));
      }
      // 智能上色：新单/转单方向/局部变更
      const key = `${po.poNumber}|${item.partNo}`;
      const existing = existingItems[key];
      const changes = detectChanges(existing, item, po);
      applySmartRowColor(sRow, !existing, item, changes, tomyCols);
      styleFullRow(sRow, hasNewFormat ? 42 : 29);
      sRow.height = 27;
    }
  }
}

// ============================================================
// JAZWARES 粘贴模式
// ============================================================
/**
 * JAZWARES 分 塑胶(CMW+NER+PKW) 和 戏服(JWC) 两套排期文件
 *
 * 规则:
 *   - 现PO 以 JAZ 开头 → 写入仓排
 *   - 现PO 非 JAZ 开头 → 写入客排
 *   - 戏服 COMP 开头货号 → 强制客排（半成品要送外厂）
 *   - COMP 特殊字段: 装箱数=48, 箱唛=空白周装箱, 外箱贴纸=无, 客贴纸=无, 包装版本=半成品无包装要求
 *   - 其他: 箱唛/外箱贴纸/客贴纸=欠, 包装版本按 PDF
 *
 * 列结构 (塑胶 客排/仓排 33列):
 *   1:接单期 2:第三客户名称 3:国家 4:客跟单 5:PO更改版本 6:原PO 7:现PO 8:货号 9:名称 10:数量
 *   11:装箱数 12:总箱数 13:客PO期 14:出货期 15:第三方验货期 16:验货/抽板地点 17:验货结果
 *   18:船期SO 19:箱唛资料 20:外箱贴纸 21:客贴纸 22:其它客供料 23:包装版本 24:日期码
 *   25:备注 26:单价USD 27:金额USD 28:金额HKD 29:发票号 30:是否入系统 31:系列 32:国家 33:-
 *
 * 列结构 (戏服 客排/仓排 34列):
 *   多了 6:生产车间，其余顺延 +1
 *   24:包装版本 25:是否带塑胶面具 27:备注 28:单价 29:金额USD 30:金额HKD 31:发票号 32:是否入系统 33:国家
 */
const JAZ_COLS = {
  plastic: {
    // 接单 sheet (44 列)
    order: {
      orderDate: 1, shipDate: 2, poVersion: 3, originalPO: 4, currentPO: 5, partNo: 6,
      quantity: 7, packaging: 8, series: 9,
      productStart: 10, productEnd: 39,
      unitPrice: 42, amountUSD: 43, amountHKD: 44, totalCols: 44,
    },
    // 客排/仓排 sheet (33 列)
    sched: {
      orderDate: 1, customer: 2, country: 3, handleBy: 4, poVersion: 5,
      originalPO: 6, currentPO: 7, partNo: 8, productName: 9, qty: 10,
      cartonPack: 11, totalCartons: 12, custPODate: 13, shipDate: 14,
      markInfo: 19, outerLabel: 20, custLabel: 21, packaging: 23,
      remark: 25, unitPrice: 26, amount: 27, amountHKD: 28,
      series: 31, country2: 32, totalCols: 33,
    },
  },
  costume: {
    order: {
      orderDate: 1, shipDate: 2, poVersion: 3, workshop: 4, originalPO: 5, currentPO: 6, partNo: 7,
      quantity: 8, packaging: 9,
      productStart: 10, productEnd: 205,
      unitPrice: 212, amountUSD: 213, amountHKD: 214, series: 215, totalCols: 215,
    },
    sched: {
      orderDate: 1, customer: 2, country: 3, handleBy: 4, poVersion: 5, workshop: 6,
      originalPO: 7, currentPO: 8, partNo: 9, productName: 10, qty: 11,
      cartonPack: 12, totalCartons: 13, custPODate: 14, shipDate: 15,
      markInfo: 20, outerLabel: 21, custLabel: 22, packaging: 24,
      remark: 27, unitPrice: 28, amount: 29, amountHKD: 30,
      country2: 33, totalCols: 34,
    },
  },
};

/**
 * 从 PO NOTES 文本里提取 COMP 半成品要送去的工厂信息
 * 形如 "货送XXX" / "送货到XXX" / "工厂地址：..."
 */
function extractMoldFactory(notes) {
  if (!notes) return '';
  const m = notes.match(/(?:货\s*送|送\s*货\s*到)\s*([A-Z\u4e00-\u9fff]+)/);
  if (m) return '货送' + m[1];
  return '';
}

function pasteWriteJaz(wb, raw, poResults, lookup, type) {
  const XLSX_utils = require('xlsx').utils;
  const isPlastic = type === 'jaz_plastic';
  const COLS = isPlastic ? JAZ_COLS.plastic : JAZ_COLS.costume;

  // sheet 名字
  const orderSheet = isPlastic ? 'CMW+NER+PKW接单' : 'JWC接单';
  const custSheet = isPlastic ? 'CMW+NER+PKW客排' : 'JWC客排';
  const warehouseSheet = isPlastic ? 'CMW+NER+PKW仓排' : 'JWC仓排';

  // 读产品列映射 (基于接单 sheet 的 row 2 header)
  const rawOrderJson = XLSX_utils.sheet_to_json(raw.Sheets[orderSheet], { header: 1 });
  const pMap = {};
  const hRow = rawOrderJson[1] || [];
  for (let c = COLS.order.productStart - 1; c <= Math.min(COLS.order.productEnd - 1, hRow.length - 1); c++) {
    if (hRow[c]) String(hRow[c]).split('/').forEach(s => { pMap[s.trim()] = c + 1; });
  }

  // 复制接单 sheet 头两行到粘贴用
  const wsOrder = wb.addWorksheet(orderSheet + '-粘贴用');
  if (rawOrderJson[0]) wsOrder.addRow(rawOrderJson[0]);
  if (rawOrderJson[1]) wsOrder.addRow(rawOrderJson[1]);

  // 复制 客排 和 仓排 头行
  const wsCust = wb.addWorksheet(custSheet + '-粘贴用');
  const wsWh = wb.addWorksheet(warehouseSheet + '-粘贴用');
  for (const [srcName, ws] of [[custSheet, wsCust], [warehouseSheet, wsWh]]) {
    if (!raw.Sheets[srcName]) continue;
    const d = XLSX_utils.sheet_to_json(raw.Sheets[srcName], { header: 1 });
    if (d[0]) ws.addRow(d[0]);
  }

  // 建已有数据索引用于 diff
  const existingItems = buildJazExistingItemsMap(raw, type);

  for (const po of poResults) {
    if (po.client !== 'JAZ' || po.error || !po.items) continue;
    for (const item of po.items) {
      const prodInfo = lookup[item.partNo] || {};
      const series = prodInfo['系列'] || '';
      const productName = prodInfo['名称'] || prodInfo['产品名称'] || item.description || '';

      // 路由到 客排 or 仓排
      const isJazPO = /^JAZ\d+/i.test(po.poNumber);
      const isComp = /^COMP/i.test(item.partNo);
      // 戏服 COMP 强制客排
      const toWarehouse = !isComp && isJazPO;
      const targetWs = toWarehouse ? wsWh : wsCust;

      // COMP 半成品特殊字段
      const cartonPack = isComp ? 48 : (item.cartonPack || prodInfo['装箱数'] || 0);
      const totalCartons = cartonPack ? Math.ceil(item.quantity / cartonPack) : 0;
      const markInfo = isComp ? '空白周装箱' : '欠';
      const outerLabel = isComp ? '无' : '欠';
      const custLabel = isComp ? '无' : '欠';
      const packaging = isComp ? '半成品无包装要求' : (po.packaging || '');
      const remark = isComp ? (extractMoldFactory(po.notes) || '送去外厂（请查看PO确认工厂）') : '';

      // -- 接单 sheet --
      const oRow = wsOrder.addRow([]);
      setCellRow(oRow, COLS.order.orderDate, po.poDate);
      setCellRow(oRow, COLS.order.shipDate, item.dueDate || po.shipDate);
      setCellRow(oRow, COLS.order.poVersion, po.poVersion);
      setCellRow(oRow, COLS.order.originalPO, item.divertedFrom ? item.divertedFrom.sourcePO : '');
      setCellRow(oRow, COLS.order.currentPO, po.poNumber);
      setCellRow(oRow, COLS.order.partNo, item.partNo);
      setCellRow(oRow, COLS.order.quantity, item.quantity);
      setCellRow(oRow, COLS.order.packaging, packaging);
      if (!isPlastic && COLS.order.workshop) {
        setCellRow(oRow, COLS.order.workshop, isComp ? '湖南' : '华登');
      }
      if (isPlastic && COLS.order.series) {
        setCellRow(oRow, COLS.order.series, series);
      }
      const pc = matchProdCol(pMap, item.partNo);
      if (pc >= 0) setCellRow(oRow, pc, item.quantity);
      setCellRow(oRow, COLS.order.unitPrice, item.unitPrice);
      setCellRow(oRow, COLS.order.amountUSD, item.amount);
      setCellRow(oRow, COLS.order.amountHKD, Math.round(item.amount * HKD_RATE * 100) / 100);
      if (!isPlastic && COLS.order.series) {
        setCellRow(oRow, COLS.order.series, series);
      }
      // 智能上色 (接单)
      const orderKey = `${po.poNumber}|${item.partNo}`;
      const orderExisting = existingItems[orderKey];
      const orderChanges = detectChanges(orderExisting, item, po);
      const orderColMap = {
        qty: COLS.order.quantity,
        custPODate: COLS.order.shipDate, rrShipDate: COLS.order.shipDate,
        unitPrice: COLS.order.unitPrice, amount: COLS.order.amountUSD, amountHKD: COLS.order.amountHKD,
      };
      applySmartRowColor(oRow, !orderExisting, item, orderChanges, orderColMap);
      styleFullRow(oRow, COLS.order.totalCols);
      oRow.height = 27;

      // -- 排期 sheet (客排/仓排) --
      const sRow = targetWs.addRow([]);
      setCellRow(sRow, COLS.sched.orderDate, po.poDate);
      setCellRow(sRow, COLS.sched.customer, po.customerName || '');
      setCellRow(sRow, COLS.sched.country, item.country || po.country);
      setCellRow(sRow, COLS.sched.handleBy, '');  // 客跟单 留空，用户填
      setCellRow(sRow, COLS.sched.poVersion, po.poVersion);
      if (!isPlastic && COLS.sched.workshop) {
        setCellRow(sRow, COLS.sched.workshop, isComp ? '湖南' : '华登');
      }
      setCellRow(sRow, COLS.sched.originalPO, item.divertedFrom ? item.divertedFrom.sourcePO : '');
      setCellRow(sRow, COLS.sched.currentPO, po.poNumber);
      setCellRow(sRow, COLS.sched.partNo, item.partNo);
      setCellRow(sRow, COLS.sched.productName, productName);
      setCellRow(sRow, COLS.sched.qty, item.quantity);
      if (cartonPack) setCellRow(sRow, COLS.sched.cartonPack, cartonPack);
      if (totalCartons) setCellRow(sRow, COLS.sched.totalCartons, totalCartons);
      setCellRow(sRow, COLS.sched.custPODate, item.dueDate || po.shipDate);
      setCellRow(sRow, COLS.sched.shipDate, item.dueDate || po.shipDate);
      setCellRow(sRow, COLS.sched.markInfo, markInfo);
      setCellRow(sRow, COLS.sched.outerLabel, outerLabel);
      setCellRow(sRow, COLS.sched.custLabel, custLabel);
      setCellRow(sRow, COLS.sched.packaging, packaging);
      if (remark) setCellRow(sRow, COLS.sched.remark, remark);
      setCellRow(sRow, COLS.sched.unitPrice, item.unitPrice);
      setCellRow(sRow, COLS.sched.amount, item.amount);
      setCellRow(sRow, COLS.sched.amountHKD, Math.round(item.amount * HKD_RATE * 100) / 100);
      if (isPlastic && COLS.sched.series) setCellRow(sRow, COLS.sched.series, series);
      if (COLS.sched.country2) setCellRow(sRow, COLS.sched.country2, item.country || po.country);

      // 智能上色 (排期)
      const schedKey = `${po.poNumber}|${item.partNo}`;
      const schedExisting = existingItems[schedKey];
      const schedChanges = detectChanges(schedExisting, item, po);
      const schedColMap = {
        qty: COLS.sched.qty,
        custPODate: COLS.sched.custPODate, rrShipDate: COLS.sched.shipDate,
        unitPrice: COLS.sched.unitPrice, amount: COLS.sched.amount, amountHKD: COLS.sched.amountHKD,
      };
      applySmartRowColor(sRow, !schedExisting, item, schedChanges, schedColMap);
      styleFullRow(sRow, COLS.sched.totalCols);
      sRow.height = 27;
    }
  }
}

/** JAZ 排期里取 PO+SKU 的当前值用于 diff */
function buildJazExistingItemsMap(raw, type) {
  const XLSX_utils = require('xlsx').utils;
  const map = {};
  const isPlastic = type === 'jaz_plastic';
  // 塑胶 客排/仓排: po=col7(idx6), part=col8(idx7), date=col13(idx12), qty=col10(idx9), price=col26(idx25)
  // 戏服 客排/仓排: po=col8(idx7), part=col9(idx8), date=col14(idx13), qty=col11(idx10), price=col28(idx27)
  const sheets = isPlastic
    ? [
      { name: 'CMW+NER+PKW客排', cols: { po: 6, part: 7, date: 12, qty: 9, price: 25 } },
      { name: 'CMW+NER+PKW仓排', cols: { po: 6, part: 7, date: 12, qty: 9, price: 25 } },
    ]
    : [
      { name: 'JWC客排', cols: { po: 7, part: 8, date: 13, qty: 10, price: 27 } },
      { name: 'JWC仓排', cols: { po: 7, part: 8, date: 13, qty: 10, price: 27 } },
    ];

  for (const { name, cols } of sheets) {
    const ws = raw.Sheets[name];
    if (!ws) continue;
    const data = XLSX_utils.sheet_to_json(ws, { header: 1 });
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!row) continue;
      const po = String(row[cols.po] || '').trim();
      const part = String(row[cols.part] || '').trim();
      if (!po || !part) continue;
      const key = `${po}|${part}`;
      if (!map[key]) {
        map[key] = {
          dueDate: row[cols.date],
          qty: typeof row[cols.qty] === 'number' ? row[cols.qty] : null,
          unitPrice: typeof row[cols.price] === 'number' ? row[cols.price] : null,
        };
      }
    }
  }
  return map;
}

/** 给整行所有列加边框、居中、字体（包括空格） */
function styleFullRow(row, colCount) {
  const border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
  const alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  const font = { name: '宋体', size: 9 };
  for (let c = 1; c <= colCount; c++) {
    const cell = row.getCell(c);
    cell.border = border;
    cell.alignment = alignment;
    if (!cell.font || !cell.font.name) cell.font = font;
  }
}

/** 粘贴模式用的setCellRow（宋体9号 + 日期格式） */
function setCellRow(row, col, value) {
  if (value == null || value === '') return;
  const cell = row.getCell(col);
  const isDateStr = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
  if (isDateStr) {
    const parts = value.split('-');
    const serial = Math.round((new Date(Date.UTC(parseInt(parts[0]), parseInt(parts[1])-1, parseInt(parts[2]))) - new Date(Date.UTC(1899, 11, 30))) / 86400000);
    cell.value = serial;
    cell.numFmt = DATE_FMT;
  } else {
    cell.value = value;
  }
  cell.font = { name: '宋体', size: 9 };
  cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  cell.border = {
    top: { style: 'thin' },
    bottom: { style: 'thin' },
    left: { style: 'thin' },
    right: { style: 'thin' },
  };
}

/** TOMY粘贴文件列宽设置 */
function setTomyColumnWidths(ws, sheetType) {
  if (sheetType === '总接单') {
    // A:接单日期 B:国家 C:TomyPO D:CustPO E:货号 F:数量 G:PO走货期 H+:产品列
    const widths = [16, 10, 12, 16, 12, 8, 16];
    widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    // 产品列和后面的列
    for (let c = 8; c <= 34; c++) ws.getColumn(c).width = 10;
  } else if (sheetType === '总排期') {
    // A:接单期 B:化学测试 C:国家 D:客名 E:客跟单 F:TomyPO G:CustPO H:货号 I:产品名称 J:数量 K:外箱 L:总箱数 M:走货期
    const widths = [16, 8, 10, 20, 8, 12, 16, 12, 14, 8, 6, 8, 16, 10, 10, 10, 10, 10, 10, 10, 10, 14, 10, 12, 12, 10, 10, 10, 8];
    widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  }
}

// ============================================================
// 直接写入模式（只填非公式列）
// ============================================================

function directWriteSkyCastle(wb, excelPath, poResults, lookup) {
  const productColMap = readProductColumnMap(excelPath, '总接单', 1, 8, 73);
  const wsOrder = wb.getWorksheet('总接单');
  let orderLastRow = findLastDataRow(wsOrder, 4);

  const schedSheets = {
    '一二代排期': wb.getWorksheet('一二代排期'),
    '三代排期': wb.getWorksheet('三代排期'),
    '蛋糕系列': wb.getWorksheet('蛋糕系列'),
  };
  const schedLastRows = {};
  for (const [name, ws] of Object.entries(schedSheets)) {
    schedLastRows[name] = ws ? findLastDataRow(ws, 7) : 0;
  }

  const orderStyleRow = orderLastRow;
  const schedStyleRows = { ...schedLastRows };

  for (const po of poResults) {
    if (po.client !== 'Sky Castle' || po.error || !po.items) continue;
    for (const item of po.items) {
      const prodInfo = lookup[item.partNo] || {};
      // 系列优先用 名称 sheet 里的，没有则按 SKU 前缀推断
      const series = prodInfo['系列'] || inferSeries(item.partNo);
      orderLastRow++;

      // 总接单：只填非公式列
      setCell(wsOrder, orderLastRow, 1, po.creationDate, FILL_YELLOW);
      setCell(wsOrder, orderLastRow, 2, item.dueDate || po.shippingDate, FILL_YELLOW);
      setCell(wsOrder, orderLastRow, 4, po.poNumber, FILL_YELLOW);
      setCell(wsOrder, orderLastRow, 5, item.partNo, FILL_YELLOW);
      setCell(wsOrder, orderLastRow, 6, item.quantity, FILL_YELLOW);
      setCell(wsOrder, orderLastRow, 8, series, FILL_YELLOW);
      const pc = matchProdCol(productColMap, item.partNo);
      if (pc >= 0) setCell(wsOrder, orderLastRow, pc, item.quantity);
      setCell(wsOrder, orderLastRow, 75, item.unitPrice, FILL_YELLOW);
      // 金额USD(76)、金额HKD(77) 如果有公式就留空让公式算，没公式就填
      setCell(wsOrder, orderLastRow, 76, item.amount, FILL_YELLOW);
      setCell(wsOrder, orderLastRow, 77, Math.round(item.amount * HKD_RATE * 100) / 100, FILL_YELLOW);
      setCell(wsOrder, orderLastRow, 78, 'SR', FILL_YELLOW);

      // 排期sheet
      const isCake = item.partNo.startsWith('JC');
      const is3gen = series === '三代' && !isCake;
      const schedName = isCake ? '蛋糕系列' : (is3gen ? '三代排期' : '一二代排期');
      const wsSched = schedSheets[schedName];
      if (!wsSched) continue;
      schedLastRows[schedName]++;
      const r = schedLastRows[schedName];

      setCell(wsSched, r, 1, po.creationDate, FILL_YELLOW);
      setCell(wsSched, r, 2, '异常', FILL_YELLOW);
      setCell(wsSched, r, 3, series, FILL_YELLOW);
      setCell(wsSched, r, 4, extractClientName(po), FILL_YELLOW);
      setCell(wsSched, r, 5, item.country, FILL_YELLOW);
      setCell(wsSched, r, 7, po.poNumber, FILL_YELLOW);
      setCell(wsSched, r, 8, item.partNo, FILL_YELLOW);
      setCell(wsSched, r, 10, item.quantity, FILL_YELLOW);
      const stickerQty = prodInfo['贴纸用量'] || 0;
      const cartonPack = prodInfo['装箱数'] || 0;
      if (stickerQty) {
        setCell(wsSched, r, 11, stickerQty, FILL_YELLOW);
        setCell(wsSched, r, 12, item.quantity * stickerQty, FILL_YELLOW);
      }
      if (cartonPack) {
        setCell(wsSched, r, 13, cartonPack, FILL_YELLOW);
        setCell(wsSched, r, 14, Math.ceil(item.quantity / cartonPack), FILL_YELLOW);
      }
      setCell(wsSched, r, 15, item.dueDate || po.shippingDate, FILL_YELLOW);
      setCell(wsSched, r, 16, item.dueDate || po.shippingDate, FILL_YELLOW);
      // 默认状态字段（新单待确认）
      setCell(wsSched, r, 23, '需要(产品贴纸）', FILL_YELLOW);
      setCell(wsSched, r, 25, '欠', FILL_YELLOW);
      setCell(wsSched, r, 39, item.remark || '贴纸$0.02一张', FILL_YELLOW);
      setCell(wsSched, r, 40, item.unitPrice, FILL_YELLOW);
      setCell(wsSched, r, 41, item.amount, FILL_YELLOW);
      setCell(wsSched, r, 42, Math.round(item.amount * HKD_RATE * 100) / 100, FILL_YELLOW);
    }
  }
}

function directWriteTomy(wb, excelPath, poResults, lookup, factory) {
  const productColMap = readProductColumnMap(excelPath, '总接单', 1, 7, 29);
  const wsOrder = wb.getWorksheet('总接单');
  const wsSched = wb.getWorksheet('总排期');
  let orderLastRow = findLastDataRow(wsOrder, 3);
  let schedLastRow = wsSched ? findLastDataRow(wsSched, 6) : 0;
  const orderStyleRow = orderLastRow;
  const schedStyleRow = schedLastRow;

  for (const po of poResults) {
    if (po.client !== 'TOMY' || po.error || !po.items) continue;
    for (const item of po.items) {
      if (factory === '东莞' && item.factory === '印尼') continue;
      if (factory === '印尼' && item.factory !== '印尼') continue;
      const prodInfo = lookup[item.partNo] || {};
      orderLastRow++;

      setCell(wsOrder, orderLastRow, 1, po.poDate, FILL_YELLOW);
      setCell(wsOrder, orderLastRow, 2, item.country, FILL_YELLOW);
      setCell(wsOrder, orderLastRow, 3, po.poNumber, FILL_YELLOW);
      setCell(wsOrder, orderLastRow, 4, po.customerPO, FILL_YELLOW);
      setCell(wsOrder, orderLastRow, 5, item.partNo, FILL_YELLOW);
      setCell(wsOrder, orderLastRow, 6, item.quantity, FILL_YELLOW);
      setCell(wsOrder, orderLastRow, 7, item.dueDate, FILL_YELLOW);
      const pc = matchProdCol(productColMap, item.partNo);
      if (pc >= 0) setCell(wsOrder, orderLastRow, pc, item.quantity);
      setCell(wsOrder, orderLastRow, 31, item.unitPrice, FILL_YELLOW);
      setCell(wsOrder, orderLastRow, 32, item.amount, FILL_YELLOW);
      setCell(wsOrder, orderLastRow, 33, Math.round(item.amount * HKD_RATE * 100, FILL_YELLOW) / 100);
      setCell(wsOrder, orderLastRow, 34, prodInfo['车间'] || '', FILL_YELLOW);

      if (!wsSched) continue;
      schedLastRow++;

      setCell(wsSched, schedLastRow, 1, po.poDate, FILL_YELLOW);
      setCell(wsSched, schedLastRow, 3, item.country, FILL_YELLOW);
      setCell(wsSched, schedLastRow, 4, po.customerName || '', FILL_YELLOW);
      setCell(wsSched, schedLastRow, 5, po.handleBy || '', FILL_YELLOW);
      setCell(wsSched, schedLastRow, 6, po.poNumber, FILL_YELLOW);
      setCell(wsSched, schedLastRow, 7, po.customerPO, FILL_YELLOW);
      setCell(wsSched, schedLastRow, 8, item.partNo, FILL_YELLOW);
      setCell(wsSched, schedLastRow, 9, prodInfo['产品名称'] || '', FILL_YELLOW);
      setCell(wsSched, schedLastRow, 10, item.quantity, FILL_YELLOW);
      const cp = prodInfo['外箱'] || 0;
      if (cp) {
        setCell(wsSched, schedLastRow, 11, cp, FILL_YELLOW);
        setCell(wsSched, schedLastRow, 12, Math.ceil(item.quantity / cp, FILL_YELLOW));
      }
      setCell(wsSched, schedLastRow, 13, item.dueDate, FILL_YELLOW);
      setCell(wsSched, schedLastRow, 23, item.unitPrice, FILL_YELLOW);
      setCell(wsSched, schedLastRow, 24, item.amount, FILL_YELLOW);
      setCell(wsSched, schedLastRow, 25, Math.round(item.amount * HKD_RATE * 100, FILL_YELLOW) / 100);
      setCell(wsSched, schedLastRow, 29, prodInfo['车间'] || '', FILL_YELLOW);
    }
  }
}


// ============================================================
// 扣数提示
// ============================================================
function buildDivertSheet(wb, poResults) {
  const diversions = [];
  for (const po of poResults) {
    if (!po.items) continue;
    for (const item of po.items) {
      if (item.divertedFrom) {
        diversions.push({
          newPO: po.poNumber, sourcePO: item.divertedFrom.sourcePO,
          partNo: item.partNo, qty: item.divertedFrom.qty,
        });
      }
    }
  }
  if (diversions.length === 0) return;

  const ws = wb.addWorksheet('扣数提示');
  ws.addRow(['源PO号', '货号', '扣减数量', '转入新PO', '操作说明']).eachCell(c => { c.font = { bold: true }; });
  diversions.forEach(d => {
    const row = ws.addRow([d.sourcePO, d.partNo, d.qty, d.newPO,
      `在排期中找到 ${d.sourcePO} 的 ${d.partNo}，数量减 ${d.qty}`]);
    row.eachCell(c => { c.fill = FILL_PINK; });
  });
  ws.columns = [{ width: 16 }, { width: 16 }, { width: 12 }, { width: 16 }, { width: 50 }];
}

module.exports = { writeToExcel, detectType, detectWorkbookType, getExistingPOs };
