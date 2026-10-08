// 客户排期 Excel 导入解析:各客户排期表(ZURU/TOMY/MOOSE 等格式不一) -> 统一排期行(纯函数,可单测)
// 与后端约定:前端按表头别名映射列、按工作表名推定状态(在排/已走货/已取消)、日期格式化为 yyyy-MM-dd;
// 未映射列打包进备注;后端只做兜底校验。
// 逐行照抄老系统 web/src/utils/schedulingImport.ts;decodeCsvBuffer/splitDelimited 照抄 web/src/utils/bomImport.ts。

export type ScheduleStatus = "在排" | "已走货" | "已取消";

export interface ScheduleImportRowData {
  行号: number; // 与 Excel 行号一致
  状态: ScheduleStatus;
  来源工作表: string;
  接单日期?: string;
  客户名称?: string;
  国家?: string;
  PO号?: string;
  客PO?: string;
  SKU?: string;
  货号?: string;
  品名?: string;
  数量?: number;
  内箱?: number;
  外箱?: number;
  总箱数?: number;
  走货期?: string;
  验货期?: string;
  第三方验货?: string;
  车间?: string;
  备注?: string;
  原始数据?: Record<string, string>; // 整行原始数据(原表头->原值),万全兜底
  错误?: string;
}

export interface ScheduleSheetParseResult {
  工作表: string;
  状态: ScheduleStatus;
  hasHeader: boolean; // 是否找到排期表头(找不到的工作表不参与导入,如"名称""配比图")
  跳过?: boolean; // 临时/筛选副本工作表(Sheet1、导出筛选结果…)
  rows: ScheduleImportRowData[];
}

// ---------- CSV/TSV 文本解码与切分(照抄 bomImport.ts) ----------

// 文件解码:优先 UTF-8(含 BOM),失败按 GBK 解码
export function decodeCsvBuffer(buf: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf).replace(/^\uFEFF/, "");
  } catch {
    return new TextDecoder("gbk").decode(buf).replace(/^\uFEFF/, "");
  }
}

// 分隔文本解析:首行含 Tab 按 TSV,否则按 CSV(支持引号包裹/转义/字段内换行)
export function splitDelimited(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const delim = firstLine.includes("\t") ? "\t" : ",";
  const rows: string[][] = [];
  let cells: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; }
        else inQuotes = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell === "") inQuotes = true;
    else if (ch === delim) { cells.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      cells.push(cell); cell = "";
      rows.push(cells); cells = [];
    } else cell += ch;
  }
  if (cell !== "" || cells.length) { cells.push(cell); rows.push(cells); }
  return rows;
}

// ---------- 排期表解析(照抄 schedulingImport.ts) ----------

// 表头归一化:去空白(含换行)/全角括号转半角/去 # 和 .(兼容 "货号#" "Cust. PO NO.")/转小写
export const normScheduleHeader = (s: string): string =>
  s.replace(/[\s\u3000]/g, "").replace(/（/g, "(").replace(/）/g, ")")
    .replace(/[#.]/g, "").toLowerCase();

// 字段 <- 表头别名(归一化后精确匹配,或以"别名("开头兼容 "客户名称(第三方客户)" 类带括号注释的表头)
const FIELD_ALIASES: Record<string, string[]> = {
  接单日期: ["接单期", "接单日期", "香港接单日期", "来单日期"],
  客户名称: ["第三方客户名称", "客名", "国家/客名", "客户名称", "po客人", "描述"],
  国家: ["走货国家", "国家"],
  PO号: ["po号", "tomypo", "zurupono", "订单pono", "订单po", "pono", "mo订单号码", "ma订单号码"],
  客PO: ["客po", "custpono", "custpon", "customer", "第三方客户pono", "客下正式订单po"],
  SKU: ["sku", "itemcode"],
  货号: ["系统货号", "货号", "itemno", "item"],
  品名: ["中文名", "名称", "产品名称", "品名", "货名"],
  数量: ["po数量(pcs)", "po数量", "数量"],
  内箱: ["内箱装箱数量(pcs)", "内箱", "内箱数量"],
  外箱: ["外箱装箱数量(pcs)", "外箱", "装箱数", "总装箱数"],
  总箱数: ["总箱数"],
  走货期: ["zuru订单走货日期", "订单走货日期", "po走货期", "客po期", "确认走货期", "计划po出货期", "预计客po期", "计划走货期", "走货期", "走货日期"],
  验货期: ["zuru验货日期", "验货日期", "计划验货期", "确定验货期", "第三方验货期", "验货时间", "验货期"],
  第三方验货: ["第三方验货", "第三方客户公证行验货"],
  车间: ["车间"],
  备注: ["备注"],
};

const NUMERIC_FIELDS = new Set(["数量", "内箱", "外箱", "总箱数"]);
const DATE_FIELDS = new Set(["接单日期", "走货期", "验货期"]);
// 不参与"未映射列打包备注"的系统列
const SKIP_PACK_HEADERS = new Set(["", "序号"]);

const ALL_HEADERS = new Map<string, string>(); // 归一化表头 -> 字段名
for (const [field, aliases] of Object.entries(FIELD_ALIASES))
  for (const a of aliases) ALL_HEADERS.set(normScheduleHeader(a), field);

// 表头 -> 字段:先精确匹配;否则取"以别名开头"的最长别名(兼容 "客户名称(第三方客户)"/"客户名称 Cus"/
// "计划验货期Planned" 这类带括号注释或中英双写的表头;精确匹配优先保证 "客PO期" 不会误判为 "客PO")
function matchField(norm: string): string | undefined {
  const exact = ALL_HEADERS.get(norm);
  if (exact) return exact;
  let best: string | undefined, bestLen = 0;
  for (const [alias, field] of ALL_HEADERS)
    if (alias.length >= 2 && norm.startsWith(alias) && alias.length > bestLen) { best = field; bestLen = alias.length; }
  return best;
}

// 工作表名 -> 状态:含"取消"->已取消;含"走货/出货"->已走货;其余(排期/总接单/总排期…)->在排
export function statusFromSheetName(name: string): ScheduleStatus {
  if (name.includes("取消")) return "已取消";
  if (name.includes("走货") || name.includes("出货")) return "已走货";
  return "在排";
}

// 临时工作表(Sheet1/导出筛选结果…)多是主表的筛选副本,导入会与主表重复 -> 直接跳过
export function shouldSkipSheet(name: string): boolean {
  const n = name.trim();
  return /^sheet\d*$/i.test(n) || n.includes("筛选");
}

// 单元格 -> 文本:数字原样转串,字符串压缩换行/连续空白后 Trim
const cellText = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return isNaN(v.getTime()) ? "" : cellToDate(v) ?? "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  return String(v).replace(/\s+/g, " ").trim();
};

const pad2 = (n: number) => String(n).padStart(2, "0");
export const formatDate = (d: Date): string =>
  `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};
const validYmd = (y: number, m: number, d: number) =>
  y >= 1990 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31;

// 单元格 -> yyyy-MM-dd:
//  - Date(xlsx cellDates)/序列号:先 +12h 再取 UTC 日期的"正午修正":xlsx 把序列号按 UTC 解释,
//    浏览器时区(UTC±12 内)与序列号浮点误差都不会越过日界;
//  - 字符串:宽松解析(2025-01-06 / 2025/1/6 / "Wed Apr 01 2026" / "Tue Jul 07" 无年份时用 默认年份)。
export function cellToDate(v: unknown, 默认年份?: number): string | undefined {
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return undefined;
    return formatDate(new Date(v.getTime() + 12 * 3600 * 1000));
  }
  if (typeof v === "number" && Number.isFinite(v) && v > 20000 && v < 80000) {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000) + 12 * 3600 * 1000);
    return isNaN(d.getTime()) ? undefined : formatDate(d);
  }
  const t = typeof v === "string" ? v.trim() : "";
  if (!t) return undefined;
  // 1) 四位年份在前(2026-01-05 / 2026/1/5…)
  const m1 = t.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  if (m1 && validYmd(+m1[1], +m1[2], +m1[3])) return `${m1[1]}-${pad2(+m1[2])}-${pad2(+m1[3])}`;
  // 2) 英文月份带年份(Wed Apr 01 2026…)
  const m2 = t.match(/([A-Za-z]{3})\s+(\d{1,2})\D+(\d{4})/);
  if (m2 && MONTHS[m2[1].toLowerCase()] && validYmd(+m2[3], MONTHS[m2[1].toLowerCase()], +m2[2]))
    return `${m2[3]}-${pad2(MONTHS[m2[1].toLowerCase()])}-${pad2(+m2[2])}`;
  // 3) 英文月份无年份(Tue Jul 07 / Fri Sep 04),年份取文件名/当前年
  const m3 = t.match(/^([A-Za-z]{3})\s+(\d{1,2})(?!\d)/) ?? t.match(/\b([A-Za-z]{3})\s+(\d{1,2})(?!\d)/);
  if (m3 && MONTHS[m3[1].toLowerCase()]) {
    const y = 默认年份 ?? new Date().getFullYear();
    const mon = MONTHS[m3[1].toLowerCase()];
    if (validYmd(y, mon, +m3[2])) return `${y}-${pad2(mon)}-${pad2(+m3[2])}`;
  }
  return undefined;
}

// 数字列解析:空 -> undefined;非数字 -> null(由调用方转错误行)
const parseNum = (v: unknown): number | undefined | null => {
  if (v instanceof Date) return null;
  const t = cellText(v);
  if (!t) return undefined;
  const n = Number(t.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};

const isEmptyRow = (cells: unknown[]) => cells.every(c => cellText(c) === "");

// 在前 12 行里定位排期表头:取命中别名数最多的行,至少命中 3 列、且含关键列(货号/PO号 之一 +
// 数量/接单日期/走货期 之一)才算表头,避免把"名称/配比图"类资料表误判为排期表
const KEY_FIELDS = new Set(["货号", "PO号"]);
const DATA_FIELDS = new Set(["数量", "接单日期", "走货期"]);

export function findScheduleHeaderRowIndex(grid: unknown[][]): number {
  let best = -1, bestHits = 0;
  const limit = Math.min(grid.length, 12);
  for (let i = 0; i < limit; i++) {
    const fields = new Set(
      grid[i].map(c => matchField(normScheduleHeader(cellText(c)))).filter(Boolean) as string[]);
    const qualified = fields.size >= 3
      && [...KEY_FIELDS].some(f => fields.has(f))
      && [...DATA_FIELDS].some(f => fields.has(f));
    if (qualified && fields.size > bestHits) { best = i; bestHits = fields.size; }
  }
  return best;
}

const MAX_REMARK = 380; // 备注列宽 400,留余量

// 解析单个工作表的二维数组:按表头别名映射;空行跳过;数字/日期列解析失败不报错,原值以 "列名:原值"
// 打包进备注(排期表常有"待定"等手写值);未映射列同样打包;备注截断到列宽以内。
// 唯一硬性错误:货号/PO号/客PO 全空(无法定位订单行,多为合计/备注行)。
export function parseScheduleGrid(grid: unknown[][], 工作表: string, 默认年份?: number): ScheduleSheetParseResult {
  const 状态 = statusFromSheetName(工作表);
  if (shouldSkipSheet(工作表)) return { 工作表, 状态, hasHeader: false, 跳过: true, rows: [] };
  const h = findScheduleHeaderRowIndex(grid);
  if (h < 0) return { 工作表, 状态, hasHeader: false, rows: [] };
  const headerCells = grid[h].map(c => cellText(c));
  const fieldAt = headerCells.map(c => matchField(normScheduleHeader(c)));
  const rows: ScheduleImportRowData[] = [];
  for (let i = h + 1; i < grid.length; i++) {
    const cells = grid[i];
    if (isEmptyRow(cells)) continue;
    const row: ScheduleImportRowData = { 行号: i + 1, 状态, 来源工作表: 工作表 };
    const data = row as unknown as Record<string, unknown>;
    let touched = false;
    const pack: string[] = [];
    const raw: Record<string, string> = {};
    for (let c = 0; c < headerCells.length; c++) {
      const field = fieldAt[c];
      const v = cells[c];
      // 原始行全量保留(表头为空用 列N;重名表头加序号;单元格值截 500 字防极端格)
      const t0 = cellText(v);
      if (t0) {
        const base = headerCells[c] || `列${c + 1}`;
        let key = base, n = 2;
        while (key in raw) key = `${base}_${n++}`;
        raw[key] = t0.length > 500 ? `${t0.slice(0, 500)}…` : t0;
      }
      if (field) {
        if (NUMERIC_FIELDS.has(field)) {
          const n = parseNum(v);
          if (n === null) { if (cellText(v)) pack.push(`${headerCells[c]}:${cellText(v)}`); continue; }
          if (n !== undefined) { data[field] = n; touched = true; }
        } else if (DATE_FIELDS.has(field)) {
          const d = cellToDate(v, 默认年份);
          if (d) { data[field] = d; touched = true; }
          else if (cellText(v)) pack.push(`${headerCells[c]}:${cellText(v)}`);
        } else {
          const t = cellText(v);
          if (t) { data[field] = t; touched = true; }
        }
      } else if (!SKIP_PACK_HEADERS.has(normScheduleHeader(headerCells[c]))) {
        const t = cellText(v);
        if (t) pack.push(`${headerCells[c]}:${t}`);
      }
    }
    if (!touched && pack.length === 0) continue; // 映射列全空且无附加信息 -> 视为空行
    if (Object.keys(raw).length > 0) row.原始数据 = raw;
    // 备注打包:备注列内容最前,追加项空格连接,整体截断到列宽以内
    const tail = pack.join(" ");
    const packed = row.备注 ? (tail ? `${row.备注};${tail}` : row.备注) : tail;
    if (packed) row.备注 = packed.length > MAX_REMARK ? `${packed.slice(0, MAX_REMARK)}…` : packed;
    if (!row.货号 && !row.PO号 && !row.客PO) row.错误 = "货号/PO号/客PO 不能都为空";
    rows.push(row);
  }
  return { 工作表, 状态, hasHeader: true, rows };
}

// 从文件名猜排期客户:去扩展名(可能多重如 .xlsx1.xlsx)/年份/"排期""接单"等通用词/尾随日期,供导入弹窗默认值(可改)
export function guessScheduleCustomer(fileName: string): string {
  let s = fileName.replace(/(\.[^.]+)+$/, "");
  s = s.replace(/^20\d{2}年?/, "");
  s = s.replace(/(总)?(生产)?(接单)?排期(表)?/g, "");
  s = s.replace(/(接单)?明细表/g, "");
  s = s.replace(/\d{1,2}-\d{1,2}/g, "").replace(/[（(].*?[)）]/g, "");
  s = s.replace(/^接单/, "");
  s = s.replace(/[\s_-]+$/g, "").trim();
  return s || fileName.replace(/(\.[^.]+)+$/, "");
}

// 从文件名取年份(如 "2026年…排期8-15.xls" -> 2026),供无年份英文日期("Tue Jul 07")补全
export function yearFromFileName(fileName: string): number | undefined {
  const m = fileName.match(/(20\d{2})年?/);
  return m ? +m[1] : undefined;
}
