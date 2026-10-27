/**
 * 源表解析器：把「国际表 / 美国表」里的发票 sheet 解析成统一结构。
 * 纯 ESM、无浏览器依赖，浏览器和 Node（回归测试）都能用。
 *
 * 统一结构 InvoiceData:
 * {
 *   srcSheetName: string      源表里的 sheet 名
 *   outSheetName: string      输出工作簿里的 sheet 名（去「折」、去空格）
 *   invNo: string|number      H10 发票号（国际表取 G1，美国表取 Inv No 单元格）
 *   invNoIsNumber: boolean
 *   date: Date|null           H15 开票日期
 *   po: string                A24 PO 号
 *   lines: Line[]             明细行（按源表行序）
 *   srcTotal: number|null     源表自身合计（用于验证）
 *   format: 'intl'|'us'
 * }
 * Line = { kind:'item'|'ma'|'fee'|'qty', code:string|number, qty:number, unit:number, desc:string|null }
 *      | { kind:'qty', qty:number }   // 每组商品后的纯数量行
 * （desc = 货品描述：国际表取 B 列文本，美国表取表头 'Description' 所在列；兴信 ZURU 新模板 C 列用它）
 */

import * as XLSX from 'xlsx';

/** 解析工作簿（ArrayBuffer）为 { sheetName: rows[][] }，只读前 90 行/26 列，够用且快 */
export function parseWorkbook(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, {
    type: 'array',
    cellDates: true,
    sheetRows: 90,
  });
  const result = {};
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    const rows = [];
    const ref = ws['!ref'];
    if (!ref) { result[name] = rows; continue; }
    const range = XLSX.utils.decode_range(ref);
    const maxR = Math.min(range.e.r, 89);
    const maxC = Math.min(range.e.c, 25);
    for (let r = 0; r <= maxR; r++) {
      const row = new Array(maxC + 1).fill(null);
      for (let c = 0; c <= maxC; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        if (!cell) continue;
        // 公式单元格优先取缓存值 v；没有缓存值时保留公式串（单价列要解析）
        if (cell.v !== undefined && cell.v !== null && cell.v !== '') {
          row[c] = cell.v;
        } else if (cell.f) {
          row[c] = { __formula: cell.f };
        }
      }
      rows.push(row);
    }
    result[name] = rows;
  }
  return result;
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v) => (typeof v === 'string' ? v : null);

/** 解析美国表单价单元格：缓存值优先，否则解析 '=3.2687*0.6' 这类公式 */
function unitFromCell(v) {
  const n = num(v);
  if (n !== null) return n;
  if (v && typeof v === 'object' && v.__formula) {
    const m = String(v.__formula).match(/^\s*=?(-?[\d.]+)\s*\*\s*0\.6\s*$/);
    if (m) return parseFloat(m[1]) * 0.6;
  }
  return null;
}

function qtyFromCell(v) {
  const n = num(v);
  if (n !== null) return n;
  // '=H23' 之类引用公式：缓存值已在 num(v) 里拿到；没有缓存就放弃
  return null;
}

/** 费用行说明文字：去掉“费/费用”后面的金额算式（如 费45*1、费RMB:100/7.08=14.12、费用：USD:158.97 → 费/费用） */
function feeText(s) {
  const m = s.match(/费/);
  if (!m) return s;
  const cut = s.slice(m.index).match(/^(费用?)[：:]?\s*(?=\d|RMB|USD|HKD)/i);
  return cut ? s.slice(0, m.index + cut[1].length) : s;
}

/** 判断并解析国际表版式；不合法返回 null */
export function parseIntlSheet(name, rows) {
  // 版式特征：前 9 行 A 列有买家抬头（ZURU INC / Rhodes Petcare / Rascals / 南京海蓓；
  // A2 被清空时看 A3 是否 ZURU 地址）；PO 行在 B4-B10 之间（'PO NO:xxx'，允许留空）；
  // 日期在 G/H 列前 9 行
  const BUYERS = ['ZURU INC', 'Rhodes Petcare Limited', 'Rascals International Ltd', '南京海蓓玩具有限公司'];
  const a2 = rows[1] && str(rows[1][0]);
  const a3 = rows[2] && str(rows[2][0]);
  let buyerOk = !(a2 || '').trim() && a3 && /Flat\/Rm|Energy Plaza/i.test(a3);
  for (let r = 0; r < Math.min(rows.length, 9) && !buyerOk; r++) {
    const a = rows[r] && str(rows[r][0]);
    if (a && BUYERS.includes(a.trim())) buyerOk = true;
  }
  if (!buyerOk) return null;
  let po = '', poRow = -1, date = null;
  for (let r = 3; r < Math.min(rows.length, 12); r++) {
    const b = rows[r] && str(rows[r][1]);
    if (b && /^PO NO[:：]/i.test(b.trim())) { po = b.replace(/^PO NO[:：]\s*/i, '').trim(); poRow = r; break; }
  }
  for (let r = 0; r < Math.min(rows.length, 9) && !date; r++) {
    for (const c of [6, 7]) {
      const g = rows[r] && rows[r][c];
      if (g instanceof Date) { date = g; break; }
    }
  }
  if (!date) return null;

  const g1 = rows[0] && str(rows[0][6]);
  const invNoRaw = g1 ? g1.trim() : name.trim();

  const lines = [];
  let srcTotal = null;
  let lastLineRow = poRow;   // 最后一条明细所在行（页脚合计从它之后找）
  for (let r = poRow + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const a = row[0], b = str(row[1]), d = qtyFromCell(row[3]);
    if (b && /^(Shipment|Customer Name|BANK NAME)/i.test(b.trim())) break;  // 页脚开始
    if (typeof a === 'string' && /total/i.test(a)) break;                     // 合计行
    const code = a !== null && a !== undefined && a !== '' ? a : null;
    const hasDesc = b && b.trim().length > 0;
    if (d !== null && (code !== null || hasDesc)) {
      // 明细行：A 有货号/MA#，或 A 空但 B 有描述（无码扣款行）
      const unit = num(row[6]);
      if (unit === null) continue;
      lines.push({
        kind: code !== null && String(code).startsWith('MA#') ? 'ma' : 'item',
        code, qty: d, unit,
        desc: hasDesc ? b.trim() : null,
      });
      lastLineRow = r;
    } else if (d !== null && code === null && !hasDesc) {
      // 纯数量行：A、B 都空，只有数量（G 列为单价小计）
      lines.push({ kind: 'qty', qty: d });
      const i = num(row[8]);
      if (i !== null) srcTotal = i;   // 同行 I 为该块/整单合计，最后一个作验证参考
      lastLineRow = r;
    } else if (d === null && code === null && hasDesc) {
      // 无量费用行（收取此单…费 / Price premium…，金额在 I~K 列）：说明文字入 code（去掉金额算式尾巴），金额入 unit
      let amt = null;
      for (let c = 8; c <= 10; c++) { const v = num(row[c]); if (v !== null) { amt = v; break; } }
      if (amt !== null) { lines.push({ kind: 'fee', code: feeText(b.trim()), qty: 1, unit: amt, desc: b.trim() }); lastLineRow = r; }
    }
  }
  if (!lines.length) return null;
  // 页脚整单合计：最后一条明细行之后、'BANK NAME' 之前，G-L 列里那个数值单元格（多段发票此值为各段累计）
  let footerTotal = null;
  const bankIdx = rows.findIndex((row) => {
    const b = row && str(row[1]);
    return b && /^BANK NAME/i.test(b.trim());
  });
  const scanEnd = bankIdx > 0 ? bankIdx : rows.length;
  for (let r = lastLineRow + 1; r < scanEnd; r++) {
    const row = rows[r] || [];
    for (let c = 6; c <= 11; c++) {
      const v = num(row[c]);
      if (v !== null && v !== 0) footerTotal = v;
    }
  }
  return { srcSheetName: name, format: 'intl', invNoRaw, po, date, lines, srcTotal: footerTotal ?? srcTotal };
}

/** 判断并解析美国表版式；不合法返回 null */
export function parseUsSheet(name, rows) {
  // 找表头标签：H 列 'Inv No：' / 'Date:' / 'ZURU PO#:'，取同行 J 列
  let invNo = null, date = null, po = null, headerRow = -1;
  let colCode = 2, colQty = 7, colUnit = 8, colDesc = -1;   // 标准版式：C=货号 H=数量 I=单价
  for (let r = 0; r < Math.min(rows.length, 20); r++) {
    const row = rows[r] || [];
    for (let c = 0; c <= 9; c++) {
      const v = str(row[c]);
      if (!v) continue;
      const t = v.trim();
      const j = row[c + 1];   // 标签右边一格（H→I 或 H→J 视合并而定）
      const j2 = row[c + 2];
      const val = (x) => (x !== null && x !== undefined && x !== '' ? x : null);
      if (/^Inv No/i.test(t)) invNo = val(j) ?? val(j2);
      if (/^Date/i.test(t) && (val(j) instanceof Date || val(j2) instanceof Date)) date = val(j) instanceof Date ? val(j) : val(j2);
      if (/^ZURU PO/i.test(t)) po = val(j) ?? val(j2);
    }
    const a = str(row[0]);
    if (a && a.trim() === 'No.') {
      // 'Description' 文本所在列即货品名称列（标准版式在 E，T 版式在 D，以表头定位为准）
      const di = row.findIndex((x) => typeof x === 'string' && /description/i.test(x));
      if (di > 0) colDesc = di;
      if (str(row[2]) && /SKU/i.test(str(row[2]))) { headerRow = r; colCode = 2; colQty = 7; colUnit = 8; }
      // T 后缀（TARGET）版式：B='SKU No.'，B=货号 G=数量 H=单价
      else if (str(row[1]) && /SKU/i.test(str(row[1]))) { headerRow = r; colCode = 1; colQty = 6; colUnit = 7; }
    }
  }
  if (invNo === null || !date || headerRow < 0) return null;

  const lines = [];
  let srcTotal = null;
  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const a = row[0];
    if (typeof a === 'string' && /Total (Net )?Amount/i.test(a)) {
      // 源表总额（K 或 J 列；T 版式在 I 列）
      for (let c = 2; c <= 11; c++) {
        const v = num(row[c]);
        if (v !== null) { srcTotal = v; break; }
      }
      break;
    }
    const c = row[colCode];
    const h = qtyFromCell(row[colQty]);
    const code = c !== null && c !== undefined && c !== '' ? c : null;
    const desc = colDesc > 0 ? str(row[colDesc]) : null;
    if (code !== null && h !== null) {
      const unit = unitFromCell(row[colUnit]);
      if (unit === null) continue;
      lines.push({ kind: String(code).startsWith('MA#') ? 'ma' : 'item', code, qty: h, unit, desc });
    } else if (code === null && h !== null) {
      // Final Price 是汇总行不是扣款行，维持纯数量行（生成空行占位）
      const isFinalPrice = row.some((cell) => typeof cell === 'string' && /final\s*price/i.test(cell));
      const unit = unitFromCell(row[colUnit]);
      // 无编号扣款行（如 Colored paper / Sticker MOQ）：单价列有值，要保留；空才是纯数量行
      if (!isFinalPrice && unit !== null) lines.push({ kind: 'ma', code: null, qty: h, unit, desc });
      else lines.push({ kind: 'qty', qty: h });
    }
  }
  if (!lines.length) return null;
  return { srcSheetName: name, format: 'us', invNoRaw: String(invNo), po: po == null ? '' : String(po), date, lines, srcTotal };
}

/** 输出 sheet 名：去「折」、去所有空格；JAZ/Sky Castle 的「X (2)」分段票规范为「X-2」 */
export function normalizeOutName(srcName) {
  return srcName.replace(/\s*\((\d+)\)\s*$/, '-$1').replace(/折/g, '').replace(/\s+/g, '');
}

/** H10 发票号 = 输出 sheet 名；源里带 REV 标记而名字没有时补上（如 ZB05568(REV1)→ZB05568REV1） */
export function normalizeInvNo(inv) {
  let s = inv.outSheetName;
  const m = String(inv.invNoRaw).match(/REV\s*\d+/i);
  if (m && !new RegExp(m[0], 'i').test(s)) s += m[0].toUpperCase().replace(/\s+/g, '');
  return s;
}

/* ---------------- 香港票（JAZ / Sky Castle / Toy Monster） ----------------
 * 与 ZURU(国际) 同型：A1 抬头识客、r3 附近日期、PO 行、货物行 数量/单价/USD$、SUM 合计。
 * 列布局：JAZ/Toy Monster 数量F 单价I 金额K；Sky Castle 数量E 单价H 金额J。
 * Toy Monster 有 Deposit 50% / Amount Paid 付款行：底线合计≠明细和时，
 * 差额作为一条 ma 调整行（负金额）进票，保证 Σ明细==底线合计。
 */
const HK_LAYOUTS = [
  { format: 'jaz', customer: 'JAZ', matchA1: (a) => /jazwares|jazplus|jaz toys uk|wicked cool/i.test(a), qty: 6, unit: 9, amt: 11 },
  { format: 'skycastle', customer: 'Sky Castle', matchA1: (a) => /sky castle/i.test(a), qty: 5, unit: 8, amt: 10 },
  { format: 'toymonster', customer: 'Toy Monster', matchA1: (a) => /toy monster/i.test(a), qty: 6, unit: 9, amt: 11 },
];

const hkLabel = (s) => String(s).trim().replace(/[：:]\s*$/, '').slice(0, 60);

/** 判断并解析香港票版式（按 A1 抬头识客）；不合法返回 null */
export function parseHkSheet(name, rows) {
  const a1 = rows[0] && str(rows[0][0]);
  if (!a1) return null;
  const lay = HK_LAYOUTS.find((l) => l.matchA1(a1.trim()));
  if (!lay) return null;

  // 日期：前 6 行任意列的日期单元格
  let date = null;
  for (let r = 0; r < Math.min(rows.length, 6) && !date; r++)
    for (const v of rows[r] || []) if (v instanceof Date) { date = v; break; }
  if (!date) return null;

  // 发票号：J1 有值取之（含 REV 形态，如 60365REV1），否则用 sheet 名
  const j1 = rows[0][9];
  const invNoRaw = j1 !== null && j1 !== undefined && String(j1).trim() !== '' ? String(j1).trim() : name.trim();

  // PO：CUSTOMER PO NO.:/PO NO: 优先，CONTRACT NO.: 兜底（Toy Monster 订金票无 PO，留空）
  let po = '';
  const poRes = [/CUSTOMER\s+PO\s+NO\.?\s*[:：]\s*(.+)$/i, /^PO\s+NO\.?\s*[:：]\s*(.+)$/i, /CONTRACT\s+NO\.?\s*[:：]\s*(.+)$/i];
  for (const re of poRes) {
    for (let r = 0; r < Math.min(rows.length, 14); r++) {
      const b = rows[r] && str(rows[r][1]);
      const m = b && b.match(re);
      if (m) { po = m[1].trim(); break; }
    }
    if (po) break;
  }

  const q = lay.qty - 1, u = lay.unit - 1, k = lay.amt - 1;
  const lines = [];
  let sumTotal = null, bottomTotal = null, payLabel = null, sumRow = -1;
  for (let r = 5; r < rows.length; r++) {
    const row = rows[r] || [];
    const b = str(row[1]);
    if (b && /^(BANK NAME|Beneficiary)/i.test(b.trim())) break;
    if (sumRow < 0) {
      const qty = num(row[q]), unit = num(row[u]);
      const hasA = row[0] !== null && row[0] !== undefined && String(row[0]).trim() !== '';
      const hasB = b !== null && b.trim() !== '';
      const code = hasA ? row[0] : (hasB ? hkLabel(b) : null);
      if (qty !== null) {
        if (unit !== null) {
          // 金额列交叉核对：源票金额公式可能带额外系数（如 =E9*H9*0.86），不符时按金额/数量取有效单价
          const amt = num(row[k]);
          const unitEff = amt !== null && Math.abs(amt - qty * unit) > Math.max(0.005, Math.abs(qty * unit) * 1e-6)
            ? amt / qty : unit;
          lines.push({ kind: code !== null && String(code).startsWith('MA#') ? 'ma' : 'item', code, qty, unit: unitEff });
          continue;
        }
        const amt = num(row[k]);
        if (amt !== null) {
          // Toy Monster 费用票：只有数量+金额，单价=金额/数量
          lines.push({ kind: 'item', code, qty, unit: amt / qty });
        }
        continue;
      }
      // 合计行探测：金额列附近（JAZ 合计有 K27/L27 两种位置）有数值；
      // 「Amount Payable」标签行也是合计行，其余带描述的金额行是费用/扣款行
      const amtNear = [num(row[k - 1]), num(row[k]), num(row[k + 1])].find((v) => v !== null);
      if (amtNear === undefined) continue;
      const isTotalLabel = hasB && /^Amount Payable/i.test(b.trim());
      if (code !== null && !isTotalLabel) {
        // 费用/扣款行：无数量有金额（Rework Charge、Extra Costs、负数扣减）
        if (num(row[k]) !== null) lines.push({ kind: 'ma', code, qty: 1, unit: num(row[k]) });
        continue;
      }
      if (lines.length) { sumTotal = amtNear; sumRow = r; }
      continue;
    }
    // 付款扫描段（合计行之下）：找 Deposit/Balance/Amount Paid 标签与底线数值
    for (const v of row) {
      const s = str(v);
      if (s && !payLabel && /Deposit|Balance|Amount Paid/i.test(s)) payLabel = hkLabel(s);
    }
    for (let c = k - 1; c <= k + 1; c++) {
      const v = num(row[c]);
      if (v !== null) bottomTotal = v;
    }
    if (r > sumRow + 12) break;
  }
  if (!lines.length) return null;

  // 付款调整：底线合计≠明细和（订金 50%/已付 30%）→ 差额作为一条负额调整行
  if (payLabel && sumTotal !== null && bottomTotal !== null && Math.abs(bottomTotal - sumTotal) > 0.005) {
    lines.push({ kind: 'ma', code: payLabel, qty: 1, unit: bottomTotal - sumTotal });
  }
  const srcTotal = payLabel && bottomTotal !== null ? bottomTotal : sumTotal;
  return { srcSheetName: name, format: lay.format, customer: lay.customer, invNoRaw, po, date, lines, srcTotal };
}

/** 解析整个源工作簿，返回发票数组（自动识别两种版式，跳过非发票 sheet） */
export function extractInvoices(sheetRowsMap) {
  const out = [];
  const unrecognized = [];
  for (const [name, rows] of Object.entries(sheetRowsMap)) {
    let inv = parseIntlSheet(name, rows);
    if (!inv) inv = parseUsSheet(name, rows);
    if (inv) inv.customer = 'ZURU';
    if (!inv) inv = parseHkSheet(name, rows);
    if (!inv) {
      // 名字像发票（含 ZB/折/INV/4 位以上数字）但版式不认识的，报出来别静默丢
      if (/ZB|折|INV|\d{4,}/i.test(name)) { unrecognized.push(name); continue; }
      // 名字不像但有发票表头（A 列 'No.' + SKU）：多半是缺发票号/日期的草稿，也要报出来
      const hasHeader = rows.slice(0, 25).some((r) => r && String((r || [])[0] || '').trim() === 'No.');
      if (hasHeader) unrecognized.push(`${name}（有发票表头但缺发票号或日期）`);
      continue;
    }
    inv.outSheetName = normalizeOutName(name);
    inv.invNo = normalizeInvNo(inv);
    inv.invNoIsNumber = /^\d+(\.\d+)?$/.test(String(inv.invNo));
    out.push(inv);
  }
  out.unrecognized = unrecognized;
  return out;
}

/** 按发票号主干分组（X, X-2, X-3 …），用于多段发票的累计合计 */
export function groupParts(invoices) {
  const groups = new Map();
  for (const inv of invoices) {
    const base = inv.outSheetName.replace(/-\d+$/, '');
    if (!groups.has(base)) groups.set(base, []);
    groups.get(base).push(inv);
  }
  return groups;
}

/** 单个发票的合计（精确：Σ 单价×0.967×数量） */
export function invoiceTotal(inv) {
  let t = 0;
  for (const ln of inv.lines) {
    if (ln.kind === 'qty') continue;
    t += ln.unit * 0.967 * ln.qty;
  }
  return t;
}

/**
 * 生成任务列表：多段发票（X, X-2, X-3…）只有最后一段填 I48。
 * 合计以源票最后一段的标注合计×0.967 为准（可能含明细行之外的其他费用）；
 * 源票没标注合计时才退回各段明细行之和。
 * 返回 [{ inv, totalValue|null, linesTotal|null, totalFromSrc, partCount, partIndex }]
 */
export function buildJobs(invoices) {
  const groups = groupParts(invoices);
  return invoices.map((inv) => {
    const parts = groups.get(inv.outSheetName.replace(/-\d+$/, ''));
    const partIndex = parts.indexOf(inv);
    const isLast = partIndex === parts.length - 1;
    const linesTotal = isLast ? parts.reduce((s, p) => s + invoiceTotal(p), 0) : null;
    const fromSrc = isLast && inv.srcTotal !== null && inv.srcTotal !== undefined;
    return {
      inv,
      totalValue: isLast ? (fromSrc ? inv.srcTotal * 0.967 : linesTotal) : null,
      linesTotal,
      totalFromSrc: fromSrc,
      partCount: parts.length,
      partIndex,
    };
  });
}

/** 日期显示（序列号往返一次，规避 SheetJS 日期对象的时区偏移） */
export function fmtDate(d) {
  if (!d) return '';
  const serial = Math.round(d.getTime() / 86400000 + 25569);
  const utc = new Date((serial - 25569) * 86400000);
  return `${utc.getUTCFullYear()}-${String(utc.getUTCMonth() + 1).padStart(2, '0')}-${String(utc.getUTCDate()).padStart(2, '0')}`;
}
